/**
 * SafeEscrow.algo — Backend API
 * Node.js + Express
 * Reads live data from Algorand Indexer, stores dispute metadata off-chain
 *
 * Install: npm install express cors algosdk node-fetch dotenv
 * Run:     node server.js
 */

import express      from "express";
import cors         from "cors";
import algosdk      from "algosdk";
import fetch        from "node-fetch";
import dotenv       from "dotenv";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Algorand config ───────────────────────────────────────────────────────
const ALGOD_SERVER   = process.env.ALGOD_SERVER   || "https://mainnet-api.algonode.cloud";
const INDEXER_SERVER = process.env.INDEXER_SERVER || "https://mainnet-idx.algonode.cloud";
const algodClient    = new algosdk.Algodv2("", ALGOD_SERVER, 443);

// ── In-memory store (replace with Postgres/Supabase in production) ────────
const escrowMeta = {};   // appId → { note, disputeEvidence, disputeOpenedAt }
const jurorVotes = {};   // appId → [{ address, side, stake, ts }]

// ── STATUS helper ─────────────────────────────────────────────────────────
const STATUS = { 0: "pending", 1: "claimed", 2: "cancelled", 3: "dispute" };

function parseGlobalState(stateArray) {
  const gs = {};
  (stateArray || []).forEach(({ key, value }) => {
    const k = Buffer.from(key, "base64").toString();
    gs[k]   = value.type === 1
      ? Buffer.from(value.bytes, "base64").toString()
      : value.uint;
  });
  return gs;
}

// ── GET /api/escrows/:address ─────────────────────────────────────────────
// Returns all escrow contracts created by or involving an address
app.get("/api/escrows/:address", async (req, res) => {
  try {
    const { address } = req.params;

    // Validate address
    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ error: "Invalid Algorand address" });
    }

    const url  = `${INDEXER_SERVER}/v2/accounts/${address}/created-apps?limit=50`;
    const resp = await fetch(url);
    const data = await resp.json();

    const escrows = (data["created-apps"] || []).map(app => {
      const gs     = parseGlobalState(app.params["global-state"]);
      const appId  = app.id;
      const meta   = escrowMeta[appId] || {};
      const now    = Math.floor(Date.now() / 1000);

      return {
        appId,
        sender:       gs.sender     || "",
        recipient:    gs.recipient  || "",
        amountMicro:  gs.amount     || 0,
        amountAlgo:   ((gs.amount || 0) / 1_000_000).toFixed(6),
        assetId:      gs.asset_id   || 0,
        token:        gs.asset_id   ? "USDC" : "ALGO",
        lockUntil:    gs.lock_until || 0,
        lockExpired:  now >= (gs.lock_until || 0),
        timeRemaining: Math.max(0, (gs.lock_until || 0) - now),
        status:       STATUS[gs.status] || "unknown",
        statusCode:   gs.status || 0,
        disputeYes:   gs.dispute_yes || 0,
        disputeNo:    gs.dispute_no  || 0,
        createdAt:    gs.created_at  || 0,
        note:         meta.note || "",
        hasDispute:   gs.status === 3,
        disputeEvidence: meta.disputeEvidence || null,
      };
    });

    // Sort by createdAt desc
    escrows.sort((a, b) => b.createdAt - a.createdAt);

    res.json({ address, count: escrows.length, escrows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch escrows", detail: err.message });
  }
});

// ── GET /api/escrow/:appId ────────────────────────────────────────────────
app.get("/api/escrow/:appId", async (req, res) => {
  try {
    const appId = parseInt(req.params.appId);
    const url   = `${INDEXER_SERVER}/v2/applications/${appId}`;
    const resp  = await fetch(url);
    const data  = await resp.json();

    if (!data.application) return res.status(404).json({ error: "Escrow not found" });

    const gs   = parseGlobalState(data.application.params["global-state"]);
    const meta = escrowMeta[appId] || {};
    const now  = Math.floor(Date.now() / 1000);

    res.json({
      appId,
      sender:          gs.sender     || "",
      recipient:       gs.recipient  || "",
      amountMicro:     gs.amount     || 0,
      amountAlgo:      ((gs.amount || 0) / 1_000_000).toFixed(6),
      assetId:         gs.asset_id   || 0,
      token:           gs.asset_id   ? "USDC" : "ALGO",
      lockUntil:       gs.lock_until || 0,
      lockExpired:     now >= (gs.lock_until || 0),
      timeRemaining:   Math.max(0, (gs.lock_until || 0) - now),
      status:          STATUS[gs.status] || "unknown",
      disputeYes:      gs.dispute_yes || 0,
      disputeNo:       gs.dispute_no  || 0,
      createdAt:       gs.created_at  || 0,
      note:            meta.note || "",
      disputeEvidence: meta.disputeEvidence || null,
      votes:           jurorVotes[appId]    || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/escrow/meta ─────────────────────────────────────────────────
// Store off-chain metadata (note, dispute evidence)
app.post("/api/escrow/meta", (req, res) => {
  const { appId, note, disputeEvidence } = req.body;
  if (!appId) return res.status(400).json({ error: "appId required" });
  escrowMeta[appId] = { note, disputeEvidence, updatedAt: Date.now() };
  res.json({ ok: true });
});

// ── POST /api/dispute/evidence ────────────────────────────────────────────
app.post("/api/dispute/evidence", (req, res) => {
  const { appId, side, evidence, address } = req.body;
  if (!appId || !side || !evidence) return res.status(400).json({ error: "Missing fields" });
  if (!escrowMeta[appId]) escrowMeta[appId] = {};
  if (!escrowMeta[appId].disputeEvidence) escrowMeta[appId].disputeEvidence = {};
  escrowMeta[appId].disputeEvidence[side] = { evidence, address, submittedAt: Date.now() };
  res.json({ ok: true });
});

// ── GET /api/disputes/active ──────────────────────────────────────────────
app.get("/api/disputes/active", async (req, res) => {
  try {
    // In production: index all SafeEscrow apps from indexer
    // For now returns cached dispute meta
    const disputes = Object.entries(escrowMeta)
      .filter(([, m]) => m.disputeEvidence)
      .map(([appId, meta]) => ({ appId: parseInt(appId), ...meta }));
    res.json({ disputes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/stats ────────────────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  try {
    // Query indexer for app creation stats
    res.json({
      totalEscrows:   2841,    // Replace with live indexer query
      volumeAlgo:     845200,
      volumeUsdc:     356000,
      activeDisputes: 3,
      resolvedToday:  12,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/account/:address/balance ────────────────────────────────────
app.get("/api/account/:address/balance", async (req, res) => {
  try {
    const { address } = req.params;
    const info = await algodClient.accountInformation(address).do();
    const usdc = (info.assets || []).find(a => a["asset-id"] === 31566704);
    res.json({
      algoBalance:  info.amount / 1_000_000,
      usdcBalance:  usdc ? usdc.amount / 1_000_000 : 0,
      minBalance:   info["min-balance"] / 1_000_000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ status: "ok", timestamp: Date.now() }));

app.listen(PORT, () => console.log(`SafeEscrow API running on port ${PORT}`));
