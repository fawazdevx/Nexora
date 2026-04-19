// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMintable is IERC20 {
    function mint(address to, uint256 amount) external;
}

contract MockAavePool {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    IMintable public aUsdc;

    constructor(address _usdc, address _aUsdc) {
        require(_usdc != address(0), "Invalid USDC");
        require(_aUsdc != address(0), "Invalid aUSDC");
        usdc = IERC20(_usdc);
        aUsdc = IMintable(_aUsdc);
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        require(amount > 0, "Amount must be > 0");
        require(onBehalfOf != address(0), "Invalid onBehalfOf");
        
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        aUsdc.mint(onBehalfOf, amount);
    }

    function withdraw(address, uint256 amount, address to) external returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        require(to != address(0), "Invalid to address");
        require(usdc.balanceOf(address(this)) >= amount, "Insufficient USDC in pool");
        
        usdc.safeTransfer(to, amount);
        return amount;
    }

    function fund(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    function getPoolBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}