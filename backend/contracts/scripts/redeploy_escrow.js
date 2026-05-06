const { ethers, network, run } = require("hardhat");
const fs   = require("fs");
const path = require("path");

/**
 * redeploy_escrow.js
 * ──────────────────
 * Safely redeploys ONLY EscrowContract, then rewires DisputeContract and
 * EvidenceRegistry to point at the new address. No other contracts are touched.
 *
 * Prerequisites — set these in backend/.env:
 *   DEPLOYER_PRIVATE_KEY       — wallet that owns the contracts (pays gas)
 *   ALCHEMY_API_KEY            — Alchemy Sepolia RPC
 *   ETHERSCAN_API_KEY          — for automatic Etherscan verification
 *   ORACLE_ADDRESS             — oracle signer wallet address
 *   JURY_CONTRACT_ADDRESS      — existing JuryStaking address (from deployedAddresses.json)
 *   DISPUTE_CONTRACT_ADDRESS   — existing DisputeContract address
 *   EVIDENCE_REGISTRY_ADDRESS  — existing EvidenceRegistry address
 *
 * Usage:
 *   cd backend/contracts
 *   npx hardhat run scripts/redeploy_escrow.js --network sepolia
 */

const DEPLOYED_FILE      = path.resolve(__dirname, "..", "deployedAddresses.json");
const FRONTEND_ADDRESSES = path.resolve(__dirname, "..", "..", "..", "frontend", "contracts", "addresses.json");
const BACKEND_ENV        = path.resolve(__dirname, "..", "..", ".env");

async function main() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  EscrowContract — Safe Redeploy");
  console.log(`  Network: ${network.name}`);
  console.log("══════════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address :", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance :", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n && network.name !== "hardhat") {
    throw new Error("Deployer wallet is empty. Top up at https://sepoliafaucet.com");
  }

  // ── Resolve addresses from env (fall back to deployedAddresses.json) ────────

  let existingAddrs = {};
  if (fs.existsSync(DEPLOYED_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8"));
    existingAddrs = raw.contracts ?? raw;
  }

  const oracleAddress = process.env.ORACLE_ADDRESS || existingAddrs.oracle || deployer.address;
  const juryAddress   = process.env.JURY_CONTRACT_ADDRESS    || existingAddrs.JuryStaking;
  const disputeAddr   = process.env.DISPUTE_CONTRACT_ADDRESS || existingAddrs.DisputeContract;
  const evidenceAddr  = process.env.EVIDENCE_REGISTRY_ADDRESS || existingAddrs.EvidenceRegistry;

  if (!juryAddress)   throw new Error("JURY_CONTRACT_ADDRESS not set and not found in deployedAddresses.json");
  if (!disputeAddr)   throw new Error("DISPUTE_CONTRACT_ADDRESS not set and not found in deployedAddresses.json");
  if (!evidenceAddr)  throw new Error("EVIDENCE_REGISTRY_ADDRESS not set and not found in deployedAddresses.json");

  console.log("Existing addresses (unchanged):");
  console.log("  JuryStaking      :", juryAddress);
  console.log("  DisputeContract  :", disputeAddr);
  console.log("  EvidenceRegistry :", evidenceAddr);
  console.log("  Oracle           :", oracleAddress);
  console.log();

  // ── [1/4] Deploy new EscrowContract ──────────────────────────────────────────

  console.log("[1/4] Deploying new EscrowContract...");
  const EscrowFactory = await ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowFactory.deploy(oracleAddress, juryAddress);
  await escrow.waitForDeployment();
  const newEscrowAddress = await escrow.getAddress();
  console.log("✅ New EscrowContract:", newEscrowAddress);

  if (network.name === "sepolia") {
    console.log("   Etherscan:", `https://sepolia.etherscan.io/address/${newEscrowAddress}`);
  }

  // ── [2/4] Rewire DisputeContract → new EscrowContract ────────────────────────

  console.log("\n[2/4] Updating DisputeContract.setEscrowContract()...");
  const disputeABI = ["function setEscrowContract(address _newEscrow) external"];
  const disputeContract = new ethers.Contract(disputeAddr, disputeABI, deployer);
  const tx1 = await disputeContract.setEscrowContract(newEscrowAddress);
  await tx1.wait();
  console.log("✅ DisputeContract rewired. Tx:", tx1.hash);

  // ── [3/4] Rewire EvidenceRegistry → new EscrowContract ───────────────────────

  console.log("\n[3/4] Updating EvidenceRegistry.setEscrowContract()...");
  const evidenceABI = ["function setEscrowContract(address _newEscrow) external"];
  const evidenceRegistry = new ethers.Contract(evidenceAddr, evidenceABI, deployer);
  const tx2 = await evidenceRegistry.setEscrowContract(newEscrowAddress);
  await tx2.wait();
  console.log("✅ EvidenceRegistry rewired. Tx:", tx2.hash);

  // ── [4/4] Etherscan verification ──────────────────────────────────────────────

  if (network.name === "sepolia") {
    console.log("\n[4/4] Waiting 30s for Etherscan to index...");
    await new Promise((r) => setTimeout(r, 30_000));

    try {
      await run("verify:verify", {
        address: newEscrowAddress,
        constructorArguments: [oracleAddress, juryAddress],
      });
      console.log("✅ Contract verified on Etherscan!");
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log("ℹ️  Already verified.");
      } else {
        console.warn("⚠️  Auto-verification failed:", err.message);
        console.log("   Run manually:");
        console.log(`   npx hardhat verify --network sepolia ${newEscrowAddress} "${oracleAddress}" "${juryAddress}"`);
      }
    }
  }

  // ── Update deployedAddresses.json ─────────────────────────────────────────────

  const updatedDeployed = {
    ...(fs.existsSync(DEPLOYED_FILE) ? JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf8")) : {}),
    EscrowContract: newEscrowAddress,
  };
  fs.writeFileSync(DEPLOYED_FILE, JSON.stringify(updatedDeployed, null, 2));
  console.log("\n✅ deployedAddresses.json updated");

  // ── Update frontend addresses.json ────────────────────────────────────────────

  if (fs.existsSync(FRONTEND_ADDRESSES)) {
    const front = JSON.parse(fs.readFileSync(FRONTEND_ADDRESSES, "utf8"));
    front.EscrowContract = newEscrowAddress;
    fs.writeFileSync(FRONTEND_ADDRESSES, JSON.stringify(front, null, 2));
    console.log("✅ frontend/contracts/addresses.json updated");
  } else {
    console.warn("⚠️  frontend/contracts/addresses.json not found — update manually");
  }

  // ── Patch backend/.env ────────────────────────────────────────────────────────

  if (fs.existsSync(BACKEND_ENV)) {
    let envContent = fs.readFileSync(BACKEND_ENV, "utf8");
    const regex = /^ESCROW_CONTRACT_ADDRESS=.*$/m;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `ESCROW_CONTRACT_ADDRESS=${newEscrowAddress}`);
    } else {
      envContent += `\nESCROW_CONTRACT_ADDRESS=${newEscrowAddress}`;
    }
    fs.writeFileSync(BACKEND_ENV, envContent);
    console.log("✅ backend/.env updated");
  } else {
    console.warn("⚠️  backend/.env not found — update ESCROW_CONTRACT_ADDRESS manually");
  }

  // ── Final summary ──────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════════════");
  console.log("  REDEPLOY COMPLETE");
  console.log("══════════════════════════════════════════════════");
  console.log(`  New EscrowContract : ${newEscrowAddress}`);
  console.log(`  DisputeContract    : ${disputeAddr}  (unchanged)`);
  console.log(`  EvidenceRegistry   : ${evidenceAddr}  (unchanged)`);
  console.log(`  JuryStaking        : ${juryAddress}   (unchanged)`);
  console.log("══════════════════════════════════════════════════");
  console.log("\n  📋 Next steps:");
  console.log("  1. Restart oracle.js   (picks up new ESCROW_CONTRACT_ADDRESS from .env)");
  console.log("  2. Restart the frontend dev server   (picks up new addresses.json)");
  console.log("  3. Copy the new ABI if the contract interface changed:");
  console.log("     artifacts/src/EscrowContract.sol/EscrowContract.json");
  console.log("     → frontend/contracts/abis/EscrowContract.json");
  console.log("══════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Redeploy failed:", err);
    process.exit(1);
  });
