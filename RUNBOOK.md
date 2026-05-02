# EscrowChain — Full Platform Runbook

> Every command needed to go from a fresh clone to a running platform.
> Run each section in a **separate terminal tab**.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| Python | ≥ 3.11 | https://python.org |
| pip | bundled with Python | — |
| Git | any | — |
| MetaMask | browser extension | https://metamask.io |

You will also need:
- An **Alchemy** account (free) → https://alchemy.com  
- A **Pinata** account (free) → https://pinata.cloud  
- A **Sepolia testnet wallet** with at least 0.1 ETH  
  (Faucet: https://sepoliafaucet.com)
- An **Etherscan API key** (free) → https://etherscan.io/myapikey

---

## Step 0 — Environment setup (do this once)

```bash
# From the repo root
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in every value in Sections 1–4:

```
ALCHEMY_API_KEY=...
ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ALCHEMY_WS_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_KEY

DEPLOYER_PRIVATE_KEY=0x...   # testnet only wallet
ORACLE_PRIVATE_KEY=0x...     # can be same as deployer for testing
ORACLE_ADDRESS=0x...         # public address of ORACLE_PRIVATE_KEY

PINATA_API_KEY=...
PINATA_SECRET=...
PINATA_SECRET_KEY=...        # same value as PINATA_SECRET

ETHERSCAN_API_KEY=...
```

Leave all other values at their defaults for local development.

---

## Step 1 — Install dependencies

### 1a. Contracts

```bash
cd backend/contracts
npm install
```

### 1b. Oracle

```bash
cd backend/oracle
npm install
```

### 1c. AI Verification (Python)

```bash
cd backend/ai-verification

# Create a virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 1d. Frontend

```bash
cd frontend
npm install
```

---

## Step 2 — Deploy smart contracts

> Skip this if you are using the already-deployed Sepolia addresses
> that are in `frontend/contracts/addresses.json`.

```bash
cd backend/contracts

# Compile contracts first
npx hardhat compile

# Deploy to Sepolia (takes ~2 min — Etherscan verification included)
npm run deploy
# equivalent: npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script automatically:
- Writes `backend/contracts/deployedAddresses.json`
- Syncs addresses to `frontend/contracts/addresses.json`
- Updates `ESCROW_CONTRACT_ADDRESS` etc. in `backend/.env`

If the auto-sync fails for any reason, run it manually:

```bash
cd backend/contracts
npm run sync
# equivalent: node scripts/sync-addresses.js
```

### Local Hardhat network (optional, for testing without Sepolia)

```bash
# Terminal A — start local node
cd backend/contracts
npm run node
# equivalent: npx hardhat node

# Terminal B — deploy to local node
cd backend/contracts
npm run deploy:local
# equivalent: npx hardhat run scripts/deploy.js --network localhost
```

---

## Step 3 — Run all services

Open four terminal tabs and run one command per tab.

### Tab 1 — AI Verification Service (FastAPI)

```bash
cd backend/ai-verification
source .venv/bin/activate          # Windows: .venv\Scripts\activate

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check it's running:
```
http://localhost:8000/health        → { "status": "ok" }
http://localhost:8000/docs          → Swagger UI (all endpoints)
```

### Tab 2 — Oracle Bridge (Node.js)

```bash
cd backend/oracle
node oracle.js
```

Check it's running:
```
http://localhost:3001/oracle/status → JSON status object
http://localhost:3001/oracle/health → "OK"
```

The oracle:
- Listens to `WorkSubmitted` events on the EscrowContract via WebSocket
- Calls `POST http://localhost:8000/verify` when a freelancer submits work
- Polls `GET http://localhost:8000/result/{job_id}` until the AI finishes
- Signs the result and calls `EscrowContract.postVerificationResult()` on-chain

### Tab 3 — Frontend (Next.js)

```bash
cd frontend
npm run dev
```

Open: **http://localhost:3000**

### Tab 4 — (Optional) Run contract tests

```bash
cd backend/contracts
npx hardhat test
```

---

## Step 4 — First-time walkthrough

1. Open http://localhost:3000 in a browser that has MetaMask
2. Switch MetaMask to **Sepolia testnet**
3. Click **Connect Wallet** in the navbar
4. In the top-right pill, switch to **Client** mode
5. Go to **Client → Post Milestone**
6. Fill in: title, freelancer wallet address (any Sepolia address), amount, deadline
7. Optionally upload an SRS `.md` or `.pdf`
8. Click **Fund Escrow** and confirm the two MetaMask transactions (create + fund)
9. Switch MetaMask to the **freelancer wallet**
10. Switch the role pill to **Freelancer**
11. Your funded milestone appears in **Freelancer → Available Jobs**
12. Go to **Freelancer → Active Contracts**, click **Submit Work**, attach a file
13. Confirm the MetaMask transaction — this emits `WorkSubmitted` on-chain
14. **Oracle automatically picks up the event** and calls the AI verification service
15. After ~30 seconds, the milestone status updates to `verified`, `disputed`, or `rejected`
    - `verified` (score ≥ 75) → Client can click **Release Payment**
    - `disputed` (score 45–74) → Jury pool is activated
    - `rejected` (score < 45) → Freelancer can resubmit (once deadline allows)
16. For a **disputed** milestone:
    - Switch role to **Jury** with a staked juror wallet
    - Stake ETH: **Jury → Overview → Stake as Juror**
    - Go to **Jury → Open Disputes** to review evidence and cast your vote
    - After all 3 jurors vote, click **Tally Votes & Close**

---

## Environment variables — quick reference

```
backend/.env          ← single source of truth for all backend services
frontend/.env.local   ← NEXT_PUBLIC_API_URL=http://localhost:8000 (already set)
```

The oracle, AI service, and Hardhat all load from `backend/.env` via a relative
`../`.env` path set in each module's dotenv initialisation.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Contracts not initialised" in frontend | Wrong network in MetaMask | Switch to Sepolia |
| Oracle logs "AI service unreachable" | FastAPI not running | Start Tab 1 first |
| Oracle logs "oracle address not authorised" | `ORACLE_ADDRESS` in deploy doesn't match `ORACLE_PRIVATE_KEY` | Redeploy with correct `ORACLE_ADDRESS` |
| Oracle always uses mock result | status `COMPLETE` vs `COMPLETED` mismatch | Fixed — pull latest |
| Frontend shows stale contract addresses | Redeployed but didn't sync | Run `npm run sync` in `backend/contracts` |
| `pip install` fails with "externally managed" | Ubuntu 23+ Python | Add `--break-system-packages` flag |
| IPFS upload returns synthetic CID | Pinata keys not set | Add `PINATA_API_KEY` + `PINATA_SECRET_KEY` to `backend/.env` |
| MetaMask "nonce too high" | Hardhat local chain reset | Reset MetaMask account: Settings → Advanced → Clear activity |

---

## Production deployment (summary)

```bash
# Frontend — Vercel
cd frontend
npx vercel --prod
# Set NEXT_PUBLIC_API_URL to your FastAPI server's public URL in Vercel env vars

# AI Verification — any VPS or cloud
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# Oracle — PM2 process manager
cd backend/oracle
npx pm2 start ecosystem.config.js
npx pm2 save
npx pm2 startup   # follow the printed command to enable on boot
```
