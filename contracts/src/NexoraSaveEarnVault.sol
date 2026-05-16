// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";
import {NexoraYieldRouter} from "./NexoraYieldRouter.sol";

contract NexoraSaveEarnVault is NexoraUpgradeable {
    IERC20 public usdc;
    NexoraYieldRouter public yieldRouter;
    address public treasury;
    uint16 public withdrawalFeeBps;
    uint256 public totalShares;

    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 fee, uint256 shares);
    event TreasuryUpdated(address indexed treasury);
    event WithdrawalFeeUpdated(uint16 withdrawalFeeBps);
    event YieldRouterUpdated(address indexed yieldRouter);

    error ZeroAmount();
    error InsufficientShares();
    error TransferFailed();

    function initialize(
        address initialOwner,
        address usdc_,
        address yieldRouter_,
        address treasury_,
        uint16 withdrawalFeeBps_
    ) external {
        __Nexora_init(initialOwner);
        require(usdc_ != address(0), "ZERO_USDC");
        require(yieldRouter_ != address(0), "ZERO_ROUTER");
        require(treasury_ != address(0), "ZERO_TREASURY");
        require(withdrawalFeeBps_ <= 2_000, "FEE_TOO_HIGH");

        usdc = IERC20(usdc_);
        yieldRouter = NexoraYieldRouter(yieldRouter_);
        treasury = treasury_;
        withdrawalFeeBps = withdrawalFeeBps_;
        emit YieldRouterUpdated(yieldRouter_);
        emit TreasuryUpdated(treasury_);
        emit WithdrawalFeeUpdated(withdrawalFeeBps_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "ZERO_TREASURY");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setWithdrawalFeeBps(uint16 withdrawalFeeBps_) external onlyOwner {
        require(withdrawalFeeBps_ <= 2_000, "FEE_TOO_HIGH");
        withdrawalFeeBps = withdrawalFeeBps_;
        emit WithdrawalFeeUpdated(withdrawalFeeBps_);
    }

    function setYieldRouter(address yieldRouter_) external onlyOwner {
        require(yieldRouter_ != address(0), "ZERO_ROUTER");
        yieldRouter = NexoraYieldRouter(yieldRouter_);
        emit YieldRouterUpdated(yieldRouter_);
    }

    function totalAssets() public view returns (uint256) {
        return yieldRouter.totalAssets();
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalShares;
        uint256 assetsBefore = totalAssets();
        shares = supply == 0 || assetsBefore == 0 ? assets : (assets * supply) / assetsBefore;
    }

    function previewWithdraw(uint256 shares) public view returns (uint256 assets, uint256 fee) {
        if (totalShares == 0) return (0, 0);
        assets = (totalAssets() * shares) / totalShares;
        fee = (assets * withdrawalFeeBps) / 10_000;
    }

    function deposit(uint256 assets) external returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        shares = previewDeposit(assets);
        if (shares == 0) revert ZeroAmount();

        balanceOf[msg.sender] += shares;
        totalShares += shares;

        if (!usdc.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        usdc.approve(address(yieldRouter), assets);
        yieldRouter.depositBest(assets);

        emit Deposited(msg.sender, assets, shares);
    }

    function withdraw(uint256 shares) external returns (uint256 assetsAfterFee) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < shares) revert InsufficientShares();

        (uint256 assets, uint256 fee) = previewWithdraw(shares);
        balanceOf[msg.sender] -= shares;
        totalShares -= shares;

        uint256 pulled = yieldRouter.withdrawTo(assets, address(this));
        fee = (pulled * withdrawalFeeBps) / 10_000;
        assetsAfterFee = pulled - fee;

        if (fee > 0 && !usdc.transfer(treasury, fee)) revert TransferFailed();
        if (!usdc.transfer(msg.sender, assetsAfterFee)) revert TransferFailed();

        emit Withdrawn(msg.sender, assetsAfterFee, fee, shares);
    }
}
