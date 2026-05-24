// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraEscrow} from "../src/NexoraEscrow.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address value);
    function envOr(string calldata key, address defaultValue) external view returns (address value);
}

contract DeployNexoraEscrow {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    struct DeployedEscrow {
        address escrowImplementation;
        address escrowProxy;
    }

    function run() external returns (DeployedEscrow memory deployed) {
        address owner = vm.envOr("OWNER_ADDRESS", tx.origin);
        address usdc = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);
        address treasury = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast();
        NexoraEscrow escrowImplementation = new NexoraEscrow();
        NexoraProxy escrowProxy = new NexoraProxy(
            address(escrowImplementation),
            abi.encodeCall(NexoraEscrow.initialize, (owner, usdc, treasury))
        );
        vm.stopBroadcast();

        deployed = DeployedEscrow({
            escrowImplementation: address(escrowImplementation),
            escrowProxy: address(escrowProxy)
        });
    }
}
