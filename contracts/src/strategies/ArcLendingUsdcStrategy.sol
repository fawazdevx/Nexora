// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {IYieldStrategy} from "../interfaces/IYieldStrategy.sol";

interface IArcLendingPoolLike {
    function supply(address asset, uint256 amount, address onBehalfOf) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract ArcLendingUsdcStrategy is IYieldStrategy {
    IERC20 public immutable usdc;
    IERC20 public immutable receiptToken;
    IArcLendingPoolLike public immutable pool;
    address public immutable router;
    string public protocol;

    error NotRouter();
    error TransferFailed();

    constructor(address usdc_, address receiptToken_, address pool_, address router_, string memory protocol_) {
        require(usdc_ != address(0), "ZERO_USDC");
        require(receiptToken_ != address(0), "ZERO_RECEIPT");
        require(pool_ != address(0), "ZERO_POOL");
        require(router_ != address(0), "ZERO_ROUTER");

        usdc = IERC20(usdc_);
        receiptToken = IERC20(receiptToken_);
        pool = IArcLendingPoolLike(pool_);
        router = router_;
        protocol = protocol_;
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    function totalAssets() external view returns (uint256) {
        return receiptToken.balanceOf(address(this));
    }

    function deposit(uint256 amount) external onlyRouter {
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        usdc.approve(address(pool), 0);
        usdc.approve(address(pool), amount);
        pool.supply(address(usdc), amount, address(this));
    }

    function withdraw(uint256 amount, address recipient) external onlyRouter returns (uint256 withdrawn) {
        withdrawn = pool.withdraw(address(usdc), amount, recipient);
    }
}
