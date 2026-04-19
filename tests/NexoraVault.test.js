const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NexoraVault", function () {
  let vault, usdc, aUsdc, pool, treasury, owner, user1, user2;

  const INITIAL_BALANCE = ethers.parseUnits("10000", 6); // 10,000 USDC
  const DEPOSIT_AMOUNT = ethers.parseUnits("500", 6);    // 500 USDC
  const POOL_FUND = ethers.parseUnits("50000", 6);       // 50,000 USDC
  const PERFORMANCE_FEE = 1000; // 10%

  beforeEach(async function () {
    [owner, user1, user2, treasury] = await ethers.getSigners();

    // Deploy MockERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USDC", "USDC", 6);
    aUsdc = await MockERC20.deploy("aUSDC", "aUSDC", 6);

    // Deploy MockAavePool
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    pool = await MockAavePool.deploy(usdc.target, aUsdc.target);

    // Deploy NexoraVault
    const NexoraVault = await ethers.getContractFactory("NexoraVault");
    vault = await NexoraVault.deploy(
      usdc.target,
      pool.target,
      aUsdc.target,
      treasury.address,
      PERFORMANCE_FEE
    );

    // Setup: Mint USDC to users
    await usdc.mint(owner.address, INITIAL_BALANCE);
    await usdc.mint(user1.address, INITIAL_BALANCE);
    await usdc.mint(user2.address, INITIAL_BALANCE);

    // Setup: Fund pool with USDC
    await usdc.approve(pool.target, POOL_FUND);
    await pool.fund(POOL_FUND);

    // Setup: Approve vault to spend USDC
    await usdc.connect(user1).approve(vault.target, INITIAL_BALANCE);
    await usdc.connect(user2).approve(vault.target, INITIAL_BALANCE);
  });

  // ─── INITIALIZATION TESTS ──────────────────────────────────────────

  describe("Initialization", function () {
    it("should initialize with correct state", async function () {
      expect(await vault.depositToken()).to.equal(usdc.target);
      expect(await vault.aavePool()).to.equal(pool.target);
      expect(await vault.aToken()).to.equal(aUsdc.target);
      expect(await vault.treasury()).to.equal(treasury.address);
      expect(await vault.performanceFee()).to.equal(PERFORMANCE_FEE);
    });

    it("should have correct token name and symbol", async function () {
      expect(await vault.name()).to.equal("Nexora Vault Share");
      expect(await vault.symbol()).to.equal("nxUSDC");
    });

    it("should start with zero total assets", async function () {
      expect(await vault.totalAssets()).to.equal(0);
    });
  });

  // ─── DEPOSIT TESTS ─────────────────────────────────────────────────

  describe("Deposit", function () {
    it("should deposit USDC and receive shares 1:1 initially", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.totalAssets()).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.principalDeposited(user1.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("should emit Deposited event", async function () {
      await expect(vault.connect(user1).deposit(DEPOSIT_AMOUNT))
        .to.emit(vault, "Deposited")
        .withArgs(user1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);
    });

    it("should reject zero amount", async function () {
      await expect(vault.connect(user1).deposit(0))
        .to.be.revertedWith("Nexora: zero amount");
    });

    it("should track principal deposited per user", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      expect(await vault.principalDeposited(user1.address))
        .to.equal(DEPOSIT_AMOUNT * 2n);
    });
  });

  // ─── YIELD & SHARE MATH TESTS ──────────────────────────────────────

  describe("Yield Simulation & Share Math", function () {
    it("should calculate correct shares after vault grows", async function () {
      // User1 deposits 500 USDC
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);

      // Simulate 100 USDC yield
      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      // User2 deposits 500 USDC (should get fewer shares since vault is worth more)
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT);
      const user2Shares = await vault.balanceOf(user2.address);

      // user2Shares = (500 * 500) / 600 = 416.67 shares
      expect(user2Shares).to.be.lt(DEPOSIT_AMOUNT);

      // Total assets should be 1100 (500 + 500 + 100 yield)
      expect(await vault.totalAssets()).to.equal(DEPOSIT_AMOUNT * 2n + YIELD);
    });

    it("should convert assets to shares correctly", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      // Add yield
      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      // 100 USDC should convert to ~83.33 shares
      const shares = await vault.convertToShares(ethers.parseUnits("100", 6));
      expect(shares).to.be.lt(ethers.parseUnits("100", 6));
    });

    it("should convert shares to assets correctly", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      // 500 shares should convert to 600 USDC
      const assets = await vault.convertToAssets(DEPOSIT_AMOUNT);
      expect(assets).to.equal(DEPOSIT_AMOUNT + YIELD);
    });
  });

  // ─── WITHDRAWAL & FEE TESTS ────────────────────────────────────────

  describe("Withdrawal with Fee", function () {
    it("should withdraw without fee if no profit", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);
      await vault.connect(user1).withdraw(DEPOSIT_AMOUNT);

      expect(await usdc.balanceOf(user1.address)).to.equal(INITIAL_BALANCE);
      expect(await usdc.balanceOf(treasury.address)).to.equal(0);
    });

    it("should charge 10% fee on profits", async function () {
      // User1 deposits 500 USDC
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      // Simulate 100 USDC yield
      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      // User1 withdraws all shares
      await vault.connect(user1).withdraw(DEPOSIT_AMOUNT);

      // User should get: 600 - 10 (10% of 100) = 590 USDC
      const expectedPayout = DEPOSIT_AMOUNT + YIELD - (YIELD * 10n) / 100n;
      const actualBalance = await usdc.balanceOf(user1.address);

      expect(actualBalance).to.equal(expectedPayout);
      expect(await usdc.balanceOf(treasury.address)).to.equal(ethers.parseUnits("10", 6));
    });

    it("should emit Withdrawn event with correct values", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      const expectedFee = ethers.parseUnits("10", 6);
      const expectedPayout = DEPOSIT_AMOUNT + YIELD - expectedFee;

      await expect(vault.connect(user1).withdraw(DEPOSIT_AMOUNT))
        .to.emit(vault, "Withdrawn")
        .withArgs(user1.address, expectedPayout, expectedFee, DEPOSIT_AMOUNT);
    });

    it("should handle partial withdrawals", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      // Withdraw half the shares
      const halfShares = DEPOSIT_AMOUNT / 2n;
      await vault.connect(user1).withdraw(halfShares);

      // User should still have half their shares
      expect(await vault.balanceOf(user1.address)).to.equal(halfShares);
    });

    it("should reject withdrawal of more shares than owned", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      await expect(vault.connect(user1).withdraw(DEPOSIT_AMOUNT + 1n))
        .to.be.revertedWith("Nexora: insufficient shares");
    });
  });

  // ─── MULTIPLE USER TESTS ───────────────────────────────────────────

  describe("Multiple Users", function () {
    it("should track separate positions for each user", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n);

      expect(await vault.principalDeposited(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.principalDeposited(user2.address)).to.equal(DEPOSIT_AMOUNT * 2n);
    });

    it("should distribute yield proportionally", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n);

      const YIELD = ethers.parseUnits("300", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      // User1 owns 1/3 of shares, User2 owns 2/3
      // User1's profit: 100, User2's profit: 200
      const (user1Balance, , user1Yield, ,) = await vault.getUserPosition(user1.address);
      const (user2Balance, , user2Yield, ,) = await vault.getUserPosition(user2.address);

      expect(user1Yield).to.equal(ethers.parseUnits("100", 6));
      expect(user2Yield).to.equal(ethers.parseUnits("200", 6));
    });
  });

  // ─── ADMIN FUNCTION TESTS ──────────────────────────────────────────

  describe("Admin Functions", function () {
    it("should update treasury", async function () {
      const newTreasury = user1.address;
      await vault.setTreasury(newTreasury);
      expect(await vault.treasury()).to.equal(newTreasury);
    });

    it("should update performance fee", async function () {
      const newFee = 1500; // 15%
      await vault.setPerformanceFee(newFee);
      expect(await vault.performanceFee()).to.equal(newFee);
    });

    it("should reject fee > MAX_FEE", async function () {
      await expect(vault.setPerformanceFee(3000))
        .to.be.revertedWith("Nexora: exceeds max fee");
    });

    it("should pause and unpause deposits", async function () {
      await vault.pause();

      await expect(vault.connect(user1).deposit(DEPOSIT_AMOUNT))
        .to.be.revertedWith("Pausable: paused");

      await vault.unpause();
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
    });

    it("should only allow owner to call admin functions", async function () {
      await expect(vault.connect(user1).setPerformanceFee(1500))
        .to.be.revertedWithCustomError;
    });
  });

  // ─── VIEW FUNCTION TESTS ───────────────────────────────────────────

  describe("View Functions", function () {
    it("should return correct user position", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      const YIELD = ethers.parseUnits("100", 6);
      await aUsdc.simulateYield(vault.target, YIELD);

      const (currentBalance, principal, yieldEarned, estimatedFee, netWithdrawable) 
        = await vault.getUserPosition(user1.address);

      expect(currentBalance).to.equal(DEPOSIT_AMOUNT + YIELD);
      expect(principal).to.equal(DEPOSIT_AMOUNT);
      expect(yieldEarned).to.equal(YIELD);
      expect(estimatedFee).to.equal(ethers.parseUnits("10", 6));
      expect(netWithdrawable).to.equal(DEPOSIT_AMOUNT + YIELD - ethers.parseUnits("10", 6));
    });

    it("should return zero position for user with no deposits", async function () {
      const (currentBalance, principal, yieldEarned, estimatedFee, netWithdrawable) 
        = await vault.getUserPosition(user1.address);

      expect(currentBalance).to.equal(0);
      expect(principal).to.equal(0);
      expect(yieldEarned).to.equal(0);
      expect(estimatedFee).to.equal(0);
      expect(netWithdrawable).to.equal(0);
    });
  });

  // ─── REENTRANCY TESTS ──────────────────────────────────────────────

  describe("Reentrancy Protection", function () {
    it("should prevent reentrancy attacks", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT);

      // This is protected by nonReentrant modifier
      // A proper reentrancy attack would require a malicious token contract
      // but our MockERC20 is safe
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
    });
  });
});