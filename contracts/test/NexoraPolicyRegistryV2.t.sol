// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";

interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract NexoraPolicyRegistryV2Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant AGENT = address(0xA11CE);
    address internal constant OPERATOR = address(0xB0B);
    address internal constant FACILITATOR = address(0xFACADE);
    address internal constant TARGET = address(0x1234);
    address internal constant RECIPIENT = address(0x5678);
    bytes32 internal constant SERVICE_ID = keccak256("service:repo-analyzer");

    function testPolicyV2AllowsServiceAndTracksWeeklySpend() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);

        registry.setPolicyV2(AGENT, 15e6, 0, 4, 0, 0, true, false);
        registry.setAllowedService(AGENT, SERVICE_ID, true);

        assert(registry.canSpendV2(AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 2));

        vm.prank(FACILITATOR);
        registry.recordSpendV2(AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 2);

        assert(!registry.canSpendV2(AGENT, TARGET, RECIPIENT, 6e6, SERVICE_ID, 2));
    }

    function testPolicyV2BlocksUnknownServiceWhenRequired() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);

        registry.setPolicyV2(AGENT, 0, 0, 0, 0, 0, true, false);

        assert(!registry.canSpendV2(AGENT, TARGET, RECIPIENT, 1e6, SERVICE_ID, 1));
    }

    function testPolicyV2CooldownAndExpiry() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);

        vm.warp(1_000);
        registry.setPolicyV2(AGENT, 0, 0, 0, 60, 1_200, false, false);

        vm.prank(FACILITATOR);
        registry.recordSpendV2(AGENT, TARGET, RECIPIENT, 1e6, bytes32(0), 1);

        assert(!registry.canSpendV2(AGENT, TARGET, RECIPIENT, 1e6, bytes32(0), 1));

        vm.warp(1_061);
        assert(registry.canSpendV2(AGENT, TARGET, RECIPIENT, 1e6, bytes32(0), 1));

        vm.warp(1_201);
        assert(!registry.canSpendV2(AGENT, TARGET, RECIPIENT, 1e6, bytes32(0), 1));
    }

    function newRegistry() internal returns (NexoraPolicyRegistry) {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(NexoraPolicyRegistry.initialize, (address(this)))
        );
        NexoraPolicyRegistry registry = NexoraPolicyRegistry(address(proxy));
        registry.setFacilitator(FACILITATOR, true);
        return registry;
    }

    function configureBasePolicy(NexoraPolicyRegistry registry) internal {
        address[] memory contracts = new address[](1);
        contracts[0] = TARGET;
        address[] memory recipients = new address[](1);
        recipients[0] = RECIPIENT;
        registry.configureAgentPolicy(
            AGENT,
            OPERATOR,
            bytes32(0),
            100e6,
            20e6,
            true,
            true,
            true,
            contracts,
            recipients
        );
    }
}
