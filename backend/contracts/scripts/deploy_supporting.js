const { ethers, network, run } = require("hardhat");

/**
 * deploy_supporting.js
 * Deploys EvidenceRegistry, DisputeContract, and JuryStaking in dependency order.
 *
 * Prerequisites in .env:
 *   ESCROW_CONTRACT_ADDRESS — address of already-deployed EscrowContract
 *
 * Deployment order (each contract needs the previous):
 *   1. EvidenceRegistry  (needs EscrowContract address)
 *   2. JuryStaking       (needs DisputeContract address — deployed next)
 *   3. DisputeContract   (needs EscrowContract + JuryStaking addresses)
 *
 * Because DisputeContract and JuryStaking reference each other, we:
 *   - Deploy JuryStaking with a placeholder, then update after DisputeContract is deployed
 *
 * Usage:
 *   npx hardhat run scripts/deploy_supporting.js --network sepolia
 */
async function main() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  Supporting Contracts Deployment");
  console.log(`  Network: ${network.name}`);
  console.log("══════════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance: ", ethers.formatEther(balance), "ETH\n");

  const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!escrowAddress || escrowAddress === "") {
    throw new Error(
      "ESCROW_CONTRACT_ADDRESS not set in .env\n" +
      "Run deploy_escrow.js first and copy the address."
    );
  }
  console.log("EscrowContract address:", escrowAddress);

  // ── 1. Deploy EvidenceRegistry ─────────────────────────────────────────────

  console.log("\n[1/3] Deploying EvidenceRegistry...");
  const EvidenceRegistry = await ethers.getContractFactory("EvidenceRegistry");
  const registry = await EvidenceRegistry.deploy(escrowAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("✅ EvidenceRegistry:", registryAddress);

  // ── 2. Deploy JuryStaking with placeholder DisputeContract ────────────────

  console.log("\n[2/3] Deploying JuryStaking (placeholder dispute address)...");
  const JuryStaking = await ethers.getContractFactory("JuryStaking");
  const jury = await JuryStaking.deploy(deployer.address); // placeholder
  await jury.waitForDeployment();
  const juryAddress = await jury.getAddress();
  console.log("✅ JuryStaking:", juryAddress);

  // ── 3. Deploy DisputeContract ──────────────────────────────────────────────

  console.log("\n[3/3] Deploying DisputeContract...");
  const DisputeContract = await ethers.getContractFactory("DisputeContract");
  const dispute = await DisputeContract.deploy(escrowAddress, juryAddress);
  await dispute.waitForDeployment();
  const disputeAddress = await dispute.getAddress();
  console.log("✅ DisputeContract:", disputeAddress);

  // ── 4. Wire JuryStaking to real DisputeContract ───────────────────────────

  console.log("\n🔗 Wiring JuryStaking -> DisputeContract...");
  const wireTx = await jury.setDisputeContract(disputeAddress);
  await wireTx.wait();
  console.log("✅ JuryStaking.disputeContract updated to:", disputeAddress);

  // ── 5. Update EscrowContract to point to DisputeContract ──────────────────

  console.log("\n📋 Manual step required:");
  console.log(
    "   Call EscrowContract.setJuryContractAddress(" + disputeAddress + ")"
  );
  console.log(
    "   This authorises DisputeContract to call resolveDispute() on EscrowContract"
  );

  // ── Etherscan verification (Sepolia only) ─────────────────────────────────

  if (network.name === "sepolia") {
    console.log("\n⏳ Waiting 30s for Etherscan to index...");
    await new Promise((r) => setTimeout(r, 30_000));

    const contracts = [
      { name: "EvidenceRegistry", address: registryAddress, args: [escrowAddress] },
      { name: "JuryStaking",      address: juryAddress,      args: [disputeAddress] },
      { name: "DisputeContract",  address: disputeAddress,   args: [escrowAddress, juryAddress] },
    ];

    for (const c of contracts) {
      console.log(`\nVerifying ${c.name}...`);
      try {
        await run("verify:verify", {
          address: c.address,
          constructorArguments: c.args,
        });
        console.log(`✅ ${c.name} verified`);
      } catch (err) {
        if (err.message.includes("Already Verified")) {
          console.log(`ℹ️  ${c.name} already verified`);
        } else {
          console.log(`⚠️  ${c.name} verification failed: ${err.message}`);
        }
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT SUMMARY");
  console.log("══════════════════════════════════════════════════");
  console.log(`  EscrowContract    : ${escrowAddress}   (existing)`);
  console.log(`  EvidenceRegistry  : ${registryAddress}`);
  console.log(`  DisputeContract   : ${disputeAddress}`);
  console.log(`  JuryStaking       : ${juryAddress}`);
  console.log("══════════════════════════════════════════════════");
  console.log("\n  📋 Add these to your .env and frontend config:");
  console.log(`  EVIDENCE_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`  DISPUTE_CONTRACT_ADDRESS=${disputeAddress}`);
  console.log(`  JURY_STAKING_ADDRESS=${juryAddress}`);
  console.log("\n  📋 Then call on EscrowContract:");
  console.log(`  setJuryContractAddress("${disputeAddress}")`);
  console.log("══════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Deployment failed:", err);
    process.exit(1);
  });
