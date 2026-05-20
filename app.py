"""
SafeEscrow.algo — Backend API
Express-style REST API using Node/Python for escrow state,
Algorand Indexer queries, and dispute management.
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from algosdk.v2client import algod, indexer
from algosdk import account, transaction, encoding
from algosdk.future.transaction import ApplicationCallTxn, PaymentTxn
import os, time, json, sqlite3

app = Flask(__name__)
CORS(app)

# ── Algorand clients ───────────────────────────────────────────────
ALGOD_ADDRESS  = os.getenv("ALGOD_ADDRESS",  "https://mainnet-api.algonode.cloud")
ALGOD_TOKEN    = os.getenv("ALGOD_TOKEN",    "")
INDEXER_ADDRESS= os.getenv("INDEXER_ADDRESS","https://mainnet-idx.algonode.cloud")
INDEXER_TOKEN  = os.getenv("INDEXER_TOKEN",  "")

algod_client    = algod.AlgodClient(ALGOD_TOKEN, ALGOD_ADDRESS)
indexer_client  = indexer.IndexerClient(INDEXER_TOKEN, INDEXER_ADDRESS)

# ── SQLite for local escrow metadata ──────────────────────────────
DB_PATH = "escrows.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS escrows (
            app_id      INTEGER PRIMARY KEY,
            sender      TEXT NOT NULL,
            recipient   TEXT NOT NULL,
            amount      INTEGER NOT NULL,
            token       TEXT DEFAULT 'ALGO',
            lock_end    INTEGER NOT NULL,
            note        TEXT,
            status      TEXT DEFAULT 'pending',
            created_at  INTEGER DEFAULT (strftime('%s','now')),
            tx_id       TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS disputes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id      INTEGER NOT NULL,
            opener      TEXT NOT NULL,
            reason      TEXT,
            votes_sender    INTEGER DEFAULT 0,
            votes_recipient INTEGER DEFAULT 0,
            vote_end    INTEGER,
            resolved    INTEGER DEFAULT 0,
            winner      TEXT,
            created_at  INTEGER DEFAULT (strftime('%s','now'))
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ── ROUTES ────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": int(time.time())})


@app.route("/api/algod/params", methods=["GET"])
def get_params():
    """Return suggested transaction params for the frontend to build txns."""
    try:
        params = algod_client.suggested_params()
        return jsonify({
            "fee":              params.fee,
            "first_valid_round":params.first,
            "last_valid_round": params.last,
            "genesis_hash":     params.gh,
            "genesis_id":       params.gen,
            "min_fee":          params.min_fee,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/escrows", methods=["GET"])
def list_escrows():
    """List all escrows for a given address."""
    address = request.args.get("address")
    if not address:
        return jsonify({"error": "address required"}), 400
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM escrows WHERE sender=? OR recipient=? ORDER BY created_at DESC",
        (address, address)
    ).fetchall()
    conn.close()
    result = []
    for row in rows:
        e = dict(row)
        # Enrich with on-chain state
        try:
            app_info = algod_client.application_info(e["app_id"])
            gs = {kv["key"]: kv["value"] for kv in app_info["params"]["global-state"]}
            e["on_chain_status"] = gs.get("c3RhdHVz", {}).get("uint", 0)
        except:
            e["on_chain_status"] = None
        result.append(e)
    return jsonify(result)


@app.route("/api/escrows", methods=["POST"])
def create_escrow():
    """Register a newly deployed escrow app in our DB."""
    data = request.json
    required = ["app_id", "sender", "recipient", "amount", "lock_end"]
    if not all(k in data for k in required):
        return jsonify({"error": "missing fields"}), 400
    conn = get_db()
    conn.execute("""
        INSERT OR REPLACE INTO escrows
        (app_id, sender, recipient, amount, token, lock_end, note, tx_id)
        VALUES (?,?,?,?,?,?,?,?)
    """, (
        data["app_id"], data["sender"], data["recipient"],
        data["amount"], data.get("token","ALGO"),
        data["lock_end"], data.get("note",""), data.get("tx_id","")
    ))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "app_id": data["app_id"]})


@app.route("/api/escrows/<int:app_id>", methods=["GET"])
def get_escrow(app_id):
    """Get full escrow detail including live on-chain state."""
    conn = get_db()
    row = conn.execute("SELECT * FROM escrows WHERE app_id=?", (app_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "not found"}), 404
    e = dict(row)
    try:
        app_info = algod_client.application_info(app_id)
        gs = {}
        for kv in app_info["params"]["global-state"]:
            key = encoding.base64.b64decode(kv["key"]).decode("utf-8", errors="ignore")
            val = kv["value"]
            gs[key] = val.get("uint") if val["type"] == 2 else encoding.base64.b64decode(val.get("bytes","")).decode("utf-8", errors="ignore")
        e["global_state"] = gs
        status_map = {0:"pending",1:"claimed",2:"cancelled",3:"dispute"}
        e["status"] = status_map.get(gs.get("status", 0), "unknown")
    except Exception as ex:
        e["chain_error"] = str(ex)
    return jsonify(e)


@app.route("/api/escrows/<int:app_id>/status", methods=["PATCH"])
def update_status(app_id):
    """Update escrow status after a confirmed transaction."""
    data = request.json
    status = data.get("status")
    if status not in ["pending","claimed","cancelled","dispute"]:
        return jsonify({"error": "invalid status"}), 400
    conn = get_db()
    conn.execute("UPDATE escrows SET status=? WHERE app_id=?", (status, app_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/api/disputes", methods=["POST"])
def open_dispute():
    """Register a dispute for an escrow."""
    data = request.json
    conn = get_db()
    vote_end = int(time.time()) + 72 * 3600  # 72 hours
    cursor = conn.execute("""
        INSERT INTO disputes (app_id, opener, reason, vote_end)
        VALUES (?,?,?,?)
    """, (data["app_id"], data["opener"], data.get("reason",""), vote_end))
    conn.execute("UPDATE escrows SET status='dispute' WHERE app_id=?", (data["app_id"],))
    conn.commit()
    dispute_id = cursor.lastrowid
    conn.close()
    return jsonify({"success": True, "dispute_id": dispute_id, "vote_end": vote_end})


@app.route("/api/disputes/<int:app_id>", methods=["GET"])
def get_dispute(app_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM disputes WHERE app_id=? AND resolved=0 ORDER BY created_at DESC LIMIT 1",
        (app_id,)
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "no active dispute"}), 404
    return jsonify(dict(row))


@app.route("/api/disputes/<int:dispute_id>/vote", methods=["POST"])
def cast_vote(dispute_id):
    """Record a community vote."""
    data = request.json
    side = data.get("side")  # "sender" or "recipient"
    stake = data.get("stake", 5)
    if side not in ["sender", "recipient"]:
        return jsonify({"error": "invalid side"}), 400
    conn = get_db()
    dispute = conn.execute("SELECT * FROM disputes WHERE id=?", (dispute_id,)).fetchone()
    if not dispute:
        conn.close()
        return jsonify({"error": "dispute not found"}), 404
    if int(time.time()) > dispute["vote_end"]:
        conn.close()
        return jsonify({"error": "voting period ended"}), 400
    if side == "sender":
        conn.execute("UPDATE disputes SET votes_sender=votes_sender+? WHERE id=?", (stake, dispute_id))
    else:
        conn.execute("UPDATE disputes SET votes_recipient=votes_recipient+? WHERE id=?", (stake, dispute_id))
    conn.commit()
    # Check if we should auto-resolve
    updated = conn.execute("SELECT * FROM disputes WHERE id=?", (dispute_id,)).fetchone()
    conn.close()
    return jsonify({
        "success": True,
        "votes_sender":    updated["votes_sender"],
        "votes_recipient": updated["votes_recipient"],
    })


@app.route("/api/disputes/<int:dispute_id>/resolve", methods=["POST"])
def resolve_dispute(dispute_id):
    """Resolve a dispute after voting ends."""
    conn = get_db()
    dispute = conn.execute("SELECT * FROM disputes WHERE id=?", (dispute_id,)).fetchone()
    if not dispute:
        conn.close()
        return jsonify({"error": "not found"}), 404
    if int(time.time()) < dispute["vote_end"]:
        conn.close()
        return jsonify({"error": "voting still open"}), 400
    winner = "sender" if dispute["votes_sender"] >= dispute["votes_recipient"] else "recipient"
    new_status = "cancelled" if winner == "sender" else "claimed"
    conn.execute("UPDATE disputes SET resolved=1, winner=? WHERE id=?", (winner, dispute_id))
    conn.execute("UPDATE escrows SET status=? WHERE app_id=?", (new_status, dispute["app_id"]))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "winner": winner, "new_status": new_status})


@app.route("/api/stats", methods=["GET"])
def stats():
    """Platform-wide statistics."""
    conn = get_db()
    total   = conn.execute("SELECT COUNT(*) FROM escrows").fetchone()[0]
    claimed = conn.execute("SELECT COUNT(*) FROM escrows WHERE status='claimed'").fetchone()[0]
    cancelled = conn.execute("SELECT COUNT(*) FROM escrows WHERE status='cancelled'").fetchone()[0]
    vol_row = conn.execute("SELECT SUM(amount) FROM escrows").fetchone()[0]
    disputes = conn.execute("SELECT COUNT(*) FROM disputes").fetchone()[0]
    conn.close()
    return jsonify({
        "total_escrows":   total,
        "claimed":         claimed,
        "cancelled":       cancelled,
        "total_volume_microalgo": vol_row or 0,
        "total_disputes":  disputes,
    })


@app.route("/api/verify-tx/<tx_id>", methods=["GET"])
def verify_tx(tx_id):
    """Verify a transaction is confirmed on-chain."""
    try:
        tx = indexer_client.transaction(tx_id)
        return jsonify({
            "confirmed": True,
            "round": tx["transaction"]["confirmed-round"],
            "type":  tx["transaction"]["tx-type"],
        })
    except Exception as e:
        return jsonify({"confirmed": False, "error": str(e)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
