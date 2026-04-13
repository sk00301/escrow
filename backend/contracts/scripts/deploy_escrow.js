const { ethers, network, run } = require("hardhat");

/**
 * Deployment script for EscrowContract.
 *
 * Usage:
 *   Local:   npx hardhat run scripts/deploy_escrow.js
 *   Sepolia: npx hardhat run scripts/deploy_escrow.js --network sepolia
 *
 * Required .env variables:
 *   DEPLOYER_PRIVATE_KEY  — wallet that pays deployment gas
 *   ALCHEMY_API_KEY       — Alchemy Sepolia RPC key
 *   ETHERSCAN_API_KEY     — for automatic contract verification
 *
 * Optional .env variables (if not set, deployer address is used as placeholder):
 *   ORACLE_ADDRESS        — address of the Node.js oracle signer wallet
 *   JURY_CONTRACT_ADDRESS — address of the already-deployed JuryStaking contract
 *                           (for the prototype you can use any address and update later)
 */
async function main() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  EscrowContract Deployment");
  console.log(`  Network: ${network.name}`);
  console.log("══════════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address :", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance :", ethers.formatEther(balance), "ETH\n");

  if (balance === 0n && network.name !== "hardhat") {
    throw new Error(
      "Deployer wallet has no ETH.\n" +
      "Get Sepolia test ETH from: https://sepoliafaucet.com"
    );
  }

  // ── Resolve constructor arguments ────────────────────────────────────────

  // For the prototype, if no oracle/jury address is provided in .env,
  // we use the deployer address as a placeholder so deployment succeeds.
  // You can update these later via setOracleAddress() / setJuryContractAddress().
  const oracleAddress =
    process.env.ORACLE_ADDRESS && process.env.ORACLE_ADDRESS !== ""
      ? process.env.ORACLE_ADDRESS
      : deployer.address;

  const juryContractAddress =
    process.env.JURY_CONTRACT_ADDRESS && process.env.JURY_CONTRACT_ADDRESS !== ""
      ? process.env.JURY_CONTRACT_ADDRESS
      : deployer.address;

  console.log("Oracle address        :", oracleAddress);
  console.log("Jury contract address :", juryContractAddress);
  console.log();

  // ── Deploy ───────────────────────────────────────────────────────────────

  console.log("Deploying EscrowContract...");
  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy(oracleAddress, juryContractAddress);
  await escrow.waitForDeployment();

  const contractAddress = await escrow.getAddress();
  console.log("\n✅ EscrowContract deployed!");
  console.log("   Contract address :", contractAddress);

  if (network.name === "sepolia") {
    console.log(
      "   Etherscan        : " +
      `https://sepolia.etherscan.io/address/${contractAddress}`
    );
  }

  // ── Verify on Etherscan (Sepolia only) ───────────────────────────────────

  if (network.name === "sepolia") {
    console.log("\n⏳ Waiting 30s for Etherscan to index the deployment...");
    await new Promise((r) => setTimeout(r, 30_000));

    console.log("Submitting source code for verification...");
    try {
      await run("verify:verify", {
        address: contractAddress,
        constructorArguments: [oracleAddress, juryContractAddress],
      });
      console.log("✅ Contract verified on Etherscan!");
    } catch (err) {
      if (err.message.includes("Already Verified")) {
        console.log("ℹ️  Contract already verified.");
      } else {
        console.error("⚠️  Verification failed:", err.message);
        console.log("   Run manually:");
        console.log(
          `   npx hardhat verify --network sepolia ${contractAddress} ` +
          `"${oracleAddress}" "${juryContractAddress}"`
        );
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT SUMMARY");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Network          : ${network.name}`);
  console.log(`  EscrowContract   : ${contractAddress}`);
  console.log(`  Oracle address   : ${oracleAddress}`);
  console.log(`  Jury address     : ${juryContractAddress}`);
  console.log("══════════════════════════════════════════════════");
  console.log("\n  📋 Next steps:");
  console.log("  1. Copy EscrowContract address to your frontend .env");
  console.log("  2. Copy the ABI from artifacts/src/EscrowContract.sol/EscrowContract.json");
  console.log("  3. Update ORACLE_ADDRESS in .env with your oracle wallet address");
  console.log("  4. Deploy JuryStaking.sol and call setJuryContractAddress()");
  console.log("══════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Deployment failed:", err);
    process.exit(1);
  });
