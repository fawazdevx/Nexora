// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {OperatorReputation} from "../src/OperatorReputation.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address value);
    function envOr(string calldata key, address defaultValue) external view returns (address value);
}

/// @notice Deploys Nexora's policy and reputation controls for BOT Chain.
/// @dev Payments continue settling through Meridian/Permit2. The configured
///      Nexora relayer records spend and reputation only after Meridian reports
///      a successful settlement; no BOT-specific Marketplace ledger is needed.
contract DeployNexoraBotCommerce {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct DeployedContracts {
        address policyImplementation;
        address policyProxy;
        address reputationImplementation;
        address reputationProxy;
        address policyRelayer;
    }

    function run() external returns (DeployedContracts memory deployed) {
        address owner = vm.envOr("OWNER_ADDRESS", tx.origin);
        // Reputation and spend accounting are written by the backend only
        // after Meridian confirms settlement. Requiring the relayer here
        // prevents a superficially successful deployment that cannot record
        // either result.
        address policyRelayer = vm.envAddress("BOTCHAIN_POLICY_RELAYER_ADDRESS");

        vm.startBroadcast();
        deployed = deploy(owner, policyRelayer);
        vm.stopBroadcast();
    }

    function deploy(address owner, address policyRelayer)
        public
        returns (DeployedContracts memory deployed)
    {
        require(owner != address(0), "ZERO_OWNER");
        require(policyRelayer != address(0), "ZERO_RELAYER");

        NexoraPolicyRegistry policyImplementation = new NexoraPolicyRegistry();
        NexoraProxy policyProxy = new NexoraProxy(
            address(policyImplementation),
            abi.encodeWithSignature("initialize(address,address)", owner, policyRelayer)
        );

        OperatorReputation reputationImplementation = new OperatorReputation();
        NexoraProxy reputationProxy = new NexoraProxy(
            address(reputationImplementation),
            abi.encodeWithSignature("initialize(address,address)", owner, policyRelayer)
        );

        deployed = DeployedContracts({
            policyImplementation: address(policyImplementation),
            policyProxy: address(policyProxy),
            reputationImplementation: address(reputationImplementation),
            reputationProxy: address(reputationProxy),
            policyRelayer: policyRelayer
        });
    }
}
