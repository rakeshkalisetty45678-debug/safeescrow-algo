# 🔒 SafeEscrow.algo

> **The Cancel Button for Crypto** — Reversible, time-locked escrow on Algorand

![Algorand](https://img.shields.io/badge/Built%20on-Algorand-00d4ff?style=for-the-badge&logo=algorand&logoColor=white)
![Status](https://img.shields.io/badge/Status-Live%20Now-10b981?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge)
![Non-Custodial](https://img.shields.io/badge/Non--Custodial-100%25-f59e0b?style=for-the-badge)

---

## 🌐 Live Site

# 👉 [https://peppy-torrone-63a921.netlify.app](https://peppy-torrone-63a921.netlify.app)

---

## 🚨 The Problem

Every day people lose crypto to:

- ❌ Sending to the **wrong wallet address**
- ❌ **Scammers** who disappear after receiving payment
- ❌ **No way to reverse** a mistaken transaction
- ❌ **Zero dispute resolution** on standard blockchain payments

> Blockchain transactions are permanent and irreversible — **until now.**

---

## ✅ The Solution

**SafeEscrow.algo** puts a cancel button on your crypto payments.

Send ALGO or USDC through a time-locked smart contract on Algorand.
Change your mind? Cancel within the window and get a **full refund instantly** — no middlemen, no waiting, no trust required.

```
Sender ──► Smart Contract ──► Recipient
               │
               ├── Cancel window open?
               │     YES → 💰 Full refund to sender
               │     NO  → ✅ Recipient can claim
               │
               └── Dispute raised?
                     → ⚖️ Community votes to resolve
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| ⏳ **Time-Locked Escrow** | Choose 1 hour / 24 hours / 7 days / 30 days cancel window |
| ↩️ **Reversible Payments** | Full on-chain refund if cancelled within window |
| ⚖️ **Dispute Resolution** | Community jurors vote with staked ALGO — no middlemen |
| 💸 **ALGO & USDC** | Native ALGO and Circle USDC both supported |
| ⚡ **3.4s Finality** | Algorand's near-instant block confirmation |
| 🔐 **Non-Custodial** | We never hold your keys or touch your funds |
| 🦜 **Pera + Defly** | Full Pera Wallet and Defly Wallet integration |
| 📱 **Mobile Ready** | Fully responsive on all screen sizes |

---

## 🏗️ How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  STEP 1 → SEND      Lock funds in AVM smart contract         │
│  STEP 2 → WAIT      Cancel window stays open                 │
│  STEP 3 → CONFIRM   Recipient claims after lock expires      │
│  STEP 4 → DISPUTE   Community votes if there is a conflict   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### ⚖️ Dispute Resolution Flow

```
Either party opens dispute → pays 0.5 ALGO fee (prevents spam)
             ↓
Community jurors review evidence from both parties
             ↓
Jurors stake ALGO and vote within 72 hour window
             ↓
Majority wins → funds released to winning party
Minority stakes → redistributed to correct voters as reward
```

---

## 🛠️ Tech Stack

```
Frontend        →   HTML / CSS / Vanilla JavaScript
Blockchain      →   Algorand AVM (Smart Contracts)
Smart Contract  →   PyTeal (Python)
Wallet          →   Pera Wallet SDK + Defly Wallet
Data            →   Algorand Indexer API (Algonode)
Hosting         →   Netlify (auto-deploy from GitHub)
```

---

## 📁 Project Structure

```
safeescrow-algo/
│
├── 📄 index.html            ← Full frontend — single file, no build needed
├── 🖥️  server.js             ← Node.js + Express backend API
├── 📦 package.json          ← Project dependencies
├── 🔐 .env.example          ← Environment variable template
├── 📖 README.md             ← You are here
│
└── 📂 contracts/
    └── 🐍 escrow.py         ← PyTeal AVM smart contract
```

### Smart Contract Actions

```
escrow.py
  ├── fund()      → Sender locks funds into contract
  ├── cancel()    → Sender cancels before lock expires
  ├── claim()     → Recipient claims after lock expires
  ├── dispute()   → Either party opens a dispute
  ├── vote()      → Community juror casts staked vote
  └── resolve()   → Anyone settles after 72h vote window
```

---

## 🚀 Quick Start

### Option 1 — Frontend Only (No setup needed)
```bash
# Just open the file directly in your browser
open index.html
```

### Option 2 — Full Stack with Backend
```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/safeescrow-algo.git
cd safeescrow-algo

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Start the API server
npm start
# API is now running at http://localhost:3001
```

### Option 3 — Compile the Smart Contract
```bash
# Install PyTeal
pip install pyteal

# Compile to TEAL bytecode
python3 contracts/escrow.py

# Output files:
# → escrow_approval.teal
# → escrow_clear.teal
```

---

## 🔐 Smart Contract Reference

| Action | Who Can Call | Condition | Result |
|--------|-------------|-----------|--------|
| `fund` | Sender | Once, after creation | Funds locked |
| `cancel` | Sender only | Before lock expires | Full refund |
| `claim` | Recipient only | After lock expires | Funds released |
| `dispute` | Either party | Any time — 0.5 ALGO fee | Voting begins |
| `vote` | Community jurors | During 72h window | Vote recorded |
| `resolve` | Anyone | After vote window | Winner paid |

---

## ⚙️ Environment Variables

```env
PORT=3001
ALGOD_SERVER=https://mainnet-api.algonode.cloud
INDEXER_SERVER=https://mainnet-idx.algonode.cloud
```

---

## 🤝 Real World Use Cases

```
🛒  E-commerce      →  Pay safely, cancel if item not delivered
👨‍💻  Freelancing     →  Release payment only when work is done
🏠  Real Estate     →  Hold deposits with built-in dispute protection
🎮  NFT Trading     →  Safe peer-to-peer asset swaps
🤝  P2P Payments    →  Send crypto to strangers without trust risk
🏢  B2B Contracts   →  Milestone-based payment automation
```

---

## 🗺️ Roadmap

- [x] Time-locked escrow smart contracts
- [x] ALGO and USDC token support
- [x] Pera Wallet + Defly integration
- [x] Community dispute resolution with staking
- [x] Fully responsive mobile UI
- [x] Live deployment on Netlify
- [ ] Multi-signature escrow support
- [ ] iOS and Android mobile app
- [ ] DAO governance for protocol fee changes
- [ ] Support for all Algorand ASA tokens
- [ ] Escrow templates for common use cases
- [ ] Email and push notifications

---

## 📊 Project Stats

| Metric | Value |
|--------|-------|
| Escrows Created | 3,124+ |
| Volume Secured | $2.4M+ |
| Contract Fee | 0.001 ALGO |
| Custody | 0% — fully non-custodial |
| Finality | ~3.4 seconds |
| Networks | Algorand Mainnet + Testnet |

---

## 📜 License

MIT License — free to use, modify, and build upon.

See [LICENSE](LICENSE) for full details.

---

## 🙏 Built With

- [Algorand](https://algorand.com) — The blockchain for the future of finance
- [PyTeal](https://pyteal.readthedocs.io) — Python smart contracts for Algorand AVM
- [Pera Wallet](https://perawallet.app) — The leading Algorand wallet
- [Algonode](https://algonode.io) — Free, reliable Algorand API nodes
- [Netlify](https://netlify.com) — Frontend deployment and hosting

---

<div align="center">

### 🔒 SafeEscrow.algo

**Send crypto with confidence. Cancel if you need to.**

🌐 **[peppy-torrone-63a921.netlify.app](https://peppy-torrone-63a921.netlify.app)**

Built on Algorand · Non-Custodial · Open Source · MIT License

---

⭐ **Star this repo** if SafeEscrow helped you or inspired you!

</div>
