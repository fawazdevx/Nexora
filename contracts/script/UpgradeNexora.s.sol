// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {OperatorReputation} from "../src/OperatorReputation.sol";
import {X402FacilitatorLedger} from "../src/X402FacilitatorLedger.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";
import {NexoraSaveEarnVault} from "../src/NexoraSaveEarnVault.sol";
import {NexoraEscrow} from "../src/NexoraEscrow.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address value);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256 value);
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

contract ConfigureYieldRouterOptimizer {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        address proxy = vm.envAddress("YIELD_ROUTER_PROXY_ADDRESS");
        address aiOperator = vm.envAddress("AI_OPERATOR_ADDRESS");
        uint256 intervalSeconds = vm.envOr("SAVE_EARN_OPTIMIZER_INTERVAL_SECONDS", uint256(1 days));
        uint256 maxMigrationLossBps = vm.envOr("SAVE_EARN_OPTIMIZER_MAX_MIGRATION_LOSS_BPS", uint256(25));
        uint256 activeStrategyId = vm.envOr("ACTIVE_STRATEGY_ID", uint256(1));
        uint256 riskScoreBps = vm.envOr("XYLONET_RISK_SCORE_BPS", uint256(3_000));
        uint256 maximumRiskBps = vm.envOr("SAVE_EARN_MAXIMUM_STRATEGY_RISK_BPS", uint256(6_500));
        require(intervalSeconds <= type(uint64).max, "INTERVAL_TOO_HIGH");
        require(maxMigrationLossBps <= 1_000, "LOSS_TOO_HIGH");
        require(riskScoreBps <= 10_000, "RISK_TOO_HIGH");
        require(maximumRiskBps <= 10_000, "MAX_RISK_TOO_HIGH");

        vm.startBroadcast();
        NexoraYieldRouter(proxy).setAiOperator(aiOperator);
        NexoraYieldRouter(proxy).setRebalanceControls(uint64(intervalSeconds), uint16(maxMigrationLossBps));
        NexoraYieldRouter(proxy).setStrategyRiskScore(activeStrategyId, uint16(riskScoreBps));
        NexoraYieldRouter(proxy).setProfileRiskLimit(uint16(maximumRiskBps));
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

contract UpgradeNexoraEscrow {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address implementation) {
        address proxy = vm.envAddress("NEXORA_ESCROW_PROXY_ADDRESS");

        vm.startBroadcast();
        implementation = address(new NexoraEscrow());
        NexoraEscrow(proxy).upgradeTo(implementation);
        vm.stopBroadcast();
    }
}
