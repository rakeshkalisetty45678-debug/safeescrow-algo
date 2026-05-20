# SafeEscrow.algo 🔒

**Reversible transactions on Algorand** — Send ALGO & USDC with a cancel button.

Time-locked escrow smart contracts with community dispute resolution.

🌐 **Live:** https://delightful-naiad-cd48c8.netlify.app

---

## What's in this repo

```
safeescrow-algo/
├── index.html              ← Frontend (single file, no build needed)
├── server.js               ← Backend API (Node.js + Express)
├── package.json
├── contracts/
│   └── escrow.py           ← PyTeal smart contract (AVM)
├── js/
│   └── wallet.js           ← Pera + Defly wallet SDK integration
└── .env.example
```

---

## Features

- ✅ Time-locked escrow (1h / 24h / 7d / 30d cancel window)
- ✅ ALGO & USDC support
- ✅ One-click cancel with full refund
- ✅ Community dispute resolution with staked voting
- ✅ Pera Wallet + Defly integration
- ✅ Live on-chain data via Algorand Indexer
- ✅ Non-custodial — no admin keys

---

## Quick Start

### Frontend only (no backend needed)
Just open `index.html` in a browser or deploy to Netlify by dragging the file.

### With backend API
```bash
npm install
cp .env.example .env
npm start
# API runs on http://localhost:3001
```

### Compile smart contract
```bash
pip install pyteal
python3 contracts/escrow.py
# Outputs: escrow_approval.teal + escrow_clear.teal
```

---

## Deploy to Netlify

1. Push this repo to GitHub
2. Go to [netlify.com](https://netlify.com) → New site → Import from GitHub
3. No build command needed — publish directory is `/` (root)
4. Deploy

For the backend API, deploy `server.js` to Railway, Render, or Fly.io.

---

## Smart Contract

The `contracts/escrow.py` PyTeal contract handles:

| Action | Who | Condition |
|--------|-----|-----------|
| `fund` | Sender | Once, after creation |
| `cancel` | Sender | Before lock expires |
| `claim` | Recipient | After lock expires |
| `dispute` | Either party | 0.5 ALGO fee |
| `vote` | Community jurors | During 72h window |
| `resolve` | Anyone | After 72h vote window |

---

## Environment Variables

```env
PORT=3001
ALGOD_SERVER=https://mainnet-api.algonode.cloud
INDEXER_SERVER=https://mainnet-idx.algonode.cloud
```

---

## Tech Stack

- **Blockchain:** Algorand (AVM)
- **Smart Contract:** PyTeal
- **Wallet:** Pera Wallet SDK + Defly SDK
- **Frontend:** Vanilla HTML/CSS/JS
- **Backend:** Node.js + Express
- **Data:** Algorand Indexer API

---

## License

MIT
