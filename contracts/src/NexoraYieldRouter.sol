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

    event VaultSet(address indexed vault);
    event AiOperatorSet(address indexed aiOperator);
    event StrategyAdded(uint256 indexed strategyId, address indexed adapter, string protocol, uint16 expectedApyBps);
    event StrategyActivated(uint256 indexed strategyId, string protocol, uint16 expectedApyBps);
    event DepositedToStrategy(uint256 indexed strategyId, uint256 amount);
    event WithdrawnFromStrategy(uint256 indexed strategyId, address indexed recipient, uint256 requested, uint256 withdrawn);

    error NotVault();
    error NotAiOperatorOrOwner();
    error InvalidStrategy();
    error TransferFailed();
    error InsufficientLiquidity();

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
        activeStrategyId = strategyId;
        emit StrategyActivated(strategyId, strategy.protocol, strategy.expectedApyBps);
    }

    function depositBest(uint256 amount) external onlyVault {
        if (amount == 0) return;

        Strategy memory strategy = strategies[activeStrategyId];
        if (!strategy.active) {
            if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
            return;
        }

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        usdc.approve(strategy.adapter, amount);
        IYieldStrategy(strategy.adapter).deposit(amount);
        emit DepositedToStrategy(activeStrategyId, amount);
    }

    function withdrawTo(uint256 amount, address recipient) external onlyVault returns (uint256 withdrawn) {
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
