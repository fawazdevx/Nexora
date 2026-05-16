// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {XyloNetUsdcVaultStrategy} from "../src/strategies/XyloNetUsdcVaultStrategy.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";

interface Vm {
    function envAddress(string calldata key) external view returns (address value);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployXyloNetStrategy {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant XYLONET_ARC_TESTNET_VAULT = 0x240Eb85458CD41361bd8C3773253a1D78054f747;

    function run() external returns (address strategy, uint256 strategyId) {
        address router = vm.envAddress("YIELD_ROUTER_PROXY_ADDRESS");
        uint256 expectedApyBps = vm.envOr("XYLONET_EXPECTED_APY_BPS", uint256(0));
        require(expectedApyBps <= type(uint16).max, "APY_BPS_TOO_HIGH");

        vm.startBroadcast();

        strategy = address(new XyloNetUsdcVaultStrategy(ARC_TESTNET_USDC, XYLONET_ARC_TESTNET_VAULT, router));
        strategyId = NexoraYieldRouter(router).addStrategy(strategy, "XyloNet", uint16(expectedApyBps));

        vm.stopBroadcast();
    }
}
