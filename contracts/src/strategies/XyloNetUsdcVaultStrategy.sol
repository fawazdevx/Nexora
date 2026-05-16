// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";

interface IERC4626Like {
    function asset() external view returns (address);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
}

contract XyloNetUsdcVaultStrategy is IYieldStrategy {
    IERC20 public immutable usdc;
    IERC4626Like public immutable vault;
    address public immutable router;
    string public protocol;

    event Deposited(uint256 assets, uint256 shares);
    event Withdrawn(uint256 requestedAssets, uint256 withdrawnAssets, uint256 sharesBurned, address indexed recipient);

    error NotRouter();
    error TransferFailed();
    error AssetMismatch();
    error ZeroAmount();

    constructor(address usdc_, address xyloVault_, address router_) {
        require(usdc_ != address(0), "ZERO_USDC");
        require(xyloVault_ != address(0), "ZERO_VAULT");
        require(router_ != address(0), "ZERO_ROUTER");

        usdc = IERC20(usdc_);
        vault = IERC4626Like(xyloVault_);
        router = router_;
        protocol = "XyloNet";

        if (vault.asset() != usdc_) revert AssetMismatch();
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    function totalAssets() external view returns (uint256) {
        uint256 idle = usdc.balanceOf(address(this));
        uint256 shares = vault.balanceOf(address(this));
        return idle + vault.convertToAssets(shares);
    }

    function deposit(uint256 amount) external onlyRouter {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        usdc.approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, address(this));

        emit Deposited(amount, shares);
    }

    function withdraw(uint256 amount, address recipient) external onlyRouter returns (uint256 withdrawn) {
        if (amount == 0) revert ZeroAmount();

        uint256 idle = usdc.balanceOf(address(this));
        uint256 fromIdle = amount <= idle ? amount : idle;
        if (fromIdle > 0) {
            if (!usdc.transfer(recipient, fromIdle)) revert TransferFailed();
            withdrawn += fromIdle;
        }

        uint256 remaining = amount - fromIdle;
        uint256 sharesBurned;
        if (remaining > 0) {
            sharesBurned = vault.withdraw(remaining, recipient, address(this));
            withdrawn += remaining;
        }

        emit Withdrawn(amount, withdrawn, sharesBurned, recipient);
    }

    function previewSharesForWithdraw(uint256 assets) external view returns (uint256) {
        return vault.previewWithdraw(assets);
    }
}
