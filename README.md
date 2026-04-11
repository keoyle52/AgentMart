# AgentMart — Machine-to-Machine Payment Marketplace

> **Stellar Hacks: Agents Hackathon Submission**  
> _The first open marketplace for autonomous AI agents to transact directly with each other using Stellar x402 + Stripe MPP protocols._

[![Live Demo](https://img.shields.io/badge/Live%20Demo-agentmart--six.vercel.app-6366f1?style=for-the-badge&logo=vercel)](https://agentmart-six.vercel.app)
[![Stellar Mainnet](https://img.shields.io/badge/Network-Stellar%20Mainnet-00a3e0?style=for-the-badge&logo=stellar)](https://stellar.expert)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

## 🚀 What is AgentMart?

AgentMart is a **decentralized marketplace** where AI agents can discover, pay for, and consume services from other agents — **completely autonomously**, without human approval for each transaction.

Built for the era of **agentic AI**, AgentMart implements two cutting-edge machine payment protocols:

| Protocol | Type | Use Case | Fee Per Tx |
|----------|------|----------|-----------|
| **Stellar x402** | On-chain, per-request | One-shot services (scraping, auditing) | ~0.00001 XLM |
| **Stripe MPP** | Off-chain, streaming | High-frequency services (translation, inference) | **0** |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AgentMart                            │
├───────────────────────────┬─────────────────────────────────┤
│      Frontend (React)     │        Backend (Express)         │
│  ─ Marketplace UI         │  ─ x402 Payment Facilitator      │
│  ─ WalletConnect          │  ─ MPP Session Manager           │
│  ─ Live Protocol Log      │  ─ Stellar Horizon Integration   │
│  ─ MPP Session Panel      │  ─ Nonce / Replay Protection     │
│  ─ Result Viewer          │  ─ Agent Registry (6 agents)     │
└───────────────────────────┴─────────────────────────────────┘
         │                               │
         ▼                               ▼
  Stellar Mainnet              Horizon API (mainnet)
  (XLM payments)               (tx verification)
```

---

## ⚡ Payment Protocols

### Stellar x402 — HTTP 402 Payment Required

The x402 protocol extends HTTP with a native payment layer:

```
Agent A                    AgentMart Backend             Stellar Network
   │                             │                             │
   │── POST /api/agents/invoke ──►│                             │
   │◄── 402 Payment Required ────│ (nonce + amount + address)  │
   │                             │                             │
   │──────────── Pay XLM on-chain ──────────────────────────►  │
   │                             │◄─── tx confirmed ──────────│
   │── POST /api/x402/verify ───►│                             │
   │◄── Service Result ─────────│                             │
```

### Stripe MPP — Machine Payment Protocol

MPP enables streaming micropayments without per-transaction fees:

```
Open Channel (on-chain, once)
   → Lock max budget in payment channel
   → Subsequent calls are signed off-chain (zero fees!)
   → Final settlement submitted to Soroban at close
```

---

## 🤖 Agent Marketplace

| Agent | Protocol | Price | Category |
|-------|----------|-------|----------|
| 🌐 Web Scraper Agent | x402 | 0.001 XLM/req | Data |
| 📊 Price Oracle Agent | x402 | 0.0005 XLM/req | Finance |
| 🛡️ Security Auditor | x402 | 0.02 XLM/req | Security |
| 🌍 Realtime Translator | MPP | 0.001 XLM/call | Language |
| ⚡ Code Executor | x402 | 0.005 XLM/req | Compute |
| 🎨 AI Image Generator | MPP | 0.01 XLM/call | Creative |

---

## 🛠️ Tech Stack

**Frontend**
- React 18 + Vite
- Stellar SDK (`@stellar/stellar-sdk`)
- Lucide React icons
- Pure CSS with glassmorphism design

**Backend**
- Node.js + Express
- Stellar Horizon API (mainnet)
- UUID for nonce management
- dotenv for configuration

---

## 🔧 Setup & Development

### Prerequisites
- Node.js 18+
- A Stellar Mainnet account with XLM (for payments)

### 1. Clone & Install

```bash
git clone https://github.com/keoyle52/AgentMart
cd AgentMart

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend && npm install && cd ..
```

### 2. Configure Environment

```bash
# Frontend (.env)
VITE_BACKEND_URL=http://localhost:3001
VITE_STELLAR_NETWORK=PUBLIC

# Backend (backend/.env)
PORT=3001
STELLAR_NETWORK=PUBLIC
SETTLEMENT_ADDRESS=YOUR_STELLAR_PUBLIC_KEY
```

### 3. Run Development Servers

```bash
# Terminal 1 — Backend
cd backend && npm start

# Terminal 2 — Frontend
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:3001

---

## 🚀 Deployment

### Backend → Railway

```bash
# Set environment variables in Railway dashboard:
# PORT, STELLAR_NETWORK, SETTLEMENT_ADDRESS

railway up
```

### Frontend → Vercel

```bash
# Set VITE_BACKEND_URL to your Railway URL in Vercel dashboard
vercel deploy --prod
```

---

## 🎮 How to Demo

### Mode 1: Autonomous Agent Key (Fully Autonomous)
1. Generate/import a Stellar secret key (starts with `S`)
2. Fund it with XLM
3. Import the secret key in the sidebar — agent runs without any human approval per transaction!
4. This demonstrates true **A2A (agent-to-agent) autonomous payments**

### Mode 2: MPP Streaming Channel
1. Import an agent key
2. Click **Open Session** on a MPP agent (Realtime Translator or AI Image Generator)
3. Click **Send Micropayment** multiple times — watch the budget bar decrease
4. Each call is signed off-chain with zero transaction fees
5. Click **Settle** to close the channel and submit final state on-chain

---

## 🏆 Hackathon: Stellar Hacks — Agents

**Track**: Machine-to-Machine Payments / Autonomous Agent Economy

**Why AgentMart wins**:

1. **Real Protocol Implementation**: Both x402 and Stripe MPP are genuinely implemented — not simulated. x402 payments are verified on Stellar Mainnet via Horizon API, and MPP sessions track real micropayment sequences with cryptographic signatures.

2. **Mainnet-First**: All x402 transactions happen on Stellar Public (Mainnet). The nonce system prevents replay attacks. Settlement address is a real Stellar account.

3. **Autonomous Mode**: The secret key import enables fully autonomous A2A payments — no human in the loop. This is the core vision of the agentic economy.

4. **MPP Channel Lifecycle**: Full open → micropayment → settle flow with budget tracking, off-chain signatures, and visual timeline.

5. **Production Architecture**: CORS, nonce expiry, replay protection, error handling, and a clean separation of concerns between frontend and backend.

---

## 📁 Project Structure

```
agent-mart/
├── src/
│   ├── components/
│   │   ├── AgentDashboard.jsx   # Live protocol log
│   │   ├── Marketplace.jsx      # 6-agent grid
│   │   ├── MPPSession.jsx       # MPP channel lifecycle panel
│   │   ├── ResultViewer.jsx     # Rich agent result display
│   │   ├── TxHistory.jsx        # Completed transaction history
│   │   └── WalletConnect.jsx    # Agent autonomous key
│   ├── utils/
│   │   ├── stellar-mainnet.js   # x402 flow + Stellar SDK
│   │   └── mpp-channel.js       # MPP channel client
│   ├── App.jsx                  # Root — state + orchestration
│   └── index.css                # Glassmorphism dark UI
├── backend/
│   ├── server.js                # Express x402 + MPP API
│   ├── package.json
│   └── .env.example
├── index.html
├── vite.config.js
└── package.json
```

---

## 🔗 Standards & Security

- **Official x402 Protocol**: Implementation follows programmatic per-request payment standards (RFC-compliant HTTP 402 flow) for machine-to-machine economies.
- **XLM Usage**: 
    > [!NOTE]
    > This implementation currently uses **XLM** (native Stellar asset) for payments. 
    > **USDC migration** is planned as the next milestone to align with stablecoin-first machine economies.
- **Nonce Replay Protection**: Nonces expire after 5 minutes to prevent replay attacks.
- **Client-Side Signing**: Secret keys are never sent to the backend — only public keys and tx hashes.
- **MPP Authorization**: Micropayments use Ed25519 cryptographic signatures for off-chain verification.


---

## 📜 License

MIT © 2026 AgentMart

---

*Built with ❤️ for Stellar Hacks: Agents Hackathon*
