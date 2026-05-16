// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";

contract NexoraPolicyRegistryV2 is NexoraPolicyRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract UpgradeableSmokeTest {
    function testProxyInitializesPolicyRegistry() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(NexoraPolicyRegistry.initialize, (address(this)))
        );

        NexoraPolicyRegistry registry = NexoraPolicyRegistry(address(proxy));
        assert(registry.owner() == address(this));
    }

    function testImplementationCannotBeInitializedDirectly() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();

        try implementation.initialize(address(this)) {
            revert("DIRECT_INITIALIZE_SUCCEEDED");
        } catch {}
    }

    function testOwnerCanUpgradeProxyImplementation() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(NexoraPolicyRegistry.initialize, (address(this)))
        );
        NexoraPolicyRegistryV2 nextImplementation = new NexoraPolicyRegistryV2();

        NexoraPolicyRegistry(address(proxy)).upgradeTo(address(nextImplementation));

        uint256 version = NexoraPolicyRegistryV2(address(proxy)).version();
        assert(version == 2);
        assert(NexoraPolicyRegistry(address(proxy)).owner() == address(this));
    }
}
