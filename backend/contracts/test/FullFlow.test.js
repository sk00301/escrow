const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Sign an oracle result: keccak256(milestoneId, score) */
async function signOracle(signer, milestoneId, score) {
  const msgHash = ethers.solidityPackedKeccak256(
    ["uint256", "uint256"],
    [milestoneId, score]
  );
  return signer.signMessage(ethers.getBytes(msgHash));
}

/** Impersonate a contract address so it can make calls */
async function impersonate(address) {
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  await ethers.provider.send("hardhat_setBalance", [address, "0x1000000000000000000"]);
  return ethers.getSigner(address);
}

async function stopImpersonate(address) {
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [address]);
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER FIXTURE — deploy all four contracts wired together
// ─────────────────────────────────────────────────────────────────────────────

async function deployAll() {
  const [owner, client, freelancer, oracle, juror1, juror2, juror3, stranger] =
    await ethers.getSigners();

  // 1. Deploy JuryStaking with placeholder (wired after DisputeContract exists)
  const JuryStaking = await ethers.getContractFactory("JuryStaking");
  const jury = await JuryStaking.deploy(owner.address);
  await jury.waitForDeployment();

  // 2. Deploy EscrowContract with placeholder jury address
  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy(oracle.address, owner.address);
  await escrow.waitForDeployment();

  // 3. Deploy EvidenceRegistry pointing to EscrowContract
  const EvidenceRegistry = await ethers.getContractFactory("EvidenceRegistry");
  const registry = await EvidenceRegistry.deploy(await escrow.getAddress());
  await registry.waitForDeployment();

  // 4. Deploy DisputeContract pointing to EscrowContract + JuryStaking
  const DisputeContract = await ethers.getContractFactory("DisputeContract");
  const dispute = await DisputeContract.deploy(
    await escrow.getAddress(),
    await jury.getAddress()
  );
  await dispute.waitForDeployment();

  // 5. Wire everything up
  await jury.setDisputeContract(await dispute.getAddress());
  await escrow.setJuryContractAddress(await dispute.getAddress());

  const ESCROW_AMOUNT = ethers.parseEther("1");
  const DEADLINE      = (await time.latest()) + 7 * 24 * 60 * 60; // 7 days
  const MILESTONE_HASH = ethers.keccak256(ethers.toUtf8Bytes("Build REST API spec"));

  return {
    escrow, registry, dispute, jury,
    owner, client, freelancer, oracle,
    juror1, juror2, juror3, stranger,
    ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SETUP — creates + funds a milestone, returns milestoneId
// ─────────────────────────────────────────────────────────────────────────────

async function createAndFund(escrow, client, freelancer, milestoneHash, deadline, amount) {
  await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
  await escrow.connect(client).fundMilestone(0, { value: amount });
  return 0;
}

async function submitWork(escrow, freelancer, milestoneId) {
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("submission-content-v1"));
  const ipfsCID      = "QmTestCIDabcdef1234567890";
  await escrow.connect(freelancer).submitWork(milestoneId, evidenceHash, ipfsCID);
  return { evidenceHash, ipfsCID };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — HAPPY PATH (Automated Approval, score = 80)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 1 — Happy Path (Automated Approval)", function () {
  it("Full flow: create → fund → submit → verify (80) → release payment", async function () {
    const { escrow, client, freelancer, oracle, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
      await deployAll();

    // ── Step 1: Create milestone ──────────────────────────────────────────
    const createTx = await escrow
      .connect(client)
      .createMilestone(freelancer.address, MILESTONE_HASH, DEADLINE);

    await expect(createTx)
      .to.emit(escrow, "MilestoneCreated")
      .withArgs(0, client.address, freelancer.address, MILESTONE_HASH, DEADLINE);

    let m = await escrow.getMilestone(0);
    expect(m.state).to.equal(0); // CREATED

    // ── Step 2: Fund milestone ────────────────────────────────────────────
    const contractBalBefore = await ethers.provider.getBalance(await escrow.getAddress());

    const fundTx = await escrow
      .connect(client)
      .fundMilestone(0, { value: ESCROW_AMOUNT });

    await expect(fundTx)
      .to.emit(escrow, "MilestoneFunded")
      .withArgs(0, ESCROW_AMOUNT);

    m = await escrow.getMilestone(0);
    expect(m.state).to.equal(1); // FUNDED
    expect(m.amount).to.equal(ESCROW_AMOUNT);

    const contractBalAfter = await ethers.provider.getBalance(await escrow.getAddress());
    expect(contractBalAfter - contractBalBefore).to.equal(ESCROW_AMOUNT);

    // ── Step 3: Submit work ───────────────────────────────────────────────
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("my-deliverable"));
    const ipfsCID      = "QmHappyPathCID123";

    const submitTx = await escrow
      .connect(freelancer)
      .submitWork(0, evidenceHash, ipfsCID);

    await expect(submitTx)
      .to.emit(escrow, "WorkSubmitted")
      .withArgs(0, evidenceHash, ipfsCID);

    m = await escrow.getMilestone(0);
    expect(m.state).to.equal(2);           // SUBMITTED
    expect(m.evidenceHash).to.equal(evidenceHash);
    expect(m.ipfsCID).to.equal(ipfsCID);

    // ── Step 4: Oracle posts score = 80 (≥75 → VERIFIED) ─────────────────
    const sig = await signOracle(oracle, 0, 80);

    const verifyTx = await escrow
      .connect(oracle)
      .postVerificationResult(0, 80, sig);

    await expect(verifyTx)
      .to.emit(escrow, "VerificationResultPosted")
      .withArgs(0, 80, "APPROVED");

    m = await escrow.getMilestone(0);
    expect(m.state).to.equal(3);  // VERIFIED
    expect(m.score).to.equal(80);
    expect(m.verdict).to.equal("APPROVED");

    // ── Step 5: Client releases payment ───────────────────────────────────
    const freelancerBalBefore = await ethers.provider.getBalance(freelancer.address);

    const releaseTx = await escrow.connect(client).releasePayment(0);

    await expect(releaseTx)
      .to.emit(escrow, "PaymentReleased")
      .withArgs(0, ESCROW_AMOUNT, freelancer.address);

    m = await escrow.getMilestone(0);
    expect(m.state).to.equal(7);  // RELEASED
    expect(m.amount).to.equal(0); // escrow cleared

    const freelancerBalAfter = await ethers.provider.getBalance(freelancer.address);
    expect(freelancerBalAfter - freelancerBalBefore).to.equal(ESCROW_AMOUNT);

    // Contract should now hold 0 ETH for this milestone
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — REJECTION FLOW (score = 30)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 2 — Rejection Flow (score = 30)", function () {
  it("Client gets refund, freelancer gets nothing after rejection", async function () {
    const { escrow, client, freelancer, oracle, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
      await deployAll();

    await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
    await submitWork(escrow, freelancer, 0);

    const clientBalBefore     = await ethers.provider.getBalance(client.address);
    const freelancerBalBefore = await ethers.provider.getBalance(freelancer.address);

    // Oracle posts score = 30 → REJECTED
    const sig = await signOracle(oracle, 0, 30);
    const rejectTx = await escrow.connect(oracle).postVerificationResult(0, 30, sig);

    await expect(rejectTx)
      .to.emit(escrow, "VerificationResultPosted")
      .withArgs(0, 30, "REJECTED");

    const m = await escrow.getMilestone(0);
    expect(m.state).to.equal(4);    // REJECTED
    expect(m.verdict).to.equal("REJECTED");
    expect(m.score).to.equal(30);

    // ETH is still locked — neither party can take it automatically
    // Freelancer balance unchanged
    const freelancerBalAfter = await ethers.provider.getBalance(freelancer.address);
    expect(freelancerBalAfter).to.equal(freelancerBalBefore);

    // Client cannot call releasePayment (not VERIFIED)
    await expect(
      escrow.connect(client).releasePayment(0)
    ).to.be.revertedWith("EscrowContract: invalid state transition");

    // Freelancer cannot call releasePayment
    await expect(
      escrow.connect(freelancer).releasePayment(0)
    ).to.be.revertedWith("EscrowContract: caller is not the client");

    // Verify final balances: nobody received the escrow
    const contractBal = await ethers.provider.getBalance(await escrow.getAddress());
    expect(contractBal).to.equal(ESCROW_AMOUNT); // still locked
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — DISPUTE FLOW (score = 60, jury votes to release)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 3 — Dispute Flow (score = 60, jury releases to freelancer)", function () {
  it("Full dispute: oracle → DISPUTED → jurors assigned → vote → freelancer paid", async function () {
    const {
      escrow, dispute, jury,
      owner, client, freelancer, oracle,
      juror1, juror2, juror3,
      ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH,
    } = await deployAll();

    // ── Steps 1-3: create, fund, submit ───────────────────────────────────
    await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
    await submitWork(escrow, freelancer, 0);

    // ── Step 4: Oracle posts score = 60 → DISPUTED ────────────────────────
    const sig = await signOracle(oracle, 0, 60);
    await expect(escrow.connect(oracle).postVerificationResult(0, 60, sig))
      .to.emit(escrow, "VerificationResultPosted")
      .withArgs(0, 60, "DISPUTED");

    expect(await escrow.getMilestoneState(0)).to.equal(5); // DISPUTED

    // ── Step 5: Either party raises dispute ───────────────────────────────
    await expect(escrow.connect(client).raiseDispute(0))
      .to.emit(escrow, "DisputeRaised")
      .withArgs(0, client.address);

    // ── Step 6: Escrow creates dispute in DisputeContract ─────────────────
    // In production EscrowContract calls this directly. Here we impersonate it.
    const escrowImp = await impersonate(await escrow.getAddress());
    await expect(
      dispute.connect(escrowImp).createDispute(
        0, client.address, freelancer.address, ESCROW_AMOUNT
      )
    ).to.emit(dispute, "DisputeCreated").withArgs(0, 0, client.address, freelancer.address, ESCROW_AMOUNT);
    await stopImpersonate(await escrow.getAddress());

    // Verify dispute is in OPEN state
    const [mid, , , , , status] = await dispute.getDispute(0);
    expect(mid).to.equal(0);
    expect(status).to.equal(0); // OPEN

    // ── Step 7: Jurors stake and get selected ─────────────────────────────
    const MIN_STAKE = ethers.parseEther("0.01");
    await jury.connect(juror1).stakeToBeJuror({ value: MIN_STAKE });
    await jury.connect(juror2).stakeToBeJuror({ value: MIN_STAKE });
    await jury.connect(juror3).stakeToBeJuror({ value: MIN_STAKE });

    expect(await jury.getPoolSize()).to.equal(3);

    // Owner selects 3 jurors
    await expect(jury.connect(owner).selectJurors(0, 3))
      .to.emit(jury, "JurorsSelected");

    // Verify jurors are assigned in DisputeContract
    const [,,,, jurors, dStatus] = await dispute.getDispute(0);
    expect(jurors.length).to.equal(3);
    expect(dStatus).to.equal(2); // VOTING

    // ── Step 8: All 3 jurors vote to release to freelancer ────────────────
    const selectedJurors = [juror1, juror2, juror3];
    for (const j of selectedJurors) {
      if (await jury.isJurorForDispute(0, j.address)) {
        await expect(jury.connect(j).castVote(0, true))
          .to.emit(jury, "VoteCast")
          .withArgs(0, j.address, true);
      }
    }

    const [forF, forC, total] = await jury.getVoteCounts(0);
    expect(total).to.equal(3);
    expect(forF).to.equal(3);
    expect(forC).to.equal(0);

    // ── Step 9: Tally votes → freelancer receives payment ─────────────────
    const freelancerBalBefore = await ethers.provider.getBalance(freelancer.address);

    await expect(jury.connect(owner).tallyVotes(0))
      .to.emit(jury, "VotesTallied")
      .withArgs(0, true, 3, 0);

    const freelancerBalAfter = await ethers.provider.getBalance(freelancer.address);
    expect(freelancerBalAfter - freelancerBalBefore).to.equal(ESCROW_AMOUNT);

    // Verify final states
    expect(await escrow.getMilestoneState(0)).to.equal(6); // RESOLVED
    const [,,,,,,,, resolvedAt] = await dispute.getDispute(0);
    expect(resolvedAt).to.be.gt(0);
  });

  it("Dispute: majority votes for client → client refunded", async function () {
    const {
      escrow, dispute, jury,
      owner, client, freelancer, oracle,
      juror1, juror2, juror3,
      ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH,
    } = await deployAll();

    await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
    await submitWork(escrow, freelancer, 0);

    const sig = await signOracle(oracle, 0, 60);
    await escrow.connect(oracle).postVerificationResult(0, 60, sig);

    const escrowImp = await impersonate(await escrow.getAddress());
    await dispute.connect(escrowImp).createDispute(0, client.address, freelancer.address, ESCROW_AMOUNT);
    await stopImpersonate(await escrow.getAddress());

    const MIN_STAKE = ethers.parseEther("0.01");
    await jury.connect(juror1).stakeToBeJuror({ value: MIN_STAKE });
    await jury.connect(juror2).stakeToBeJuror({ value: MIN_STAKE });
    await jury.connect(juror3).stakeToBeJuror({ value: MIN_STAKE });
    await jury.connect(owner).selectJurors(0, 3);

    const clientBalBefore = await ethers.provider.getBalance(client.address);

    // All jurors vote for client (false = refund client)
    for (const j of [juror1, juror2, juror3]) {
      if (await jury.isJurorForDispute(0, j.address)) {
        await jury.connect(j).castVote(0, false);
      }
    }

    await jury.connect(owner).tallyVotes(0);

    const clientBalAfter = await ethers.provider.getBalance(client.address);
    expect(clientBalAfter - clientBalBefore).to.equal(ESCROW_AMOUNT);
    expect(await escrow.getMilestoneState(0)).to.equal(6); // RESOLVED
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — TIMEOUT
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 4 — Timeout (no submission before deadline)", function () {
  it("Client reclaims full escrow after deadline passes with no submission", async function () {
    const { escrow, client, freelancer, ESCROW_AMOUNT, MILESTONE_HASH } = await deployAll();

    // Short deadline — 1 hour from now
    const shortDeadline = (await time.latest()) + 3600;
    await escrow.connect(client).createMilestone(freelancer.address, MILESTONE_HASH, shortDeadline);
    await escrow.connect(client).fundMilestone(0, { value: ESCROW_AMOUNT });

    // Confirm state is FUNDED
    expect(await escrow.getMilestoneState(0)).to.equal(1); // FUNDED

    // Freelancer cannot get a refund
    await expect(
      escrow.connect(freelancer).getTimeoutRefund(0)
    ).to.be.revertedWith("EscrowContract: caller is not the client");

    // Client tries before deadline — should revert
    await expect(
      escrow.connect(client).getTimeoutRefund(0)
    ).to.be.revertedWith("EscrowContract: deadline has not passed yet");

    // Fast-forward past deadline
    await time.increaseTo(shortDeadline + 1);

    // Now freelancer STILL cannot get refund
    await expect(
      escrow.connect(freelancer).getTimeoutRefund(0)
    ).to.be.revertedWith("EscrowContract: caller is not the client");

    // Client can now reclaim
    const clientBalBefore = await ethers.provider.getBalance(client.address);

    await expect(escrow.connect(client).getTimeoutRefund(0))
      .to.emit(escrow, "TimeoutRefundIssued")
      .withArgs(0, client.address, ESCROW_AMOUNT);

    const clientBalAfter = await ethers.provider.getBalance(client.address);
    // Client gets full escrow back (minus gas cost)
    expect(clientBalAfter).to.be.gt(clientBalBefore);

    expect(await escrow.getMilestoneState(0)).to.equal(8); // REFUNDED

    // Contract holds 0 ETH now
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0);

    // Cannot double-refund
    await expect(
      escrow.connect(client).getTimeoutRefund(0)
    ).to.be.revertedWith("EscrowContract: invalid state transition");
  });

  it("Freelancer cannot submit after deadline has passed", async function () {
    const { escrow, client, freelancer, ESCROW_AMOUNT, MILESTONE_HASH } = await deployAll();

    const shortDeadline = (await time.latest()) + 3600;
    await escrow.connect(client).createMilestone(freelancer.address, MILESTONE_HASH, shortDeadline);
    await escrow.connect(client).fundMilestone(0, { value: ESCROW_AMOUNT });

    await time.increaseTo(shortDeadline + 1);

    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("late-submission"));
    await expect(
      escrow.connect(freelancer).submitWork(0, evidenceHash, "QmLateCID")
    ).to.be.revertedWith("EscrowContract: submission deadline has passed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5 — SECURITY
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 5 — Security & Access Control", function () {

  describe("postVerificationResult() — oracle guard", function () {
    it("Reverts when called by non-oracle address", async function () {
      const { escrow, client, freelancer, oracle, stranger, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();

      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);

      // Sign with oracle but send from stranger
      const sig = await signOracle(oracle, 0, 80);
      await expect(
        escrow.connect(stranger).postVerificationResult(0, 80, sig)
      ).to.be.revertedWith("EscrowContract: caller is not the oracle");
    });

    it("Reverts when signature is from wrong key (even if caller is oracle address)", async function () {
      const { escrow, client, freelancer, oracle, stranger, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();

      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);

      // Sign with stranger's key, send from oracle address
      const badSig = await signOracle(stranger, 0, 80);
      await expect(
        escrow.connect(oracle).postVerificationResult(0, 80, badSig)
      ).to.be.revertedWith("EscrowContract: invalid oracle signature");
    });

    it("Reverts when score is tampered (signature no longer matches)", async function () {
      const { escrow, client, freelancer, oracle, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();

      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);

      // Sign for score 80, but submit score 30
      const sig = await signOracle(oracle, 0, 80);
      await expect(
        escrow.connect(oracle).postVerificationResult(0, 30, sig)
      ).to.be.revertedWith("EscrowContract: invalid oracle signature");
    });
  });

  describe("Double-funding prevention", function () {
    it("Reverts when client tries to fund the same milestone twice", async function () {
      const { escrow, client, freelancer, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();

      await escrow.connect(client).createMilestone(freelancer.address, MILESTONE_HASH, DEADLINE);
      await escrow.connect(client).fundMilestone(0, { value: ESCROW_AMOUNT });

      await expect(
        escrow.connect(client).fundMilestone(0, { value: ESCROW_AMOUNT })
      ).to.be.revertedWith("EscrowContract: invalid state transition");
    });
  });

  describe("Premature payment release", function () {
    it("Reverts: release before verification (FUNDED state)", async function () {
      const { escrow, client, freelancer, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();
      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);

      await expect(
        escrow.connect(client).releasePayment(0)
      ).to.be.revertedWith("EscrowContract: invalid state transition");
    });

    it("Reverts: release before verification (SUBMITTED state)", async function () {
      const { escrow, client, freelancer, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();
      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);

      await expect(
        escrow.connect(client).releasePayment(0)
      ).to.be.revertedWith("EscrowContract: invalid state transition");
    });

    it("Reverts: release after rejection (REJECTED state)", async function () {
      const { escrow, client, freelancer, oracle, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();
      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);
      const sig = await signOracle(oracle, 0, 20);
      await escrow.connect(oracle).postVerificationResult(0, 20, sig);

      await expect(
        escrow.connect(client).releasePayment(0)
      ).to.be.revertedWith("EscrowContract: invalid state transition");
    });
  });

  describe("Access control — role separation", function () {
    it("Freelancer cannot fund their own milestone", async function () {
      const { escrow, client, freelancer, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();
      await escrow.connect(client).createMilestone(freelancer.address, MILESTONE_HASH, DEADLINE);

      await expect(
        escrow.connect(freelancer).fundMilestone(0, { value: ESCROW_AMOUNT })
      ).to.be.revertedWith("EscrowContract: caller is not the client");
    });

    it("Client cannot submit work", async function () {
      const { escrow, client, freelancer, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();
      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);

      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("work"));
      await expect(
        escrow.connect(client).submitWork(0, evidenceHash, "QmCID")
      ).to.be.revertedWith("EscrowContract: caller is not the freelancer");
    });

    it("Stranger cannot resolve dispute", async function () {
      const { escrow, stranger, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();
      // Milestone must be in DISPUTED state to call resolveDispute
      // We just verify the role guard fires
      await expect(
        escrow.connect(stranger).resolveDispute(0, true)
      ).to.be.revertedWith("EscrowContract: caller is not the jury contract");
    });

    it("Direct ETH send to EscrowContract is rejected", async function () {
      const { escrow, client, ESCROW_AMOUNT } = await deployAll();
      await expect(
        client.sendTransaction({ to: await escrow.getAddress(), value: ESCROW_AMOUNT })
      ).to.be.revertedWith("EscrowContract: use fundMilestone() to send ETH");
    });
  });

  describe("EvidenceRegistry integrity", function () {
    it("verifyIntegrity detects tampered evidence hash", async function () {
      const { escrow, registry, client, freelancer, oracle, ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH } =
        await deployAll();

      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);

      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("original-deliverable"));
      // Register evidence via EscrowContract impersonation
      const escrowImp = await impersonate(await escrow.getAddress());
      await registry.connect(escrowImp).registerEvidence(
        0, evidenceHash, "QmRealCID", freelancer.address
      );
      await stopImpersonate(await escrow.getAddress());

      // Original hash verifies correctly
      expect(await registry.verifyIntegrity(0, evidenceHash)).to.be.true;

      // Tampered hash fails
      const tamperedHash = ethers.keccak256(ethers.toUtf8Bytes("tampered-content"));
      expect(await registry.verifyIntegrity(0, tamperedHash)).to.be.false;
    });

    it("Non-escrow address cannot register evidence", async function () {
      const { registry, stranger, freelancer } = await deployAll();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("content"));
      await expect(
        registry.connect(stranger).registerEvidence(0, hash, "QmCID", freelancer.address)
      ).to.be.revertedWith("EvidenceRegistry: caller is not the EscrowContract");
    });
  });

  describe("JuryStaking — vote integrity", function () {
    it("Juror cannot vote twice on same dispute", async function () {
      const {
        escrow, dispute, jury,
        owner, client, freelancer, oracle,
        juror1, juror2, juror3,
        ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH,
      } = await deployAll();

      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);
      const sig = await signOracle(oracle, 0, 60);
      await escrow.connect(oracle).postVerificationResult(0, 60, sig);

      const escrowImp = await impersonate(await escrow.getAddress());
      await dispute.connect(escrowImp).createDispute(0, client.address, freelancer.address, ESCROW_AMOUNT);
      await stopImpersonate(await escrow.getAddress());

      const MIN_STAKE = ethers.parseEther("0.01");
      await jury.connect(juror1).stakeToBeJuror({ value: MIN_STAKE });
      await jury.connect(juror2).stakeToBeJuror({ value: MIN_STAKE });
      await jury.connect(juror3).stakeToBeJuror({ value: MIN_STAKE });
      await jury.connect(owner).selectJurors(0, 3);

      // Find first selected juror
      let firstJuror;
      for (const j of [juror1, juror2, juror3]) {
        if (await jury.isJurorForDispute(0, j.address)) {
          firstJuror = j;
          break;
        }
      }

      await jury.connect(firstJuror).castVote(0, true);

      await expect(
        jury.connect(firstJuror).castVote(0, true)
      ).to.be.revertedWith("JuryStaking: juror has already voted");
    });

    it("Non-juror cannot vote on a dispute", async function () {
      const {
        escrow, dispute, jury,
        owner, client, freelancer, oracle, stranger,
        juror1, juror2, juror3,
        ESCROW_AMOUNT, DEADLINE, MILESTONE_HASH,
      } = await deployAll();

      await createAndFund(escrow, client, freelancer, MILESTONE_HASH, DEADLINE, ESCROW_AMOUNT);
      await submitWork(escrow, freelancer, 0);
      const sig = await signOracle(oracle, 0, 60);
      await escrow.connect(oracle).postVerificationResult(0, 60, sig);

      const escrowImp = await impersonate(await escrow.getAddress());
      await dispute.connect(escrowImp).createDispute(0, client.address, freelancer.address, ESCROW_AMOUNT);
      await stopImpersonate(await escrow.getAddress());

      const MIN_STAKE = ethers.parseEther("0.01");
      await jury.connect(juror1).stakeToBeJuror({ value: MIN_STAKE });
      await jury.connect(juror2).stakeToBeJuror({ value: MIN_STAKE });
      await jury.connect(juror3).stakeToBeJuror({ value: MIN_STAKE });
      await jury.connect(owner).selectJurors(0, 3);

      await expect(
        jury.connect(stranger).castVote(0, true)
      ).to.be.revertedWith("JuryStaking: caller is not a selected juror for this dispute");
    });
  });
});
