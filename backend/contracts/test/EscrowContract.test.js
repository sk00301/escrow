const { expect }      = require("chai");
const { ethers }      = require("hardhat");
const { time }        = require("@nomicfoundation/hardhat-network-helpers");

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Signs the oracle payload (milestoneId, score) with a given wallet.
 * Mirrors what the Node.js oracle bridge does off-chain.
 */
async function signOracleResult(signer, milestoneId, score) {
  const messageHash = ethers.solidityPackedKeccak256(
    ["uint256", "uint256"],
    [milestoneId, score]
  );
  // ethers v6: signMessage automatically prepends the Ethereum prefix
  return signer.signMessage(ethers.getBytes(messageHash));
}

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployEscrowFixture() {
  const [owner, client, freelancer, oracle, juryContract, stranger] =
    await ethers.getSigners();

  const EscrowContract = await ethers.getContractFactory("EscrowContract");
  const escrow = await EscrowContract.deploy(
    oracle.address,
    juryContract.address
  );
  await escrow.waitForDeployment();

  // A standard deadline 7 days from now
  const deadline = (await time.latest()) + 7 * 24 * 60 * 60;

  // A sample milestone hash (keccak256 of some off-chain spec)
  const milestoneHash = ethers.keccak256(ethers.toUtf8Bytes("Build REST API"));

  return {
    escrow,
    owner,
    client,
    freelancer,
    oracle,
    juryContract,
    stranger,
    deadline,
    milestoneHash,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("EscrowContract", function () {

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Sets oracle and jury addresses correctly", async function () {
      const { escrow, oracle, juryContract } = await deployEscrowFixture();
      expect(await escrow.oracleAddress()).to.equal(oracle.address);
      expect(await escrow.juryContractAddress()).to.equal(juryContract.address);
    });

    it("Starts with zero milestones", async function () {
      const { escrow } = await deployEscrowFixture();
      expect(await escrow.getTotalMilestones()).to.equal(0);
    });

    it("Rejects ETH sent directly", async function () {
      const { escrow, client } = await deployEscrowFixture();
      await expect(
        client.sendTransaction({ to: await escrow.getAddress(), value: ethers.parseEther("1") })
      ).to.be.revertedWith("EscrowContract: use fundMilestone() to send ETH");
    });
  });

  // ── createMilestone ──────────────────────────────────────────────────────────

  describe("createMilestone()", function () {
    it("Creates milestone in CREATED state and emits event", async function () {
      const { escrow, client, freelancer, deadline, milestoneHash } =
        await deployEscrowFixture();

      await expect(
        escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline)
      )
        .to.emit(escrow, "MilestoneCreated")
        .withArgs(0, client.address, freelancer.address, milestoneHash, deadline);

      const m = await escrow.getMilestone(0);
      expect(m.client).to.equal(client.address);
      expect(m.freelancer).to.equal(freelancer.address);
      expect(m.state).to.equal(0); // State.CREATED
    });

    it("Increments milestoneCount", async function () {
      const { escrow, client, freelancer, deadline, milestoneHash } =
        await deployEscrowFixture();
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      expect(await escrow.getTotalMilestones()).to.equal(2);
    });

    it("Reverts with zero freelancer address", async function () {
      const { escrow, client, deadline, milestoneHash } = await deployEscrowFixture();
      await expect(
        escrow.connect(client).createMilestone(ethers.ZeroAddress, milestoneHash, deadline)
      ).to.be.revertedWith("EscrowContract: zero freelancer address");
    });

    it("Reverts when client == freelancer", async function () {
      const { escrow, client, deadline, milestoneHash } = await deployEscrowFixture();
      await expect(
        escrow.connect(client).createMilestone(client.address, milestoneHash, deadline)
      ).to.be.revertedWith("EscrowContract: client and freelancer must differ");
    });

    it("Reverts when deadline is in the past", async function () {
      const { escrow, client, freelancer, milestoneHash } = await deployEscrowFixture();
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        escrow.connect(client).createMilestone(freelancer.address, milestoneHash, pastDeadline)
      ).to.be.revertedWith("EscrowContract: deadline must be in the future");
    });
  });

  // ── fundMilestone ────────────────────────────────────────────────────────────

  describe("fundMilestone()", function () {
    async function createAndFundFixture() {
      const base = await deployEscrowFixture();
      const { escrow, client, freelancer, deadline, milestoneHash } = base;
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      return base;
    }

    it("Moves to FUNDED state and emits MilestoneFunded", async function () {
      const { escrow, client } = await createAndFundFixture();
      const amount = ethers.parseEther("1");

      await expect(escrow.connect(client).fundMilestone(0, { value: amount }))
        .to.emit(escrow, "MilestoneFunded")
        .withArgs(0, amount);

      const m = await escrow.getMilestone(0);
      expect(m.state).to.equal(1);  // State.FUNDED
      expect(m.amount).to.equal(amount);
    });

    it("Locks ETH in the contract", async function () {
      const { escrow, client } = await createAndFundFixture();
      const amount = ethers.parseEther("2");
      await escrow.connect(client).fundMilestone(0, { value: amount });
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(amount);
    });

    it("Reverts when called by non-client", async function () {
      const { escrow, stranger } = await createAndFundFixture();
      await expect(
        escrow.connect(stranger).fundMilestone(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("EscrowContract: caller is not the client");
    });

    it("Reverts when sending zero ETH", async function () {
      const { escrow, client } = await createAndFundFixture();
      await expect(
        escrow.connect(client).fundMilestone(0, { value: 0 })
      ).to.be.revertedWith("EscrowContract: must send ETH to fund milestone");
    });

    it("Reverts when already funded (double-fund)", async function () {
      const { escrow, client } = await createAndFundFixture();
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      await expect(
        escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("EscrowContract: invalid state transition");
    });
  });

  // ── submitWork ───────────────────────────────────────────────────────────────

  describe("submitWork()", function () {
    async function fundedFixture() {
      const base = await deployEscrowFixture();
      const { escrow, client, freelancer, deadline, milestoneHash } = base;
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      return base;
    }

    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("submission-content"));
    const ipfsCID      = "QmTestCIDabcdef1234567890";

    it("Moves to SUBMITTED state and emits WorkSubmitted", async function () {
      const { escrow, freelancer } = await fundedFixture();

      await expect(escrow.connect(freelancer).submitWork(0, evidenceHash, ipfsCID))
        .to.emit(escrow, "WorkSubmitted")
        .withArgs(0, evidenceHash, ipfsCID);

      const m = await escrow.getMilestone(0);
      expect(m.state).to.equal(2);        // State.SUBMITTED
      expect(m.evidenceHash).to.equal(evidenceHash);
      expect(m.ipfsCID).to.equal(ipfsCID);
    });

    it("Reverts when called by non-freelancer", async function () {
      const { escrow, client } = await fundedFixture();
      await expect(
        escrow.connect(client).submitWork(0, evidenceHash, ipfsCID)
      ).to.be.revertedWith("EscrowContract: caller is not the freelancer");
    });

    it("Reverts with empty evidence hash", async function () {
      const { escrow, freelancer } = await fundedFixture();
      await expect(
        escrow.connect(freelancer).submitWork(0, ethers.ZeroHash, ipfsCID)
      ).to.be.revertedWith("EscrowContract: empty evidence hash");
    });

    it("Reverts after deadline", async function () {
      const { escrow, freelancer, deadline } = await fundedFixture();
      await time.increaseTo(deadline + 1);
      await expect(
        escrow.connect(freelancer).submitWork(0, evidenceHash, ipfsCID)
      ).to.be.revertedWith("EscrowContract: submission deadline has passed");
    });
  });

  // ── postVerificationResult ───────────────────────────────────────────────────

  describe("postVerificationResult()", function () {
    async function submittedFixture() {
      const base = await deployEscrowFixture();
      const { escrow, client, freelancer, oracle, deadline, milestoneHash } = base;
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("submission"));
      await escrow.connect(freelancer).submitWork(0, evidenceHash, "QmTestCID");
      return base;
    }

    it("Score ≥ 75 → VERIFIED state, emits APPROVED verdict", async function () {
      const { escrow, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 80);

      await expect(escrow.connect(oracle).postVerificationResult(0, 80, sig))
        .to.emit(escrow, "VerificationResultPosted")
        .withArgs(0, 80, "APPROVED");

      expect(await escrow.getMilestoneState(0)).to.equal(3); // VERIFIED
    });

    it("Score 45–74 → DISPUTED state, emits DISPUTED verdict", async function () {
      const { escrow, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 60);

      await expect(escrow.connect(oracle).postVerificationResult(0, 60, sig))
        .to.emit(escrow, "VerificationResultPosted")
        .withArgs(0, 60, "DISPUTED");

      expect(await escrow.getMilestoneState(0)).to.equal(5); // DISPUTED
    });

    it("Score < 45 → REJECTED state, emits REJECTED verdict", async function () {
      const { escrow, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 30);

      await expect(escrow.connect(oracle).postVerificationResult(0, 30, sig))
        .to.emit(escrow, "VerificationResultPosted")
        .withArgs(0, 30, "REJECTED");

      expect(await escrow.getMilestoneState(0)).to.equal(4); // REJECTED
    });

    it("Exact boundary 75 → VERIFIED", async function () {
      const { escrow, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 75);
      await escrow.connect(oracle).postVerificationResult(0, 75, sig);
      expect(await escrow.getMilestoneState(0)).to.equal(3);
    });

    it("Exact boundary 45 → DISPUTED", async function () {
      const { escrow, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 45);
      await escrow.connect(oracle).postVerificationResult(0, 45, sig);
      expect(await escrow.getMilestoneState(0)).to.equal(5);
    });

    it("Exact boundary 44 → REJECTED", async function () {
      const { escrow, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 44);
      await escrow.connect(oracle).postVerificationResult(0, 44, sig);
      expect(await escrow.getMilestoneState(0)).to.equal(4);
    });

    it("Reverts when called by non-oracle", async function () {
      const { escrow, stranger, oracle } = await submittedFixture();
      const sig = await signOracleResult(oracle, 0, 80);
      await expect(
        escrow.connect(stranger).postVerificationResult(0, 80, sig)
      ).to.be.revertedWith("EscrowContract: caller is not the oracle");
    });

    it("Reverts with invalid signature", async function () {
      const { escrow, oracle, stranger } = await submittedFixture();
      // Sign with a different key (stranger instead of oracle)
      const badSig = await signOracleResult(stranger, 0, 80);
      await expect(
        escrow.connect(oracle).postVerificationResult(0, 80, badSig)
      ).to.be.revertedWith("EscrowContract: invalid oracle signature");
    });
  });

  // ── releasePayment ───────────────────────────────────────────────────────────

  describe("releasePayment()", function () {
    async function verifiedFixture() {
      const base = await deployEscrowFixture();
      const { escrow, client, freelancer, oracle, deadline, milestoneHash } = base;
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("submission"));
      await escrow.connect(freelancer).submitWork(0, evidenceHash, "QmTestCID");
      const sig = await signOracleResult(oracle, 0, 80);
      await escrow.connect(oracle).postVerificationResult(0, 80, sig);
      return base;
    }

    it("Transfers ETH to freelancer and moves to RELEASED", async function () {
      const { escrow, client, freelancer } = await verifiedFixture();

      const before = await ethers.provider.getBalance(freelancer.address);
      await expect(escrow.connect(client).releasePayment(0))
        .to.emit(escrow, "PaymentReleased")
        .withArgs(0, ethers.parseEther("1"), freelancer.address);

      const after = await ethers.provider.getBalance(freelancer.address);
      expect(after - before).to.equal(ethers.parseEther("1"));
      expect(await escrow.getMilestoneState(0)).to.equal(7); // RELEASED
    });

    it("Reverts when called by non-client", async function () {
      const { escrow, stranger } = await verifiedFixture();
      await expect(
        escrow.connect(stranger).releasePayment(0)
      ).to.be.revertedWith("EscrowContract: caller is not the client");
    });

    it("Reverts when not in VERIFIED state", async function () {
      const { escrow, client, freelancer, oracle, deadline, milestoneHash } =
        await deployEscrowFixture();
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      // Still in FUNDED state — not yet VERIFIED
      await expect(
        escrow.connect(client).releasePayment(0)
      ).to.be.revertedWith("EscrowContract: invalid state transition");
    });
  });

  // ── raiseDispute & resolveDispute ────────────────────────────────────────────

  describe("raiseDispute() + resolveDispute()", function () {
    async function disputedFixture() {
      const base = await deployEscrowFixture();
      const { escrow, client, freelancer, oracle, deadline, milestoneHash } = base;
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("submission"));
      await escrow.connect(freelancer).submitWork(0, evidenceHash, "QmTestCID");
      const sig = await signOracleResult(oracle, 0, 60); // → DISPUTED
      await escrow.connect(oracle).postVerificationResult(0, 60, sig);
      return base;
    }

    it("Client can raise dispute in DISPUTED state", async function () {
      const { escrow, client } = await disputedFixture();
      await expect(escrow.connect(client).raiseDispute(0))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(0, client.address);
    });

    it("Freelancer can also raise dispute", async function () {
      const { escrow, freelancer } = await disputedFixture();
      await expect(escrow.connect(freelancer).raiseDispute(0))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(0, freelancer.address);
    });

    it("Stranger cannot raise dispute", async function () {
      const { escrow, stranger } = await disputedFixture();
      await expect(
        escrow.connect(stranger).raiseDispute(0)
      ).to.be.revertedWith("EscrowContract: only client or freelancer can raise dispute");
    });

    it("Jury releases funds to freelancer → RESOLVED", async function () {
      const { escrow, juryContract, freelancer } = await disputedFixture();

      const before = await ethers.provider.getBalance(freelancer.address);
      await expect(escrow.connect(juryContract).resolveDispute(0, true))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(0, true);

      const after = await ethers.provider.getBalance(freelancer.address);
      expect(after - before).to.equal(ethers.parseEther("1"));
      expect(await escrow.getMilestoneState(0)).to.equal(6); // RESOLVED
    });

    it("Jury refunds ETH to client → RESOLVED", async function () {
      const { escrow, juryContract, client } = await disputedFixture();

      const before = await ethers.provider.getBalance(client.address);
      await escrow.connect(juryContract).resolveDispute(0, false);
      const after = await ethers.provider.getBalance(client.address);

      // Client gets the 1 ETH back (minus gas, so just check > before)
      expect(after).to.be.gt(before);
      expect(await escrow.getMilestoneState(0)).to.equal(6); // RESOLVED
    });

    it("Non-jury cannot resolve dispute", async function () {
      const { escrow, stranger } = await disputedFixture();
      await expect(
        escrow.connect(stranger).resolveDispute(0, true)
      ).to.be.revertedWith("EscrowContract: caller is not the jury contract");
    });
  });

  // ── getTimeoutRefund ─────────────────────────────────────────────────────────

  describe("getTimeoutRefund()", function () {
    it("Client receives refund after deadline with no submission", async function () {
      const { escrow, client, freelancer, deadline, milestoneHash } =
        await deployEscrowFixture();

      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });

      // Fast-forward past deadline
      await time.increaseTo(deadline + 1);

      const before = await ethers.provider.getBalance(client.address);
      await expect(escrow.connect(client).getTimeoutRefund(0))
        .to.emit(escrow, "TimeoutRefundIssued")
        .withArgs(0, client.address, ethers.parseEther("1"));

      const after = await ethers.provider.getBalance(client.address);
      expect(after).to.be.gt(before);
      expect(await escrow.getMilestoneState(0)).to.equal(8); // REFUNDED
    });

    it("Reverts if deadline has not passed", async function () {
      const { escrow, client, freelancer, deadline, milestoneHash } =
        await deployEscrowFixture();
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });

      await expect(
        escrow.connect(client).getTimeoutRefund(0)
      ).to.be.revertedWith("EscrowContract: deadline has not passed yet");
    });

    it("Reverts when called by non-client", async function () {
      const { escrow, client, freelancer, deadline, milestoneHash } =
        await deployEscrowFixture();
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });
      await time.increaseTo(deadline + 1);

      await expect(
        escrow.connect(freelancer).getTimeoutRefund(0)
      ).to.be.revertedWith("EscrowContract: caller is not the client");
    });
  });

  // ── Admin functions ──────────────────────────────────────────────────────────

  describe("Admin functions", function () {
    it("Owner can update oracle address", async function () {
      const { escrow, owner, stranger } = await deployEscrowFixture();
      await expect(escrow.connect(owner).setOracleAddress(stranger.address))
        .to.emit(escrow, "OracleAddressUpdated");
      expect(await escrow.oracleAddress()).to.equal(stranger.address);
    });

    it("Non-owner cannot update oracle address", async function () {
      const { escrow, stranger } = await deployEscrowFixture();
      await expect(
        escrow.connect(stranger).setOracleAddress(stranger.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("Owner can update jury contract address", async function () {
      const { escrow, owner, stranger } = await deployEscrowFixture();
      await escrow.connect(owner).setJuryContractAddress(stranger.address);
      expect(await escrow.juryContractAddress()).to.equal(stranger.address);
    });
  });

  // ── Non-existent milestone ───────────────────────────────────────────────────

  describe("Non-existent milestone guard", function () {
    it("Reverts getMilestone for invalid ID", async function () {
      const { escrow } = await deployEscrowFixture();
      await expect(escrow.getMilestone(999))
        .to.be.revertedWith("EscrowContract: milestone does not exist");
    });
  });
});
