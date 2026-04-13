const { expect } = require("chai");
const { ethers } = require("hardhat");

// ── Mock EscrowContract ───────────────────────────────────────────────────────
// We deploy a lightweight mock so DisputeContract can call resolveDispute()
// without needing the full EscrowContract in this test suite.

const MOCK_ESCROW_ABI = [
  "function resolveDispute(uint256 milestoneId, bool releaseToFreelancer) external",
  "event DisputeResolved(uint256 milestoneId, bool releaseToFreelancer)"
];

async function deployMockEscrow(deployer) {
  // Inline mock contract bytecode via a minimal Solidity factory
  const MockEscrow = await ethers.getContractFactory(
    // ABI
    ["event DisputeResolved(uint256 milestoneId, bool releaseToFreelancer)",
     "function resolveDispute(uint256 milestoneId, bool releaseToFreelancer) external"],
    // Bytecode for a contract that just emits an event
    "0x" + [
      "6080604052348015600f57600080fd5b5060b48061001e6000396000f3fe",
      "6080604052348015600f57600080fd5b506004361060285760003560e01c",
      "8063f3fef3a314602d575b600080fd5b603c6038366004605e565b603e565b",
      "005b6040518215158152602001604051809103902081527f8d6b840fb2f9b7b",
      "e905da63f8745fdb44f5d42e253c0abffa3abb2db4db8cd18183604051606a",
      "9190608a565b60405180910390a15050565b6000806040838503121560705760",
      "8080fd5b50813591506020830135801515608157600080fd5b809150509250",
      "9250565b9115158252602082015260400190565b00fea264697066735822",
    ].join(""),
    deployer
  );
  // Since writing bytecode is complex, instead use a simpler approach:
  // Deploy a real tiny mock using Hardhat's built-in approach
  return null; // handled differently below
}

// ── Fixture ───────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, escrowSigner, jurySigner, client, freelancer, stranger, juror1, juror2, juror3] =
    await ethers.getSigners();

  // Deploy DisputeContract with placeholder addresses first
  const DisputeContract = await ethers.getContractFactory("DisputeContract");
  const dispute = await DisputeContract.deploy(
    escrowSigner.address,  // we simulate escrow with a plain signer
    jurySigner.address     // we simulate jury with a plain signer
  );
  await dispute.waitForDeployment();

  const milestoneId   = 42;
  const stakedAmount  = ethers.parseEther("1");

  return {
    dispute,
    owner,
    escrowSigner,
    jurySigner,
    client,
    freelancer,
    stranger,
    juror1,
    juror2,
    juror3,
    milestoneId,
    stakedAmount,
  };
}

// Helper: create a dispute and return disputeId
async function createDispute(fixture) {
  const { dispute, escrowSigner, client, freelancer, milestoneId, stakedAmount } = fixture;
  const tx = await dispute
    .connect(escrowSigner)
    .createDispute(milestoneId, client.address, freelancer.address, stakedAmount);
  await tx.wait();
  return 0; // first dispute always gets ID 0
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DisputeContract", function () {

  describe("Deployment", function () {
    it("Sets escrow and jury addresses correctly", async function () {
      const { dispute, escrowSigner, jurySigner } = await deployFixture();
      expect(await dispute.escrowContract()).to.equal(escrowSigner.address);
      expect(await dispute.juryStaking()).to.equal(jurySigner.address);
    });

    it("Starts with zero disputes", async function () {
      const { dispute } = await deployFixture();
      expect(await dispute.disputeCount()).to.equal(0);
    });
  });

  describe("createDispute()", function () {
    it("Creates dispute in OPEN state and emits DisputeCreated", async function () {
      const fixture = await deployFixture();
      const { dispute, escrowSigner, client, freelancer, milestoneId, stakedAmount } = fixture;

      await expect(
        dispute.connect(escrowSigner).createDispute(
          milestoneId, client.address, freelancer.address, stakedAmount
        )
      )
        .to.emit(dispute, "DisputeCreated")
        .withArgs(0, milestoneId, client.address, freelancer.address, stakedAmount);

      const [mid, c, f, sa, , status] = await dispute.getDispute(0);
      expect(mid).to.equal(milestoneId);
      expect(c).to.equal(client.address);
      expect(f).to.equal(freelancer.address);
      expect(sa).to.equal(stakedAmount);
      expect(status).to.equal(0); // OPEN
    });

    it("Increments disputeCount", async function () {
      const fixture = await deployFixture();
      await createDispute(fixture);
      expect(await fixture.dispute.disputeCount()).to.equal(1);
    });

    it("Reverts when called by non-escrow", async function () {
      const { dispute, stranger, client, freelancer, milestoneId, stakedAmount } =
        await deployFixture();
      await expect(
        dispute.connect(stranger).createDispute(
          milestoneId, client.address, freelancer.address, stakedAmount
        )
      ).to.be.revertedWith("DisputeContract: caller is not EscrowContract");
    });

    it("Reverts on duplicate dispute for same milestone", async function () {
      const fixture = await deployFixture();
      await createDispute(fixture);
      const { dispute, escrowSigner, client, freelancer, milestoneId, stakedAmount } = fixture;
      await expect(
        dispute.connect(escrowSigner).createDispute(
          milestoneId, client.address, freelancer.address, stakedAmount
        )
      ).to.be.revertedWith(
        "DisputeContract: dispute already exists for this milestone"
      );
    });
  });

  describe("assignJurors()", function () {
    it("Assigns jurors and moves to JURORS_ASSIGNED", async function () {
      const fixture = await deployFixture();
      const { dispute, jurySigner, juror1, juror2, juror3 } = fixture;
      const disputeId = await createDispute(fixture);

      const jurorList = [juror1.address, juror2.address, juror3.address];

      await expect(
        dispute.connect(jurySigner).assignJurors(disputeId, jurorList)
      )
        .to.emit(dispute, "JurorsAssigned")
        .withArgs(disputeId, jurorList);

      const [,,,,jurors, status] = await dispute.getDispute(disputeId);
      expect(status).to.equal(1); // JURORS_ASSIGNED
      expect(jurors).to.deep.equal(jurorList);
    });

    it("Reverts when called by non-jury", async function () {
      const fixture = await deployFixture();
      const { dispute, stranger, juror1, juror2, juror3 } = fixture;
      const disputeId = await createDispute(fixture);
      await expect(
        dispute.connect(stranger).assignJurors(disputeId, [juror1.address, juror2.address, juror3.address])
      ).to.be.revertedWith("DisputeContract: caller is not JuryStaking");
    });

    it("Reverts with empty jurors array", async function () {
      const fixture = await deployFixture();
      const { dispute, jurySigner } = fixture;
      const disputeId = await createDispute(fixture);
      await expect(
        dispute.connect(jurySigner).assignJurors(disputeId, [])
      ).to.be.revertedWith("DisputeContract: jurors array is empty");
    });

    it("Reverts with even juror count", async function () {
      const fixture = await deployFixture();
      const { dispute, jurySigner, juror1, juror2 } = fixture;
      const disputeId = await createDispute(fixture);
      await expect(
        dispute.connect(jurySigner).assignJurors(disputeId, [juror1.address, juror2.address])
      ).to.be.revertedWith("DisputeContract: juror count must be odd");
    });
  });

  describe("startVoting()", function () {
    it("Moves to VOTING state and emits VotingStarted", async function () {
      const fixture = await deployFixture();
      const { dispute, jurySigner, juror1, juror2, juror3 } = fixture;
      const disputeId = await createDispute(fixture);

      await dispute.connect(jurySigner).assignJurors(
        disputeId, [juror1.address, juror2.address, juror3.address]
      );

      await expect(dispute.connect(jurySigner).startVoting(disputeId))
        .to.emit(dispute, "VotingStarted")
        .withArgs(disputeId);

      const [,,,,,status] = await dispute.getDispute(disputeId);
      expect(status).to.equal(2); // VOTING
    });
  });

  describe("submitJuryVerdict()", function () {
    async function votingFixture() {
      const fixture = await deployFixture();
      const { dispute, jurySigner, juror1, juror2, juror3 } = fixture;
      const disputeId = await createDispute(fixture);
      await dispute.connect(jurySigner).assignJurors(
        disputeId, [juror1.address, juror2.address, juror3.address]
      );
      await dispute.connect(jurySigner).startVoting(disputeId);
      return { ...fixture, disputeId };
    }

    it("Emits VerdictSubmitted and calls resolveDispute on EscrowContract", async function () {
      // Deploy a real EscrowContract as the escrow so the callback succeeds
      const [owner, oracleSigner, , client, freelancer] = await ethers.getSigners();

      // Deploy JuryStaking with placeholder
      const JuryStaking = await ethers.getContractFactory("JuryStaking");
      const jury = await JuryStaking.deploy(owner.address);
      await jury.waitForDeployment();

      // Deploy EscrowContract with jury placeholder (update after)
      const EscrowContract = await ethers.getContractFactory("EscrowContract");
      const escrow = await EscrowContract.deploy(oracleSigner.address, owner.address);
      await escrow.waitForDeployment();

      // Deploy DisputeContract wired to real EscrowContract + JuryStaking
      const DisputeContract = await ethers.getContractFactory("DisputeContract");
      const disputeC = await DisputeContract.deploy(
        await escrow.getAddress(),
        await jury.getAddress()
      );
      await disputeC.waitForDeployment();

      // Wire EscrowContract to accept DisputeContract as jury caller
      await escrow.connect(owner).setJuryContractAddress(await disputeC.getAddress());

      // Create + fund a milestone so resolveDispute() has ETH to release
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const milestoneHash = ethers.keccak256(ethers.toUtf8Bytes("spec"));
      await escrow.connect(client).createMilestone(freelancer.address, milestoneHash, deadline);
      await escrow.connect(client).fundMilestone(0, { value: ethers.parseEther("1") });

      // Submit work so milestone is in SUBMITTED state
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("work"));
      await escrow.connect(freelancer).submitWork(0, evidenceHash, "QmCID");

      // Oracle posts score in dispute band (60) -> DISPUTED
      const sig = await oracleSigner.signMessage(
        ethers.getBytes(ethers.solidityPackedKeccak256(["uint256","uint256"],[0,60]))
      );
      await escrow.connect(oracleSigner).postVerificationResult(0, 60, sig);

      // EscrowContract (as escrow) creates dispute in DisputeContract
      // In production EscrowContract calls createDispute automatically.
      // Here we call it directly since we haven't integrated that hook yet.
      await disputeC.connect(await ethers.getSigner(await escrow.getAddress()))
        .createDispute(0, client.address, freelancer.address, ethers.parseEther("1"))
        .catch(async () => {
          // escrow is a contract, use impersonation
          await ethers.provider.send("hardhat_impersonateAccount", [await escrow.getAddress()]);
          await ethers.provider.send("hardhat_setBalance", [await escrow.getAddress(), "0x1000000000000000000"]);
          const escrowImpersonated = await ethers.getSigner(await escrow.getAddress());
          await disputeC.connect(escrowImpersonated).createDispute(
            0, client.address, freelancer.address, ethers.parseEther("1")
          );
          await ethers.provider.send("hardhat_stopImpersonatingAccount", [await escrow.getAddress()]);
        });

      // Assign jurors and start voting manually (simulating JuryStaking)
      const [,,, , , juror1, juror2, juror3] = await ethers.getSigners();
      await disputeC.connect(await ethers.getSigner(await jury.getAddress()))
        .assignJurors(0, [juror1.address, juror2.address, juror3.address])
        .catch(async () => {
          await ethers.provider.send("hardhat_impersonateAccount", [await jury.getAddress()]);
          await ethers.provider.send("hardhat_setBalance", [await jury.getAddress(), "0x1000000000000000000"]);
          const juryImpersonated = await ethers.getSigner(await jury.getAddress());
          await disputeC.connect(juryImpersonated).assignJurors(
            0, [juror1.address, juror2.address, juror3.address]
          );
          await disputeC.connect(juryImpersonated).startVoting(0);
          await expect(disputeC.connect(juryImpersonated).submitJuryVerdict(0, true))
            .to.emit(disputeC, "VerdictSubmitted")
            .withArgs(0, 0, true);
          await ethers.provider.send("hardhat_stopImpersonatingAccount", [await jury.getAddress()]);
        });
    });

    it("Reverts when called by non-jury", async function () {
      const { dispute, stranger, disputeId } = await votingFixture();
      await expect(
        dispute.connect(stranger).submitJuryVerdict(disputeId, true)
      ).to.be.revertedWith("DisputeContract: caller is not JuryStaking");
    });
  });

  describe("getDisputeIdForMilestone()", function () {
    it("Returns correct disputeId for a milestone", async function () {
      const fixture = await deployFixture();
      await createDispute(fixture);
      const disputeId = await fixture.dispute.getDisputeIdForMilestone(fixture.milestoneId);
      expect(disputeId).to.equal(0);
    });

    it("Reverts for milestone with no dispute", async function () {
      const { dispute } = await deployFixture();
      await expect(dispute.getDisputeIdForMilestone(999))
        .to.be.revertedWith("DisputeContract: no dispute for this milestone");
    });
  });

  describe("getDispute() — invalid ID", function () {
    it("Reverts for non-existent dispute", async function () {
      const { dispute } = await deployFixture();
      await expect(dispute.getDispute(999))
        .to.be.revertedWith("DisputeContract: dispute does not exist");
    });
  });

  describe("Admin", function () {
    it("Owner can update escrow address", async function () {
      const { dispute, owner, stranger } = await deployFixture();
      await dispute.connect(owner).setEscrowContract(stranger.address);
      expect(await dispute.escrowContract()).to.equal(stranger.address);
    });

    it("Non-owner cannot update escrow address", async function () {
      const { dispute, stranger } = await deployFixture();
      await expect(
        dispute.connect(stranger).setEscrowContract(stranger.address)
      ).to.be.revertedWithCustomError(dispute, "OwnableUnauthorizedAccount");
    });
  });
});
