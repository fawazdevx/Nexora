// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {X402FacilitatorLedger} from "../src/X402FacilitatorLedger.sol";
import {NexoraX402Settlement} from "../src/NexoraX402Settlement.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address value);
    function envUint(string calldata key) external view returns (uint256 value);
}

interface INexoraUpgradeableProxy {
    function owner() external view returns (address);
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
}

abstract contract X402UsdcUpgradeScript {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error UnexpectedChain(uint256 expected, uint256 actual);
    error InvalidProxy(address proxy);
    error UnexpectedOwner(address expected, address actual);

    function _preflight(address proxy) internal view {
        uint256 expectedChainId = vm.envUint("EXPECTED_CHAIN_ID");
        if (block.chainid != expectedChainId) revert UnexpectedChain(expectedChainId, block.chainid);
        if (proxy.code.length == 0) revert InvalidProxy(proxy);

        address expectedOwner = vm.envAddress("OWNER_ADDRESS");
        address actualOwner = INexoraUpgradeableProxy(proxy).owner();
        if (actualOwner != expectedOwner) revert UnexpectedOwner(expectedOwner, actualOwner);
    }
}

/// @notice Deploys a new ledger implementation and atomically corrects its USDC
///         storage value on the existing proxy. Run separately on Base and
///         Arbitrum with chain-specific environment values.
contract UpgradeX402LedgerUsdc is X402UsdcUpgradeScript {
    function run() external returns (address implementation) {
        address proxy = vm.envAddress("X402_LEDGER_PROXY_ADDRESS");
        address expectedCurrentUsdc = vm.envAddress("EXPECTED_CURRENT_USDC_ADDRESS");
        address newUsdc = vm.envAddress("USDC_ADDRESS");
        _preflight(proxy);

        vm.startBroadcast();
        X402FacilitatorLedger nextImplementation = new X402FacilitatorLedger();
        INexoraUpgradeableProxy(proxy).upgradeToAndCall(
            address(nextImplementation),
            abi.encodeCall(X402FacilitatorLedger.migrateUsdc, (expectedCurrentUsdc, newUsdc))
        );
        vm.stopBroadcast();
        implementation = address(nextImplementation);
    }
}

/// @notice Deploys a new raw-x402 settlement implementation and atomically
///         corrects its USDC storage value on the existing proxy.
contract UpgradeX402SettlementUsdc is X402UsdcUpgradeScript {
    function run() external returns (address implementation) {
        address proxy = vm.envAddress("X402_SETTLEMENT_PROXY_ADDRESS");
        address expectedCurrentUsdc = vm.envAddress("EXPECTED_CURRENT_USDC_ADDRESS");
        address newUsdc = vm.envAddress("USDC_ADDRESS");
        _preflight(proxy);

        vm.startBroadcast();
        NexoraX402Settlement nextImplementation = new NexoraX402Settlement();
        INexoraUpgradeableProxy(proxy).upgradeToAndCall(
            address(nextImplementation),
            abi.encodeCall(NexoraX402Settlement.migrateUsdc, (expectedCurrentUsdc, newUsdc))
        );
        vm.stopBroadcast();
        implementation = address(nextImplementation);
    }
}
