// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraX402Settlement} from "../src/NexoraX402Settlement.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envOr(string calldata key, address defaultValue) external view returns (address value);
    function envAddress(string calldata key) external view returns (address value);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256 value);
}

/// @notice Deploys the NexoraX402Settlement contract behind a NexoraProxy on one
///         chain. Run once per chain (Arc, Base, Arbitrum) with the matching RPC.
/// @dev Mirrors DeployNexoraUpgradeable's env-driven pattern. Example:
///      forge script script/DeployNexoraX402Settlement.s.sol:DeployNexoraX402Settlement \
///        --rpc-url $BASE_SEPOLIA_RPC_URL --chain-id $BASE_SEPOLIA_CHAIN_ID \
///        --account deploytestKey --sender $OWNER_ADDRESS --broadcast --legacy -vvv
contract DeployNexoraX402Settlement {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation, address proxy) {
        address owner = vm.envOr("OWNER_ADDRESS", tx.origin);
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", owner);
        uint16 feeBps = uint16(vm.envOr("NEXORA_FEE_BPS", uint256(250)));

        vm.startBroadcast();
        NexoraX402Settlement impl = new NexoraX402Settlement();
        NexoraProxy proxyContract = new NexoraProxy(
            address(impl),
            abi.encodeCall(NexoraX402Settlement.initialize, (owner, usdc, treasury, feeBps))
        );
        vm.stopBroadcast();

        implementation = address(impl);
        proxy = address(proxyContract);
    }
}
