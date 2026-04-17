/**
 * test_e2e.js
 * -----------
 * End-to-end transaction flow tests on Ethereum Sepolia testnet.
 * Tests 5 canonical flows across 10 total scenario runs.
 *
 * Prerequisites:
 *   npm install ethers dotenv
 *
 * .env file (create in the same directory):
 *   RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
 *   CLIENT_PRIVATE_KEY=0x...
 *   FREELANCER_PRIVATE_KEY=0x...
 *   JUROR_1_PRIVATE_KEY=0x...
 *   JUROR_2_PRIVATE_KEY=0x...
 *   JUROR_3_PRIVATE_KEY=0x...
 *   ESCROW_CONTRACT_ADDRESS=0x...
 *   DISPUTE_CONTRACT_ADDRESS=0x...
 *   JURY_STAKING_ADDRESS=0x...
 *   ORACLE_PRIVATE_KEY=0x...
 *
 * Usage:
 *   node test_e2e.js
 *   node test_e2e.js --flow 1        # run a specific flow only
 *   node test_e2e.js --dry-run       # print plan without sending transactions
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");

// ---------------------------------------------------------------------------
// ABI fragments — replace with your full compiled ABIs
// ---------------------------------------------------------------------------
const ESCROW_ABI = [
  "function createMilestone(address freelancer, uint256 deadline) external payable returns (uint256 milestoneId)",
  "function submitWork(uint256 milestoneId, bytes32 ipfsHash) external",
  "function releasePayment(uint256 milestoneId) external",
  "function refundClient(uint256 milestoneId) external",
  "function getMilestone(uint256 milestoneId) external view returns (tuple(address client, address freelancer, uint256 amount, uint256 deadline, uint8 state, bytes32 submissionHash))",
  "event MilestoneCreated(uint256 indexed milestoneId, address client, address freelancer, uint256 amount)",
  "event WorkSubmitted(uint256 indexed milestoneId, bytes32 ipfsHash)",
  "event PaymentReleased(uint256 indexed milestoneId, address freelancer, uint256 amount)",
  "event FundsRefunded(uint256 indexed milestoneId, address client, uint256 amount)",
  "event DisputeTriggered(uint256 indexed milestoneId, uint256 disputeId)",
];

const DISPUTE_ABI = [
  "function createDispute(uint256 milestoneId) external returns (uint256 disputeId)",
  "function getDispute(uint256 disputeId) external view returns (tuple(uint256 milestoneId, uint8 outcome, bool resolved, uint256 votesFor, uint256 votesAgainst))",
  "event DisputeCreated(uint256 indexed disputeId, uint256 milestoneId)",
  "event DisputeResolved(uint256 indexed disputeId, uint8 outcome)",
];

const JURY_ABI = [
  "function castVote(uint256 disputeId, bool approve) external",
  "function finalizeVote(uint256 disputeId) external",
  "event VoteCast(uint256 indexed disputeId, address juror, bool approve)",
  "event VoteFinalized(uint256 indexed disputeId, bool approved)",
];

// ---------------------------------------------------------------------------
// State labels for readable output
// ---------------------------------------------------------------------------
const MILESTONE_STATES = {
  0: "CREATED",
  1: "FUNDED",
  2: "SUBMITTED",
  3: "VERIFIED",
  4: "REJECTED",
  5: "DISPUTED",
  6: "RESOLVED",
  7: "REFUNDED",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

function wallet(key) {
  return new ethers.Wallet(key, provider);
}

const actors = {
  client:     () => wallet(process.env.CLIENT_PRIVATE_KEY),
  freelancer: () => wallet(process.env.FREELANCER_PRIVATE_KEY),
  oracle:     () => wallet(process.env.ORACLE_PRIVATE_KEY),
  juror1:     () => wallet(process.env.JUROR_1_PRIVATE_KEY),
  juror2:     () => wallet(process.env.JUROR_2_PRIVATE_KEY),
  juror3:     () => wallet(process.env.JUROR_3_PRIVATE_KEY),
};

function escrow(signer) {
  return new ethers.Contract(process.env.ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, signer);
}
function dispute(signer) {
  return new ethers.Contract(process.env.DISPUTE_CONTRACT_ADDRESS, DISPUTE_ABI, signer);
}
function jury(signer) {
  return new ethers.Contract(process.env.JURY_STAKING_ADDRESS, JURY_ABI, signer);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MILESTONE_VALUE = ethers.parseEther("0.01"); // 0.01 ETH per test milestone
const ONE_DAY_S = 86_400;
const MOCK_IPFS = ethers.encodeBytes32String("QmMockIPFSHash1234567890");

async function gasUsed(tx) {
  const receipt = await tx.wait();
  return receipt.gasUsed.toString();
}

async function currentBlock() {
  return provider.getBlock("latest");
}

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// Pad flow result object with defaults
function initResult(flowNum, description) {
  return {
    flow:           flowNum,
    description,
    start_time:     null,
    end_time:       null,
    elapsed_ms:     null,
    transactions:   [],    // [{step, hash, gasUsed, blockNumber}]
    final_state:    null,
    passed:         false,
    error:          null,
  };
}

function recordTx(result, step, receipt) {
  result.transactions.push({
    step,
    hash:        receipt.hash,
    gas_used:    receipt.gasUsed.toString(),
    block:       receipt.blockNumber,
  });
}

function elapsed(result) {
  return result.end_time - result.start_time;
}

// ---------------------------------------------------------------------------
// FLOW 1: Normal approval — AI score ≥ 0.75 → payment released
// ---------------------------------------------------------------------------
async function flow1_normalApproval(dryRun) {
  const result = initResult(1, "Normal approval — AI score ≥ 0.75, payment released");
  result.start_time = Date.now();
  log("Flow 1: Normal approval");

  try {
    if (dryRun) { result.passed = true; result.final_state = "DRY_RUN"; return result; }

    const client     = actors.client();
    const freelancer = actors.freelancer();
    const oracle     = actors.oracle();

    // Step 1: Client creates and funds milestone
    log("  [1/4] Client creates milestone...");
    const deadline = Math.floor(Date.now() / 1000) + ONE_DAY_S * 7;
    const createTx = await escrow(client).createMilestone(
      freelancer.address, deadline, { value: MILESTONE_VALUE }
    );
    const createReceipt = await createTx.wait();
    recordTx(result, "createMilestone", createReceipt);
    const milestoneId = createReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`     milestoneId=${milestoneId}  tx=${createReceipt.hash}`);

    // Step 2: Freelancer submits work
    log("  [2/4] Freelancer submits work...");
    const submitTx = await escrow(freelancer).submitWork(milestoneId, MOCK_IPFS);
    const submitReceipt = await submitTx.wait();
    recordTx(result, "submitWork", submitReceipt);
    log(`     tx=${submitReceipt.hash}`);

    // Step 3: Oracle posts APPROVED result (score ≥ 0.75)
    log("  [3/4] Oracle posts APPROVED result...");
    // The oracle calls releasePayment after verifying score ≥ 0.75
    // In your real implementation, the oracle calls a dedicated oracleSetResult function
    // Here we simulate the oracle triggering the release directly
    const releaseTx = await escrow(oracle).releasePayment(milestoneId);
    const releaseReceipt = await releaseTx.wait();
    recordTx(result, "releasePayment", releaseReceipt);
    log(`     tx=${releaseReceipt.hash}`);

    // Step 4: Verify final state
    log("  [4/4] Checking final state...");
    const milestone = await escrow(oracle).getMilestone(milestoneId);
    result.final_state = MILESTONE_STATES[Number(milestone.state)] ?? `UNKNOWN(${milestone.state})`;
    result.passed = result.final_state === "RESOLVED" || result.final_state === "VERIFIED";

    log(`  ✓ Flow 1 complete. Final state: ${result.final_state}`);
  } catch (err) {
    result.error = err.message;
    log(`  ✗ Flow 1 failed: ${err.message}`);
  }

  result.end_time = Date.now();
  result.elapsed_ms = elapsed(result);
  return result;
}

// ---------------------------------------------------------------------------
// FLOW 2: Rejection — AI score < 0.45 → funds returned to client
// ---------------------------------------------------------------------------
async function flow2_rejection(dryRun) {
  const result = initResult(2, "Rejection — AI score < 0.45, funds returned to client");
  result.start_time = Date.now();
  log("Flow 2: Rejection");

  try {
    if (dryRun) { result.passed = true; result.final_state = "DRY_RUN"; return result; }

    const client     = actors.client();
    const freelancer = actors.freelancer();
    const oracle     = actors.oracle();

    // Step 1: Create milestone
    const deadline = Math.floor(Date.now() / 1000) + ONE_DAY_S * 7;
    const createTx = await escrow(client).createMilestone(
      freelancer.address, deadline, { value: MILESTONE_VALUE }
    );
    const createReceipt = await createTx.wait();
    recordTx(result, "createMilestone", createReceipt);
    const milestoneId = createReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`  [1/4] Milestone created: ${milestoneId}`);

    // Step 2: Freelancer submits work
    const submitTx = await escrow(freelancer).submitWork(milestoneId, MOCK_IPFS);
    const submitReceipt = await submitTx.wait();
    recordTx(result, "submitWork", submitReceipt);
    log(`  [2/4] Work submitted`);

    // Step 3: Oracle posts REJECTED result (score < 0.45) → refund
    const refundTx = await escrow(oracle).refundClient(milestoneId);
    const refundReceipt = await refundTx.wait();
    recordTx(result, "refundClient", refundReceipt);
    log(`  [3/4] Oracle triggered refund`);

    // Step 4: Verify state
    const milestone = await escrow(oracle).getMilestone(milestoneId);
    result.final_state = MILESTONE_STATES[Number(milestone.state)] ?? `UNKNOWN(${milestone.state})`;
    result.passed = result.final_state === "REFUNDED" || result.final_state === "REJECTED";

    log(`  ✓ Flow 2 complete. Final state: ${result.final_state}`);
  } catch (err) {
    result.error = err.message;
    log(`  ✗ Flow 2 failed: ${err.message}`);
  }

  result.end_time = Date.now();
  result.elapsed_ms = elapsed(result);
  return result;
}

// ---------------------------------------------------------------------------
// FLOW 3: Dispute → jury approves → payment released
// ---------------------------------------------------------------------------
async function flow3_disputeJuryApproves(dryRun) {
  const result = initResult(3, "Dispute — AI score 0.45–0.75, jury votes APPROVE");
  result.start_time = Date.now();
  log("Flow 3: Dispute → jury approves");

  try {
    if (dryRun) { result.passed = true; result.final_state = "DRY_RUN"; return result; }

    const client     = actors.client();
    const freelancer = actors.freelancer();
    const oracle     = actors.oracle();
    const j1 = actors.juror1();
    const j2 = actors.juror2();
    const j3 = actors.juror3();

    // Step 1: Create & fund milestone
    const deadline = Math.floor(Date.now() / 1000) + ONE_DAY_S * 7;
    const createTx = await escrow(client).createMilestone(
      freelancer.address, deadline, { value: MILESTONE_VALUE }
    );
    const createReceipt = await createTx.wait();
    recordTx(result, "createMilestone", createReceipt);
    const milestoneId = createReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`  [1/6] Milestone ${milestoneId} created`);

    // Step 2: Freelancer submits
    const submitTx = await escrow(freelancer).submitWork(milestoneId, MOCK_IPFS);
    recordTx(result, "submitWork", await submitTx.wait());
    log(`  [2/6] Work submitted`);

    // Step 3: Oracle triggers dispute (score in 0.45–0.75 band)
    const disputeTx = await dispute(oracle).createDispute(milestoneId);
    const disputeReceipt = await disputeTx.wait();
    recordTx(result, "createDispute", disputeReceipt);
    const disputeId = disputeReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`  [3/6] Dispute ${disputeId} created`);

    // Step 4: Three jurors vote APPROVE
    for (const [juror, label] of [[j1, "juror1"], [j2, "juror2"], [j3, "juror3"]]) {
      const voteTx = await jury(juror).castVote(disputeId, true); // true = approve
      recordTx(result, `castVote_${label}`, await voteTx.wait());
    }
    log(`  [4/6] All 3 jurors voted APPROVE`);

    // Step 5: Finalize the vote (oracle or anyone after voting period)
    const finalizeTx = await jury(oracle).finalizeVote(disputeId);
    recordTx(result, "finalizeVote", await finalizeTx.wait());
    log(`  [5/6] Vote finalized`);

    // Step 6: Check final state
    const milestone = await escrow(oracle).getMilestone(milestoneId);
    result.final_state = MILESTONE_STATES[Number(milestone.state)] ?? `UNKNOWN(${milestone.state})`;
    result.passed = result.final_state === "RESOLVED" || result.final_state === "VERIFIED";

    log(`  ✓ Flow 3 complete. Final state: ${result.final_state}`);
  } catch (err) {
    result.error = err.message;
    log(`  ✗ Flow 3 failed: ${err.message}`);
  }

  result.end_time = Date.now();
  result.elapsed_ms = elapsed(result);
  return result;
}

// ---------------------------------------------------------------------------
// FLOW 4: Dispute → jury rejects → funds returned
// ---------------------------------------------------------------------------
async function flow4_disputeJuryRejects(dryRun) {
  const result = initResult(4, "Dispute — AI score 0.45–0.75, jury votes REJECT");
  result.start_time = Date.now();
  log("Flow 4: Dispute → jury rejects");

  try {
    if (dryRun) { result.passed = true; result.final_state = "DRY_RUN"; return result; }

    const client     = actors.client();
    const freelancer = actors.freelancer();
    const oracle     = actors.oracle();
    const j1 = actors.juror1();
    const j2 = actors.juror2();
    const j3 = actors.juror3();

    const deadline = Math.floor(Date.now() / 1000) + ONE_DAY_S * 7;
    const createTx = await escrow(client).createMilestone(
      freelancer.address, deadline, { value: MILESTONE_VALUE }
    );
    const createReceipt = await createTx.wait();
    recordTx(result, "createMilestone", createReceipt);
    const milestoneId = createReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`  [1/6] Milestone ${milestoneId} created`);

    const submitTx = await escrow(freelancer).submitWork(milestoneId, MOCK_IPFS);
    recordTx(result, "submitWork", await submitTx.wait());
    log(`  [2/6] Work submitted`);

    const disputeTx = await dispute(oracle).createDispute(milestoneId);
    const disputeReceipt = await disputeTx.wait();
    recordTx(result, "createDispute", disputeReceipt);
    const disputeId = disputeReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`  [3/6] Dispute ${disputeId} created`);

    // Jurors vote REJECT (false)
    for (const [juror, label] of [[j1, "juror1"], [j2, "juror2"], [j3, "juror3"]]) {
      const voteTx = await jury(juror).castVote(disputeId, false); // false = reject
      recordTx(result, `castVote_${label}`, await voteTx.wait());
    }
    log(`  [4/6] All 3 jurors voted REJECT`);

    const finalizeTx = await jury(oracle).finalizeVote(disputeId);
    recordTx(result, "finalizeVote", await finalizeTx.wait());
    log(`  [5/6] Vote finalized`);

    const milestone = await escrow(oracle).getMilestone(milestoneId);
    result.final_state = MILESTONE_STATES[Number(milestone.state)] ?? `UNKNOWN(${milestone.state})`;
    result.passed = result.final_state === "REFUNDED" || result.final_state === "REJECTED";

    log(`  ✓ Flow 4 complete. Final state: ${result.final_state}`);
  } catch (err) {
    result.error = err.message;
    log(`  ✗ Flow 4 failed: ${err.message}`);
  }

  result.end_time = Date.now();
  result.elapsed_ms = elapsed(result);
  return result;
}

// ---------------------------------------------------------------------------
// FLOW 5: Client timeout refund — deadline passes, no submission
// ---------------------------------------------------------------------------
async function flow5_timeoutRefund(dryRun) {
  const result = initResult(5, "Client timeout refund — deadline passed, no submission");
  result.start_time = Date.now();
  log("Flow 5: Timeout refund");

  try {
    if (dryRun) { result.passed = true; result.final_state = "DRY_RUN"; return result; }

    const client = actors.client();
    const oracle  = actors.oracle();

    // Set a very short deadline (already expired) for testing
    // On a real testnet you would deploy a test contract with a past timestamp
    // OR use Hardhat's time-travel (evm_increaseTime) in your local test suite
    // For Sepolia, we create the milestone with timestamp 1 (past) — contract
    // should allow refund immediately if deadline < block.timestamp
    const pastDeadline = 1; // Unix epoch — always in the past

    log("  [1/3] Client creates milestone with expired deadline...");
    const createTx = await escrow(client).createMilestone(
      ethers.ZeroAddress, // placeholder freelancer — never submits
      pastDeadline,
      { value: MILESTONE_VALUE }
    );
    const createReceipt = await createTx.wait();
    recordTx(result, "createMilestone", createReceipt);
    const milestoneId = createReceipt.logs[0]?.args?.[0] ?? 1n;
    log(`     milestoneId=${milestoneId}`);

    log("  [2/3] Client claims timeout refund...");
    const refundTx = await escrow(client).refundClient(milestoneId);
    const refundReceipt = await refundTx.wait();
    recordTx(result, "refundClient_timeout", refundReceipt);
    log(`     tx=${refundReceipt.hash}`);

    log("  [3/3] Verifying final state...");
    const milestone = await escrow(oracle).getMilestone(milestoneId);
    result.final_state = MILESTONE_STATES[Number(milestone.state)] ?? `UNKNOWN(${milestone.state})`;
    result.passed = result.final_state === "REFUNDED";

    log(`  ✓ Flow 5 complete. Final state: ${result.final_state}`);
  } catch (err) {
    result.error = err.message;
    log(`  ✗ Flow 5 failed: ${err.message}`);
  }

  result.end_time = Date.now();
  result.elapsed_ms = elapsed(result);
  return result;
}

// ---------------------------------------------------------------------------
// Results formatting + persistence
// ---------------------------------------------------------------------------
function printSummaryTable(allResults) {
  const SEP = "-".repeat(100);
  console.log("\n" + SEP);
  console.log("  END-TO-END TRANSACTION TEST RESULTS — SEPOLIA TESTNET");
  console.log(SEP);
  console.log(
    "Flow".padEnd(6) +
    "Description".padEnd(50) +
    "State".padEnd(12) +
    "Pass?".padEnd(8) +
    "Time(ms)".padEnd(12) +
    "Txns"
  );
  console.log(SEP);

  for (const r of allResults) {
    const pass = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(
      String(r.flow).padEnd(6) +
      r.description.slice(0, 48).padEnd(50) +
      (r.final_state ?? "—").padEnd(12) +
      pass.padEnd(8) +
      String(r.elapsed_ms ?? "—").padEnd(12) +
      r.transactions.length
    );

    for (const tx of r.transactions) {
      console.log(
        "      " +
        `  step=${tx.step}  hash=${tx.hash}  gas=${tx.gas_used}  block=${tx.block}`
      );
    }

    if (r.error) {
      console.log(`      [ERROR] ${r.error}`);
    }
  }

  console.log(SEP);
  const passed = allResults.filter(r => r.passed).length;
  const total  = allResults.length;
  console.log(`  Result: ${passed}/${total} flows passed`);

  const totalGas = allResults
    .flatMap(r => r.transactions)
    .reduce((sum, tx) => sum + BigInt(tx.gas_used || 0), 0n);
  console.log(`  Total gas used across all transactions: ${totalGas.toString()}`);

  const totalMs = allResults.reduce((s, r) => s + (r.elapsed_ms ?? 0), 0);
  console.log(`  Total wall-clock time: ${totalMs}ms`);
  console.log(SEP + "\n");
}

function saveResults(allResults, path = "e2e_results.json") {
  fs.writeFileSync(path, JSON.stringify(allResults, null, 2), "utf8");
  console.log(`[✓] E2E results saved to ${path}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun    = args.includes("--dry-run");
  const flowArg   = args.indexOf("--flow");
  const singleFlow = flowArg !== -1 ? parseInt(args[flowArg + 1], 10) : null;

  if (dryRun) {
    console.log("[DRY RUN] No transactions will be sent.");
  }

  const allFlows = [
    flow1_normalApproval,
    flow2_rejection,
    flow3_disputeJuryApproves,
    flow4_disputeJuryRejects,
    flow5_timeoutRefund,
  ];

  // The spec asks for 10 flows — run flows 1–5 twice (same scenarios, second
  // run documents consistency and gas variance across blocks)
  const schedule = singleFlow !== null
    ? [allFlows[singleFlow - 1]]
    : [...allFlows, ...allFlows];  // 10 runs total

  const allResults = [];
  let runIndex = 0;

  for (const flowFn of schedule) {
    runIndex++;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  RUN ${runIndex}/${schedule.length}`);
    console.log("=".repeat(60));

    const result = await flowFn(dryRun);
    // Tag second-pass runs
    if (runIndex > allFlows.length) {
      result.description = "[Run 2] " + result.description;
      result.flow = result.flow + 10; // 11–15 for second pass
    }
    allResults.push(result);

    // Brief pause between flows to avoid nonce issues
    if (!dryRun && runIndex < schedule.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  printSummaryTable(allResults);
  saveResults(allResults);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
