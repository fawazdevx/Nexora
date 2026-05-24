// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
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
    function envOr(string calldata key, address defaultValue) external view returns (address value);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256 value);
}

contract DeployNexoraUpgradeable {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    struct DeployedContracts {
        address policyImplementation;
        address policyProxy;
        address reputationImplementation;
        address reputationProxy;
        address ledgerImplementation;
        address ledgerProxy;
        address yieldRouterImplementation;
        address yieldRouterProxy;
        address saveEarnVaultImplementation;
        address saveEarnVaultProxy;
        address escrowImplementation;
        address escrowProxy;
    }

    function run() external returns (DeployedContracts memory deployed) {
        address owner = vm.envOr("OWNER_ADDRESS", tx.origin);
        address usdc = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);
        address treasury = vm.envOr("TREASURY_ADDRESS", owner);
        address aiOperator = vm.envOr("AI_OPERATOR_ADDRESS", owner);
        uint16 feeBps = uint16(vm.envOr("NEXORA_FEE_BPS", uint256(250)));
        uint16 withdrawalFeeBps = uint16(vm.envOr("NEXORA_WITHDRAWAL_FEE_BPS", uint256(100)));

        vm.startBroadcast();
        deployed = deploy(owner, usdc, treasury, aiOperator, feeBps, withdrawalFeeBps);
        vm.stopBroadcast();
    }

    function deploy(
        address owner,
        address usdc,
        address treasury,
        address aiOperator,
        uint16 feeBps,
        uint16 withdrawalFeeBps
    ) public returns (DeployedContracts memory deployed) {
        NexoraPolicyRegistry policyImplementation = new NexoraPolicyRegistry();
        NexoraProxy policyProxy = new NexoraProxy(
            address(policyImplementation),
            abi.encodeCall(NexoraPolicyRegistry.initialize, (owner))
        );

        OperatorReputation reputationImplementation = new OperatorReputation();
        NexoraProxy reputationProxy = new NexoraProxy(
            address(reputationImplementation),
            abi.encodeCall(OperatorReputation.initialize, (owner))
        );

        X402FacilitatorLedger ledgerImplementation = new X402FacilitatorLedger();
        NexoraProxy ledgerProxy = new NexoraProxy(
            address(ledgerImplementation),
            abi.encodeCall(
                X402FacilitatorLedger.initialize,
                (owner, usdc, address(policyProxy), address(reputationProxy), treasury, feeBps)
            )
        );

        NexoraYieldRouter yieldRouterImplementation = new NexoraYieldRouter();
        NexoraProxy yieldRouterProxy = new NexoraProxy(
            address(yieldRouterImplementation),
            abi.encodeCall(NexoraYieldRouter.initialize, (owner, usdc, aiOperator))
        );

        NexoraSaveEarnVault saveEarnVaultImplementation = new NexoraSaveEarnVault();
        NexoraProxy saveEarnVaultProxy = new NexoraProxy(
            address(saveEarnVaultImplementation),
            abi.encodeCall(
                NexoraSaveEarnVault.initialize,
                (owner, usdc, address(yieldRouterProxy), treasury, withdrawalFeeBps)
            )
        );

        NexoraEscrow escrowImplementation = new NexoraEscrow();
        NexoraProxy escrowProxy = new NexoraProxy(
            address(escrowImplementation),
            abi.encodeCall(NexoraEscrow.initialize, (owner, usdc, treasury))
        );

        NexoraPolicyRegistry(address(policyProxy)).setFacilitator(address(ledgerProxy), true);
        OperatorReputation(address(reputationProxy)).setUpdater(address(ledgerProxy), true);
        NexoraYieldRouter(address(yieldRouterProxy)).setVault(address(saveEarnVaultProxy));

        deployed = DeployedContracts({
            policyImplementation: address(policyImplementation),
            policyProxy: address(policyProxy),
            reputationImplementation: address(reputationImplementation),
            reputationProxy: address(reputationProxy),
            ledgerImplementation: address(ledgerImplementation),
            ledgerProxy: address(ledgerProxy),
            yieldRouterImplementation: address(yieldRouterImplementation),
            yieldRouterProxy: address(yieldRouterProxy),
            saveEarnVaultImplementation: address(saveEarnVaultImplementation),
            saveEarnVaultProxy: address(saveEarnVaultProxy),
            escrowImplementation: address(escrowImplementation),
            escrowProxy: address(escrowProxy)
        });
    }
}
