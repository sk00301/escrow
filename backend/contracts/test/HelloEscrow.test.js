const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("HelloEscrow", function () {
  let helloEscrow;
  let owner;
  let otherAccount;

  beforeEach(async function () {
    [owner, otherAccount] = await ethers.getSigners();
    const HelloEscrow = await ethers.getContractFactory("HelloEscrow");
    helloEscrow = await HelloEscrow.deploy("Hello, Escrow World!");
    await helloEscrow.waitForDeployment();   // ethers v6 — NOT .deployed()
  });

  describe("Deployment", function () {
    it("Should set the initial greeting correctly", async function () {
      expect(await helloEscrow.greeting()).to.equal("Hello, Escrow World!");
    });

    it("Should set the deployer as owner", async function () {
      expect(await helloEscrow.owner()).to.equal(owner.address);
    });

    it("Should initialize counter to zero", async function () {
      expect(await helloEscrow.counter()).to.equal(0);
    });
  });

  describe("setGreeting", function () {
    it("Owner can update the greeting", async function () {
      await helloEscrow.setGreeting("Updated greeting");
      expect(await helloEscrow.greeting()).to.equal("Updated greeting");
    });

    it("Should emit GreetingUpdated event with correct args", async function () {
      await expect(helloEscrow.setGreeting("New greeting"))
        .to.emit(helloEscrow, "GreetingUpdated")
        .withArgs("Hello, Escrow World!", "New greeting", owner.address);
    });

    it("Non-owner cannot update the greeting", async function () {
      await expect(
        helloEscrow.connect(otherAccount).setGreeting("Hacked!")
      ).to.be.revertedWithCustomError(helloEscrow, "OwnableUnauthorizedAccount");
    });
  });

  describe("increment", function () {
    it("Anyone can increment the counter", async function () {
      await helloEscrow.connect(otherAccount).increment();
      expect(await helloEscrow.counter()).to.equal(1);
    });

    it("Counter increments correctly across multiple calls", async function () {
      await helloEscrow.increment();
      await helloEscrow.increment();
      await helloEscrow.increment();
      expect(await helloEscrow.counter()).to.equal(3);
    });

    it("Should emit CounterIncremented event", async function () {
      await expect(helloEscrow.increment())
        .to.emit(helloEscrow, "CounterIncremented")
        .withArgs(1);
    });
  });

  describe("getState", function () {
    it("Returns both greeting and counter together", async function () {
      await helloEscrow.increment();
      const [g, c] = await helloEscrow.getState();
      expect(g).to.equal("Hello, Escrow World!");
      expect(c).to.equal(1);
    });
  });
});
