# Aegistra — AI-Driven Code Verification & Escrow

> A decentralised freelance platform where an agentic AI autonomously verifies code submissions and releases milestone payments via Ethereum smart contracts — no middleman required.

---

## What is Aegistra?

Aegistra removes trust from the freelance equation. A client funds a milestone in ETH. A freelancer submits their code. An **agentic AI pipeline** scores the submission automatically and instructs the smart contract to release payment, trigger a jury, or reject the work — all without human intervention.

---

## How It Works

```
Client funds milestone (ETH locked in EscrowContract)
        ↓
Freelancer submits work (emits WorkSubmitted on-chain)
        ↓
Node.js Oracle picks up event → calls AI Verification Service
        ↓
Agentic AI scores submission (tests + static analysis)
        ↓
Score ≥ 75%  →  APPROVED  →  Payment released to freelancer
Score 45–74% →  DISPUTED  →  3-juror staked vote triggered
Score < 45%  →  REJECTED  →  Freelancer may resubmit
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                        │
│            Next.js  +  MetaMask  +  ethers.js       │
└────────────────────┬────────────────────────────────┘
                     │ RPC / REST
┌────────────────────▼────────────────────────────────┐
│                  Ethereum (Sepolia)                  │
│   EscrowContract  │  DisputeContract  │  JuryStaking │
│   EvidenceRegistry (IPFS CIDs stored on-chain)      │
└────────────────────┬────────────────────────────────┘
                     │ WebSocket events
┌────────────────────▼────────────────────────────────┐
│                  Node.js Oracle                      │
│   Listens for WorkSubmitted → calls AI service       │
│   Signs & posts verdict back on-chain                │
└────────────────────┬────────────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────────────┐
│           AI Verification Service (FastAPI)          │
│                                                     │
│  Step 1 — Ingest submission (clone/unzip/hash)      │
│  Step 2 — Sandboxed pytest run                      │
│  Step 3 — Static analysis (Pylint + Flake8)         │
│  Step 4 — Weighted score calculation                │
│  Step 5 — Verdict: APPROVED / DISPUTED / REJECTED   │
│  Step 6 — Explainability bundle → pinned to IPFS    │
└─────────────────────────────────────────────────────┘
```

---

## Scoring Formula

The final score is a weighted average across three dimensions:

| Component | Weight | How It's Measured |
|---|---|---|
| Test Pass Rate | **60%** | `passed / total` via pytest |
| Pylint Score | **25%** | `raw_score / 10.0` (normalised) |
| Flake8 Score | **15%** | `1 - min(violations / max, 1.0)` |

```
Final Score = (test_pass_rate × 0.60)
            + (pylint_score   × 0.25)
            + (flake8_score   × 0.15)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity, Hardhat, OpenZeppelin |
| Blockchain | Ethereum Sepolia Testnet |
| Oracle | Node.js, ethers.js, WebSocket |
| AI Service | Python, FastAPI, Pylint, Flake8, pytest |
| LLM Providers | Ollama (default), OpenAI, Anthropic |
| Storage | IPFS via Pinata |
| Frontend | Next.js, Tailwind CSS, MetaMask |
| Database | SQLite (async), Redis (job queue) |

---

## Project Structure

```
Aegistra/
├── backend/
│   ├── contracts/          # Solidity smart contracts + Hardhat config
│   │   └── src/
│   │       ├── EscrowContract.sol
│   │       ├── DisputeContract.sol
│   │       ├── JuryStaking.sol
│   │       └── EvidenceRegistry.sol
│   ├── oracle/             # Node.js bridge between chain and AI service
│   ├── ai-verification/    # FastAPI scoring engine
│   │   └── app/
│   │       ├── services/
│   │       │   ├── code_verifier.py
│   │       │   ├── document_verifier.py
│   │       │   └── agents/         # Agentic tools (pytest, pylint, flake8)
│   │       └── api/endpoints/
│   └── governance/         # Governance API (FastAPI)
└── frontend/               # Next.js app (Client / Freelancer / Jury views)
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| Python | ≥ 3.11 |
| MetaMask | Browser extension |
| Sepolia ETH | ≥ 0.1 ETH ([faucet](https://sepoliafaucet.com)) |

You will also need free accounts at:
- [Alchemy](https://alchemy.com) — RPC & WebSocket provider
- [Pinata](https://pinata.cloud) — IPFS pinning
- [Etherscan](https://etherscan.io/myapikey) — contract verification

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/sk00301/Aegistra.git
cd Aegistra

# 2. Set up environment variables
cp backend/.env.example backend/.env
# Fill in ALCHEMY_API_KEY, DEPLOYER_PRIVATE_KEY, PINATA keys, ETHERSCAN_API_KEY

# 3. Install contract dependencies
cd backend/contracts && npm install

# 4. Install oracle dependencies
cd ../oracle && npm install

# 5. Install AI verification dependencies
cd ../ai-verification
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 6. Install frontend dependencies
cd ../../frontend && npm install
```

### Deploy Contracts

```bash
cd backend/contracts
npx hardhat compile
npm run deploy        # deploys to Sepolia + auto-syncs addresses to frontend
```

### Run All Services

Open four terminal tabs:

```bash
# Tab 1 — AI Verification Service
cd backend/ai-verification && source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Tab 2 — Oracle
cd backend/oracle && node oracle.js

# Tab 3 — Frontend
cd frontend && npm run dev

# Tab 4 — (Optional) Contract tests
cd backend/contracts && npx hardhat test
```

Open **http://localhost:3000** with MetaMask set to Sepolia.

---

## Smart Contract State Machine

```
CREATED → FUNDED → SUBMITTED → VERIFIED  → RELEASED
                             → REJECTED  → (resubmit)
                             → DISPUTED  → RESOLVED
          FUNDED  → REFUNDED  (deadline passed, no submission)
```

---

## Dispute Resolution

When a submission scores between 45–74%, the dispute flow activates:

1. Jury members stake ETH via `JuryStaking.sol` to register
2. A 3-juror panel reviews the evidence (stored on IPFS via `EvidenceRegistry.sol`)
3. Each juror casts a vote on-chain
4. After all votes, anyone can call **Tally Votes & Close** to resolve
5. The majority verdict determines payment outcome; jurors earn rewards

---

## Environment Variables

All backend services share a single `backend/.env` file:

```env
ALCHEMY_API_KEY=
ALCHEMY_RPC_URL=
ALCHEMY_WS_URL=
DEPLOYER_PRIVATE_KEY=
ORACLE_PRIVATE_KEY=
ORACLE_ADDRESS=
PINATA_API_KEY=
PINATA_SECRET_KEY=
ETHERSCAN_API_KEY=

# LLM (choose one: ollama / openai / anthropic)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_API_KEY=          # optional
ANTHROPIC_API_KEY=       # optional
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Contracts not initialised" in frontend | Switch MetaMask to Sepolia |
| Oracle: "AI service unreachable" | Start the FastAPI service first (Tab 1) |
| Oracle: "oracle address not authorised" | Redeploy with correct `ORACLE_ADDRESS` in `.env` |
| IPFS upload returns synthetic CID | Add `PINATA_API_KEY` + `PINATA_SECRET_KEY` to `.env` |
| `pip install` fails "externally managed" | Add `--break-system-packages` flag |
| MetaMask "nonce too high" | Settings → Advanced → Clear activity tab |

---

## License

MIT
