// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";
import {NexoraYieldRouter} from "./NexoraYieldRouter.sol";

contract NexoraSaveEarnVault is NexoraUpgradeable {
    bytes32 public constant CONSERVATIVE_PROFILE = keccak256("CONSERVATIVE");
    bytes32 public constant BALANCED_PROFILE = keccak256("BALANCED");
    bytes32 public constant GROWTH_PROFILE = keccak256("GROWTH");

    IERC20 public usdc;
    NexoraYieldRouter public yieldRouter;
    address public treasury;
    uint16 public withdrawalFeeBps;
    uint256 public totalShares;

    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public principalOf;
    mapping(bytes32 => NexoraYieldRouter) public profileYieldRouters;
    mapping(bytes32 => uint256) public profileTotalShares;
    mapping(bytes32 => mapping(address => uint256)) public profileBalanceOf;
    mapping(bytes32 => mapping(address => uint256)) public profilePrincipalOf;
    mapping(bytes32 => bool) public profileEnabled;

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 fee, uint256 shares);
    event PrincipalBackfilled(address indexed user, uint256 principal);
    event TreasuryUpdated(address indexed treasury);
    event WithdrawalFeeUpdated(uint16 withdrawalFeeBps);
    event YieldRouterUpdated(address indexed yieldRouter);
    event ProfileConfigured(bytes32 indexed profileId, address indexed yieldRouter, bool enabled);
    event ProfileDeposited(bytes32 indexed profileId, address indexed user, uint256 assets, uint256 shares);
    event ProfileWithdrawn(bytes32 indexed profileId, address indexed user, uint256 assets, uint256 fee, uint256 shares);

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

    function configureProfile(bytes32 profileId, address yieldRouter_, bool enabled) external onlyOwner {
        if (!_isSupportedProfile(profileId) || profileId == BALANCED_PROFILE) revert InvalidProfile();
        require(yieldRouter_ != address(0), "ZERO_ROUTER");
        profileYieldRouters[profileId] = NexoraYieldRouter(yieldRouter_);
        profileEnabled[profileId] = enabled;
        emit ProfileConfigured(profileId, yieldRouter_, enabled);
    }

    function setProfileEnabled(bytes32 profileId, bool enabled) external onlyOwner {
        if (!_isSupportedProfile(profileId) || profileId == BALANCED_PROFILE) revert InvalidProfile();
        if (address(profileYieldRouters[profileId]) == address(0)) revert InvalidProfile();
        profileEnabled[profileId] = enabled;
        emit ProfileConfigured(profileId, address(profileYieldRouters[profileId]), enabled);
    }

    function backfillPrincipal(address[] calldata users, uint256[] calldata principals) external onlyOwner {
        require(users.length == principals.length, "LENGTH_MISMATCH");
        for (uint256 i = 0; i < users.length; i++) {
            principalOf[users[i]] = principals[i];
            emit PrincipalBackfilled(users[i], principals[i]);
        }
    }

    function totalAssets() public view returns (uint256) {
        return yieldRouter.totalAssets();
    }

    function totalAssetsForProfile(bytes32 profileId) public view returns (uint256) {
        return _routerForProfile(profileId).totalAssets();
    }

    function totalSharesForProfile(bytes32 profileId) public view returns (uint256) {
        if (profileId == BALANCED_PROFILE) return totalShares;
        _requireProfile(profileId);
        return profileTotalShares[profileId];
    }

    function sharesOfProfile(bytes32 profileId, address user) public view returns (uint256) {
        if (profileId == BALANCED_PROFILE) return balanceOf[user];
        _requireProfile(profileId);
        return profileBalanceOf[profileId][user];
    }

    function principalOfProfile(bytes32 profileId, address user) public view returns (uint256) {
        if (profileId == BALANCED_PROFILE) return principalOf[user];
        _requireProfile(profileId);
        return profilePrincipalOf[profileId][user];
    }

    function previewDeposit(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalShares;
        uint256 assetsBefore = totalAssets();
        shares = supply == 0 || assetsBefore == 0 ? assets : (assets * supply) / assetsBefore;
    }

    function previewWithdraw(uint256 shares) public view returns (uint256 assets, uint256 fee) {
        return previewWithdrawFor(msg.sender, shares);
    }

    function previewWithdrawFor(address user, uint256 shares) public view returns (uint256 assets, uint256 fee) {
        if (totalShares == 0) return (0, 0);
        assets = (totalAssets() * shares) / totalShares;
        uint256 userShares = balanceOf[user];
        if (userShares == 0) return (assets, 0);
        uint256 principalPortion = (principalOf[user] * shares) / userShares;
        uint256 profit = assets > principalPortion ? assets - principalPortion : 0;
        fee = (profit * withdrawalFeeBps) / 10_000;
    }

    function previewWithdrawForProfile(bytes32 profileId, address user, uint256 shares)
        public
        view
        returns (uint256 assets, uint256 fee)
    {
        if (profileId == BALANCED_PROFILE) return previewWithdrawFor(user, shares);
        uint256 supply = totalSharesForProfile(profileId);
        if (supply == 0) return (0, 0);
        assets = (totalAssetsForProfile(profileId) * shares) / supply;
        uint256 userShares = sharesOfProfile(profileId, user);
        if (userShares == 0) return (assets, 0);
        uint256 principalPortion = (principalOfProfile(profileId, user) * shares) / userShares;
        uint256 profit = assets > principalPortion ? assets - principalPortion : 0;
        fee = (profit * withdrawalFeeBps) / 10_000;
    }

    function deposit(uint256 assets) external nonReentrant whenNotPaused returns (uint256 shares) {
        return _deposit(BALANCED_PROFILE, assets);
    }

    function depositForProfile(bytes32 profileId, uint256 assets)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        return _deposit(profileId, assets);
    }

    function _deposit(bytes32 profileId, uint256 assets) internal returns (uint256 shares) {
        NexoraYieldRouter router = _routerForProfile(profileId);
        if (assets == 0) revert ZeroAmount();
        uint256 supply = totalSharesForProfile(profileId);
        uint256 assetsBefore = totalAssetsForProfile(profileId);
        shares = supply == 0 || assetsBefore == 0 ? assets : (assets * supply) / assetsBefore;
        if (shares == 0) revert ZeroAmount();

        _increasePosition(profileId, msg.sender, shares, assets);

        if (!usdc.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        usdc.approve(address(router), 0);
        usdc.approve(address(router), assets);
        router.depositBest(assets);

        if (profileId == BALANCED_PROFILE) emit Deposited(msg.sender, assets, shares);
        emit ProfileDeposited(profileId, msg.sender, assets, shares);
    }

    function withdraw(uint256 shares) external nonReentrant whenNotPaused returns (uint256 assetsAfterFee) {
        return _withdraw(BALANCED_PROFILE, shares);
    }

    function withdrawFromProfile(bytes32 profileId, uint256 shares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 assetsAfterFee)
    {
        return _withdraw(profileId, shares);
    }

    function _withdraw(bytes32 profileId, uint256 shares) internal returns (uint256 assetsAfterFee) {
        NexoraYieldRouter router = _routerForProfile(profileId);
        if (shares == 0) revert ZeroAmount();
        uint256 userShares = sharesOfProfile(profileId, msg.sender);
        if (userShares < shares) revert InsufficientShares();

        (uint256 assets, uint256 fee) = previewWithdrawForProfile(profileId, msg.sender, shares);
        uint256 principalPortion = (principalOfProfile(profileId, msg.sender) * shares) / userShares;
        _decreasePosition(profileId, msg.sender, shares, principalPortion);

        uint256 pulled = router.withdrawTo(assets, address(this));
        uint256 pulledProfit = pulled > principalPortion ? pulled - principalPortion : 0;
        fee = (pulledProfit * withdrawalFeeBps) / 10_000;
        assetsAfterFee = pulled - fee;

        if (fee > 0 && !usdc.transfer(treasury, fee)) revert TransferFailed();
        if (!usdc.transfer(msg.sender, assetsAfterFee)) revert TransferFailed();

        if (profileId == BALANCED_PROFILE) emit Withdrawn(msg.sender, assetsAfterFee, fee, shares);
        emit ProfileWithdrawn(profileId, msg.sender, assetsAfterFee, fee, shares);
    }

    function _increasePosition(bytes32 profileId, address user, uint256 shares, uint256 assets) internal {
        if (profileId == BALANCED_PROFILE) {
            balanceOf[user] += shares;
            principalOf[user] += assets;
            totalShares += shares;
            return;
        }
        profileBalanceOf[profileId][user] += shares;
        profilePrincipalOf[profileId][user] += assets;
        profileTotalShares[profileId] += shares;
    }

    function _decreasePosition(bytes32 profileId, address user, uint256 shares, uint256 principal) internal {
        if (profileId == BALANCED_PROFILE) {
            balanceOf[user] -= shares;
            principalOf[user] -= principal;
            totalShares -= shares;
            return;
        }
        profileBalanceOf[profileId][user] -= shares;
        profilePrincipalOf[profileId][user] -= principal;
        profileTotalShares[profileId] -= shares;
    }

    function _routerForProfile(bytes32 profileId) internal view returns (NexoraYieldRouter router) {
        if (profileId == BALANCED_PROFILE) return yieldRouter;
        _requireProfile(profileId);
        router = profileYieldRouters[profileId];
    }

    function _requireProfile(bytes32 profileId) internal view {
        if (!_isSupportedProfile(profileId) || !profileEnabled[profileId]) revert InvalidProfile();
        if (address(profileYieldRouters[profileId]) == address(0)) revert InvalidProfile();
    }

    function _isSupportedProfile(bytes32 profileId) internal pure returns (bool) {
        return profileId == CONSERVATIVE_PROFILE || profileId == BALANCED_PROFILE || profileId == GROWTH_PROFILE;
    }

    error InvalidProfile();
}
