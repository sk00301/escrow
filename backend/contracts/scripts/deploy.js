const { ethers, network, run } = require("hardhat");
const fs   = require("fs");
const path = require("path");

/**
 * deploy.js — Master deployment script
 * Deploys all four contracts in dependency order, wires cross-contract
 * references, saves addresses to deployedAddresses.json, and verifies
 * all contracts on Sepolia Etherscan.
 *
 * Dependency order:
 *   1. JuryStaking       (needs DisputeContract — placeholder first)
 *   2. EscrowContract    (needs oracle address + jury placeholder)
 *   3. EvidenceRegistry  (needs EscrowContract)
 *   4. DisputeContract   (needs EscrowContract + JuryStaking)
 *   5. Wire all cross-references
 *
 * Required .env:
 *   ALCHEMY_API_KEY, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY
 *   ORACLE_ADDRESS   (your Node.js oracle wallet address — defaults to deployer)
 */

const ADDRESSES_FILE = path.join(__dirname, "..", "deployedAddresses.json");

async function main() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║         ESCROW PLATFORM — FULL DEPLOYMENT        ║");
  console.log(`║  Network: ${network.name.padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance  :", ethers.formatEther(balance), "ETH");

  if (balance < ethers.parseEther("0.05") && network.name !== "hardhat") {
    console.warn("\n⚠️  Low balance warning: < 0.05 ETH may not cover deployment gas.");
  }

  const oracleAddress = process.env.ORACLE_ADDRESS && process.env.ORACLE_ADDRESS !== ""
    ? process.env.ORACLE_ADDRESS
    : deployer.address;

  console.log("Oracle   :", oracleAddress);
  console.log();

  const deployed = {};

  // ── 1. Deploy JuryStaking with placeholder ─────────────────────────────────
  deployed.JuryStaking = await deployContract("JuryStaking", [deployer.address]);

  // ── 2. Deploy EscrowContract ───────────────────────────────────────────────
  deployed.EscrowContract = await deployContract("EscrowContract", [
    oracleAddress,
    deployed.JuryStaking,   // placeholder — updated after DisputeContract
  ]);

  // ── 3. Deploy EvidenceRegistry ─────────────────────────────────────────────
  deployed.EvidenceRegistry = await deployContract("EvidenceRegistry", [
    deployed.EscrowContract,
  ]);

  // ── 4. Deploy DisputeContract ──────────────────────────────────────────────
  deployed.DisputeContract = await deployContract("DisputeContract", [
    deployed.EscrowContract,
    deployed.JuryStaking,
  ]);

  // ── 5. Wire all cross-references ───────────────────────────────────────────
  console.log("🔗 Wiring cross-contract references...\n");

  const juryContract   = await ethers.getContractAt("JuryStaking",    deployed.JuryStaking);
  const escrowContract = await ethers.getContractAt("EscrowContract", deployed.EscrowContract);

  // JuryStaking → real DisputeContract (replace placeholder)
  let tx = await juryContract.setDisputeContract(deployed.DisputeContract);
  await tx.wait();
  console.log("   ✅ JuryStaking.disputeContract     →", deployed.DisputeContract);

  // EscrowContract → real DisputeContract as jury caller
  tx = await escrowContract.setJuryContractAddress(deployed.DisputeContract);
  await tx.wait();
  console.log("   ✅ EscrowContract.juryContract      →", deployed.DisputeContract);

  console.log("\n   All cross-references wired.\n");

  // ── 6. Save addresses to JSON ──────────────────────────────────────────────
  const output = {
    network:          network.name,
    deployedAt:       new Date().toISOString(),
    deployer:         deployer.address,
    oracle:           oracleAddress,
    contracts: {
      EscrowContract:   deployed.EscrowContract,
      EvidenceRegistry: deployed.EvidenceRegistry,
      DisputeContract:  deployed.DisputeContract,
      JuryStaking:      deployed.JuryStaking,
    },
    etherscan: {
      EscrowContract:   `https://sepolia.etherscan.io/address/${deployed.EscrowContract}`,
      EvidenceRegistry: `https://sepolia.etherscan.io/address/${deployed.EvidenceRegistry}`,
      DisputeContract:  `https://sepolia.etherscan.io/address/${deployed.DisputeContract}`,
      JuryStaking:      `https://sepolia.etherscan.io/address/${deployed.JuryStaking}`,
    },
  };

  fs.writeFileSync(ADDRESSES_FILE, JSON.stringify(output, null, 2));
  console.log(`📄 Addresses saved to: deployedAddresses.json\n`);

  // ── 7. Etherscan verification (Sepolia only) ───────────────────────────────
  if (network.name === "sepolia") {
    console.log("⏳ Waiting 45s for Etherscan to index all contracts...");
    await new Promise((r) => setTimeout(r, 45_000));

    const verifyList = [
      {
        name: "EscrowContract",
        address: deployed.EscrowContract,
        args: [oracleAddress, deployed.DisputeContract],
        // Note: EscrowContract was initially deployed with JuryStaking as jury,
        // but we setJuryContractAddress() after. Verify with ORIGINAL constructor args.
        constructorArgsNote: "original deploy args",
      },
      {
        name: "EvidenceRegistry",
        address: deployed.EvidenceRegistry,
        args: [deployed.EscrowContract],
      },
      {
        name: "DisputeContract",
        address: deployed.DisputeContract,
        args: [deployed.EscrowContract, deployed.JuryStaking],
      },
      {
        name: "JuryStaking",
        address: deployed.JuryStaking,
        // JuryStaking was deployed with deployer as placeholder but
        // verify with the real DisputeContract (Etherscan only checks bytecode)
        args: [deployed.DisputeContract],
      },
    ];

    for (const c of verifyList) {
      await verifyContract(c.name, c.address, c.args);
    }
  }

  // ── 8. Final summary ───────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║               DEPLOYMENT SUMMARY                ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Network          : ${network.name}`);
  console.log(`  EscrowContract   : ${deployed.EscrowContract}`);
  console.log(`  EvidenceRegistry : ${deployed.EvidenceRegistry}`);
  console.log(`  DisputeContract  : ${deployed.DisputeContract}`);
  console.log(`  JuryStaking      : ${deployed.JuryStaking}`);
  console.log(`  Oracle address   : ${oracleAddress}`);
  console.log();
  console.log("  📋 Add to your frontend .env:");
  console.log(`  VITE_ESCROW_ADDRESS=${deployed.EscrowContract}`);
  console.log(`  VITE_REGISTRY_ADDRESS=${deployed.EvidenceRegistry}`);
  console.log(`  VITE_DISPUTE_ADDRESS=${deployed.DisputeContract}`);
  console.log(`  VITE_JURY_ADDRESS=${deployed.JuryStaking}`);
  console.log();
  console.log("  📋 Add to your oracle .env:");
  console.log(`  ESCROW_CONTRACT_ADDRESS=${deployed.EscrowContract}`);
  console.log(`  EVIDENCE_REGISTRY_ADDRESS=${deployed.EvidenceRegistry}`);
  console.log("════════════════════════════════════════════════════\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function deployContract(name, args) {
  process.stdout.write(`Deploying ${name}... `);
  const Factory  = await ethers.getContractFactory(name);
  const contract = await Factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`✅ ${address}`);
  return address;
}

async function verifyContract(name, address, constructorArguments) {
  process.stdout.write(`Verifying ${name}... `);
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log("✅ Verified");
  } catch (err) {
    if (err.message.includes("Already Verified") || err.message.includes("already verified")) {
      console.log("ℹ️  Already verified");
    } else {
      console.log(`⚠️  Failed: ${err.message}`);
      console.log(`   Manual: npx hardhat verify --network sepolia ${address} ${constructorArguments.map(a => `"${a}"`).join(" ")}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Deployment failed:", err);
    process.exit(1);
  });
