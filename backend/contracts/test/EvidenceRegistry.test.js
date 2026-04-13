const { expect } = require("chai");
const { ethers } = require("hardhat");

// ── Fixture ───────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, escrow, freelancer, stranger] = await ethers.getSigners();

  const EvidenceRegistry = await ethers.getContractFactory("EvidenceRegistry");
  const registry = await EvidenceRegistry.deploy(escrow.address);
  await registry.waitForDeployment();

  const contentHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-content"));
  const ipfsCID     = "QmTestCIDabcdef1234567890";
  const milestoneId = 0;

  return { registry, owner, escrow, freelancer, stranger, contentHash, ipfsCID, milestoneId };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EvidenceRegistry", function () {

  describe("Deployment", function () {
    it("Sets escrow contract address correctly", async function () {
      const { registry, escrow } = await deployFixture();
      expect(await registry.escrowContract()).to.equal(escrow.address);
    });
  });

  describe("registerEvidence()", function () {
    it("Registers evidence and emits EvidenceRegistered event", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID, milestoneId } =
        await deployFixture();

      await expect(
        registry.connect(escrow).registerEvidence(
          milestoneId, contentHash, ipfsCID, freelancer.address
        )
      )
        .to.emit(registry, "EvidenceRegistered")
        .withArgs(
          milestoneId,
          contentHash,
          ipfsCID,
          freelancer.address,
          // timestamp — we match any value with a custom predicate below
          (ts) => ts > 0n
        );
    });

    it("Stores all fields correctly", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID, milestoneId } =
        await deployFixture();

      await registry.connect(escrow).registerEvidence(
        milestoneId, contentHash, ipfsCID, freelancer.address
      );

      const [storedHash, storedCID, storedSubmitter, storedTs] =
        await registry.getEvidence(milestoneId);

      expect(storedHash).to.equal(contentHash);
      expect(storedCID).to.equal(ipfsCID);
      expect(storedSubmitter).to.equal(freelancer.address);
      expect(storedTs).to.be.gt(0);
    });

    it("Reverts when called by non-escrow", async function () {
      const { registry, stranger, freelancer, contentHash, ipfsCID, milestoneId } =
        await deployFixture();

      await expect(
        registry.connect(stranger).registerEvidence(
          milestoneId, contentHash, ipfsCID, freelancer.address
        )
      ).to.be.revertedWith("EvidenceRegistry: caller is not the EscrowContract");
    });

    it("Reverts on duplicate registration for same milestoneId", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID, milestoneId } =
        await deployFixture();

      await registry.connect(escrow).registerEvidence(
        milestoneId, contentHash, ipfsCID, freelancer.address
      );

      await expect(
        registry.connect(escrow).registerEvidence(
          milestoneId, contentHash, ipfsCID, freelancer.address
        )
      ).to.be.revertedWith(
        "EvidenceRegistry: evidence already registered for this milestone"
      );
    });

    it("Reverts with empty content hash", async function () {
      const { registry, escrow, freelancer, ipfsCID, milestoneId } = await deployFixture();

      await expect(
        registry.connect(escrow).registerEvidence(
          milestoneId, ethers.ZeroHash, ipfsCID, freelancer.address
        )
      ).to.be.revertedWith("EvidenceRegistry: empty content hash");
    });

    it("Reverts with empty IPFS CID", async function () {
      const { registry, escrow, freelancer, contentHash, milestoneId } = await deployFixture();

      await expect(
        registry.connect(escrow).registerEvidence(
          milestoneId, contentHash, "", freelancer.address
        )
      ).to.be.revertedWith("EvidenceRegistry: empty IPFS CID");
    });

    it("Allows multiple milestones to register independently", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID } = await deployFixture();

      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("second-deliverable"));

      await registry.connect(escrow).registerEvidence(0, contentHash, ipfsCID, freelancer.address);
      await registry.connect(escrow).registerEvidence(1, hash2, "QmSecondCID", freelancer.address);

      const [h1] = await registry.getEvidence(0);
      const [h2] = await registry.getEvidence(1);

      expect(h1).to.equal(contentHash);
      expect(h2).to.equal(hash2);
    });
  });

  describe("getEvidence()", function () {
    it("Reverts when no evidence registered", async function () {
      const { registry } = await deployFixture();
      await expect(registry.getEvidence(999))
        .to.be.revertedWith("EvidenceRegistry: no evidence found for this milestone");
    });
  });

  describe("verifyIntegrity()", function () {
    it("Returns true when hash matches stored hash", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID, milestoneId } =
        await deployFixture();

      await registry.connect(escrow).registerEvidence(
        milestoneId, contentHash, ipfsCID, freelancer.address
      );

      expect(await registry.verifyIntegrity(milestoneId, contentHash)).to.be.true;
    });

    it("Returns false when hash does not match", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID, milestoneId } =
        await deployFixture();

      await registry.connect(escrow).registerEvidence(
        milestoneId, contentHash, ipfsCID, freelancer.address
      );

      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("tampered-content"));
      expect(await registry.verifyIntegrity(milestoneId, wrongHash)).to.be.false;
    });

    it("Returns false when no evidence registered", async function () {
      const { registry } = await deployFixture();
      const anyHash = ethers.keccak256(ethers.toUtf8Bytes("anything"));
      expect(await registry.verifyIntegrity(999, anyHash)).to.be.false;
    });
  });

  describe("hasEvidence()", function () {
    it("Returns false before registration", async function () {
      const { registry } = await deployFixture();
      expect(await registry.hasEvidence(0)).to.be.false;
    });

    it("Returns true after registration", async function () {
      const { registry, escrow, freelancer, contentHash, ipfsCID } = await deployFixture();
      await registry.connect(escrow).registerEvidence(0, contentHash, ipfsCID, freelancer.address);
      expect(await registry.hasEvidence(0)).to.be.true;
    });
  });

  describe("Admin: setEscrowContract()", function () {
    it("Owner can update escrow address", async function () {
      const { registry, owner, stranger } = await deployFixture();
      await registry.connect(owner).setEscrowContract(stranger.address);
      expect(await registry.escrowContract()).to.equal(stranger.address);
    });

    it("Non-owner cannot update escrow address", async function () {
      const { registry, stranger } = await deployFixture();
      await expect(
        registry.connect(stranger).setEscrowContract(stranger.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });
});
