// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IYieldStrategy} from "./interfaces/IYieldStrategy.sol";
import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";

contract NexoraYieldRouter is NexoraUpgradeable {
    struct Strategy {
        address adapter;
        string protocol;
        uint16 expectedApyBps;
        bool active;
    }

    IERC20 public usdc;
    address public vault;
    address public aiOperator;
    uint256 public activeStrategyId;
    uint256 public nextStrategyId;

    mapping(uint256 => Strategy) public strategies;
    uint64 public lastRebalancedAt;
    uint64 public minRebalanceInterval;
    uint16 public maxRebalanceLossBps;
    mapping(uint256 => uint16) public strategyRiskScoreBps;
    mapping(uint256 => bool) public strategyRiskConfigured;
    uint16 public maximumStrategyRiskBps;
    bool public profileRiskControlsConfigured;

    event VaultSet(address indexed vault);
    event AiOperatorSet(address indexed aiOperator);
    event StrategyAdded(uint256 indexed strategyId, address indexed adapter, string protocol, uint16 expectedApyBps);
    event StrategyActivated(uint256 indexed strategyId, string protocol, uint16 expectedApyBps);
    event StrategyStatusUpdated(uint256 indexed strategyId, bool active);
    event RebalanceControlsUpdated(uint64 minRebalanceInterval, uint16 maxRebalanceLossBps);
    event StrategyRiskUpdated(uint256 indexed strategyId, uint16 riskScoreBps);
    event ProfileRiskLimitUpdated(uint16 maximumStrategyRiskBps);
    event StrategyRebalanced(
        uint256 indexed previousStrategyId,
        uint256 indexed nextStrategyId,
        uint256 sourceAssets,
        uint256 assetsRouted
    );
    event DepositedToStrategy(uint256 indexed strategyId, uint256 amount);
    event WithdrawnFromStrategy(uint256 indexed strategyId, address indexed recipient, uint256 requested, uint256 withdrawn);

    error NotVault();
    error NotAiOperatorOrOwner();
    error InvalidStrategy();
    error TransferFailed();
    error InsufficientLiquidity();
    error RebalanceTooSoon();
    error RebalanceLossExceeded();
    error StrategyHasAssets();
    error StrategyAlreadyActive();
    error StrategyRiskNotAllowed();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyAiOperatorOrOwner() {
        if (msg.sender != owner && msg.sender != aiOperator) revert NotAiOperatorOrOwner();
        _;
    }

    function initialize(address initialOwner, address usdc_, address aiOperator_) external {
        __Nexora_init(initialOwner);
        require(usdc_ != address(0), "ZERO_USDC");
        require(aiOperator_ != address(0), "ZERO_OPERATOR");
        usdc = IERC20(usdc_);
        aiOperator = aiOperator_;
        nextStrategyId = 1;
    }

    function setVault(address vault_) external onlyOwner {
        require(vault_ != address(0), "ZERO_VAULT");
        vault = vault_;
        emit VaultSet(vault_);
    }

    function setAiOperator(address aiOperator_) external onlyOwner {
        require(aiOperator_ != address(0), "ZERO_OPERATOR");
        aiOperator = aiOperator_;
        emit AiOperatorSet(aiOperator_);
    }

    function setRebalanceControls(uint64 minRebalanceInterval_, uint16 maxRebalanceLossBps_) external onlyOwner {
        require(maxRebalanceLossBps_ <= 1_000, "LOSS_TOO_HIGH");
        minRebalanceInterval = minRebalanceInterval_;
        maxRebalanceLossBps = maxRebalanceLossBps_;
        emit RebalanceControlsUpdated(minRebalanceInterval_, maxRebalanceLossBps_);
    }

    function setStrategyRiskScore(uint256 strategyId, uint16 riskScoreBps) external onlyOwner {
        if (strategies[strategyId].adapter == address(0)) revert InvalidStrategy();
        require(riskScoreBps <= 10_000, "RISK_TOO_HIGH");
        strategyRiskScoreBps[strategyId] = riskScoreBps;
        strategyRiskConfigured[strategyId] = true;
        emit StrategyRiskUpdated(strategyId, riskScoreBps);
    }

    function setProfileRiskLimit(uint16 maximumStrategyRiskBps_) external onlyOwner {
        require(maximumStrategyRiskBps_ <= 10_000, "RISK_TOO_HIGH");
        maximumStrategyRiskBps = maximumStrategyRiskBps_;
        profileRiskControlsConfigured = true;
        emit ProfileRiskLimitUpdated(maximumStrategyRiskBps_);
    }

    function addStrategy(address adapter, string calldata protocol, uint16 expectedApyBps)
        external
        onlyOwner
        returns (uint256 strategyId)
    {
        require(adapter != address(0), "ZERO_ADAPTER");
        require(IYieldStrategy(adapter).asset() == address(usdc), "ASSET_MISMATCH");

        strategyId = nextStrategyId++;
        strategies[strategyId] = Strategy({
            adapter: adapter,
            protocol: protocol,
            expectedApyBps: expectedApyBps,
            active: true
        });
        emit StrategyAdded(strategyId, adapter, protocol, expectedApyBps);
    }

    function activateStrategy(uint256 strategyId) external onlyAiOperatorOrOwner {
        Strategy memory strategy = strategies[strategyId];
        if (!strategy.active) revert InvalidStrategy();
        if (strategyId == activeStrategyId) revert StrategyAlreadyActive();
        if (activeStrategyId != 0 && IYieldStrategy(strategies[activeStrategyId].adapter).totalAssets() != 0) {
            revert StrategyHasAssets();
        }
        activeStrategyId = strategyId;
        emit StrategyActivated(strategyId, strategy.protocol, strategy.expectedApyBps);
    }

    function setStrategyActive(uint256 strategyId, bool active) external onlyOwner {
        Strategy storage strategy = strategies[strategyId];
        if (strategy.adapter == address(0)) revert InvalidStrategy();
        if (!active && strategyId == activeStrategyId && IYieldStrategy(strategy.adapter).totalAssets() != 0) {
            revert StrategyHasAssets();
        }
        strategy.active = active;
        emit StrategyStatusUpdated(strategyId, active);
    }

    function rebalanceTo(uint256 strategyId, uint256 minAssetsOut)
        external
        onlyAiOperatorOrOwner
        nonReentrant
        whenNotPaused
        returns (uint256 assetsRouted)
    {
        Strategy memory nextStrategy = strategies[strategyId];
        if (!nextStrategy.active) revert InvalidStrategy();
        if (
            !profileRiskControlsConfigured
                || !strategyRiskConfigured[strategyId]
                || strategyRiskScoreBps[strategyId] > maximumStrategyRiskBps
        ) revert StrategyRiskNotAllowed();
        uint256 previousStrategyId = activeStrategyId;
        if (strategyId == previousStrategyId) revert StrategyAlreadyActive();
        if (
            lastRebalancedAt != 0
                && minRebalanceInterval != 0
                && block.timestamp < uint256(lastRebalancedAt) + uint256(minRebalanceInterval)
        ) revert RebalanceTooSoon();

        uint256 sourceAssets;
        if (previousStrategyId != 0) {
            Strategy memory previousStrategy = strategies[previousStrategyId];
            if (previousStrategy.active) {
                sourceAssets = IYieldStrategy(previousStrategy.adapter).totalAssets();
                if (sourceAssets != 0) {
                    uint256 balanceBefore = usdc.balanceOf(address(this));
                    IYieldStrategy(previousStrategy.adapter).withdraw(sourceAssets, address(this));
                    uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
                    if (received < minAssetsOut) revert RebalanceLossExceeded();
                    if (
                        received < sourceAssets
                            && (sourceAssets - received) * 10_000
                                > sourceAssets * uint256(maxRebalanceLossBps)
                    ) revert RebalanceLossExceeded();
                }
            }
        }

        assetsRouted = usdc.balanceOf(address(this));
        activeStrategyId = strategyId;
        if (assetsRouted != 0) {
            usdc.approve(nextStrategy.adapter, 0);
            usdc.approve(nextStrategy.adapter, assetsRouted);
            IYieldStrategy(nextStrategy.adapter).deposit(assetsRouted);
        }
        lastRebalancedAt = uint64(block.timestamp);

        emit StrategyActivated(strategyId, nextStrategy.protocol, nextStrategy.expectedApyBps);
        emit StrategyRebalanced(previousStrategyId, strategyId, sourceAssets, assetsRouted);
    }

    function depositBest(uint256 amount) external onlyVault nonReentrant whenNotPaused {
        if (amount == 0) return;

        Strategy memory strategy = strategies[activeStrategyId];
        if (!strategy.active) {
            if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
            return;
        }

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        usdc.approve(strategy.adapter, 0);
        usdc.approve(strategy.adapter, amount);
        IYieldStrategy(strategy.adapter).deposit(amount);
        emit DepositedToStrategy(activeStrategyId, amount);
    }

    function withdrawTo(uint256 amount, address recipient) external onlyVault nonReentrant whenNotPaused returns (uint256 withdrawn) {
        require(recipient != address(0), "ZERO_RECIPIENT");
        uint256 idleBalance = usdc.balanceOf(address(this));
        uint256 fromIdle = amount <= idleBalance ? amount : idleBalance;
        if (fromIdle > 0) {
            if (!usdc.transfer(recipient, fromIdle)) revert TransferFailed();
            withdrawn += fromIdle;
        }

        uint256 remaining = amount - fromIdle;
        if (remaining > 0) {
            Strategy memory strategy = strategies[activeStrategyId];
            if (!strategy.active) revert InsufficientLiquidity();
            withdrawn += IYieldStrategy(strategy.adapter).withdraw(remaining, recipient);
        }

        emit WithdrawnFromStrategy(activeStrategyId, recipient, amount, withdrawn);
    }

    function totalAssets() public view returns (uint256 assets) {
        assets = usdc.balanceOf(address(this));
        Strategy memory strategy = strategies[activeStrategyId];
        if (strategy.active) {
            assets += IYieldStrategy(strategy.adapter).totalAssets();
        }
    }
}
