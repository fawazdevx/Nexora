// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {OperatorReputation} from "../src/OperatorReputation.sol";
import {X402FacilitatorLedger} from "../src/X402FacilitatorLedger.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";
import {NexoraSaveEarnVault} from "../src/NexoraSaveEarnVault.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address value);
}

contract UpgradePolicyRegistry {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation) {
        address proxy = vm.envAddress("POLICY_REGISTRY_PROXY_ADDRESS");

        vm.startBroadcast();
        implementation = address(new NexoraPolicyRegistry());
        NexoraPolicyRegistry(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }
}

contract UpgradeOperatorReputation {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation) {
        address proxy = vm.envAddress("OPERATOR_REPUTATION_PROXY_ADDRESS");

        vm.startBroadcast();
        implementation = address(new OperatorReputation());
        OperatorReputation(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }
}

contract UpgradeX402Ledger {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation) {
        address proxy = vm.envAddress("X402_LEDGER_PROXY_ADDRESS");

        vm.startBroadcast();
        implementation = address(new X402FacilitatorLedger());
        X402FacilitatorLedger(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }
}

contract UpgradeYieldRouter {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation) {
        address proxy = vm.envAddress("YIELD_ROUTER_PROXY_ADDRESS");

        vm.startBroadcast();
        implementation = address(new NexoraYieldRouter());
        NexoraYieldRouter(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }
}

contract UpgradeSaveEarnVault {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation) {
        address proxy = vm.envAddress("SAVE_EARN_VAULT_PROXY_ADDRESS");

        vm.startBroadcast();
        implementation = address(new NexoraSaveEarnVault());
        NexoraSaveEarnVault(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }
}
