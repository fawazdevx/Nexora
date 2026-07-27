// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata key) external view returns (address value);
    function envUint(string calldata key) external view returns (uint256 value);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256 value);
}

interface ICanonicalMarketplaceLedger {
    function nextServiceId() external view returns (uint256);

    function publishServices(string[] calldata endpointHashes, uint256[] calldata pricesPerUnit)
        external
        returns (uint256[] memory serviceIds);
}

/// @notice Publishes Nexora's six canonical Marketplace services on one ledger.
/// @dev Run once on Base Sepolia and once on Arbitrum Sepolia. The expected
///      chain and next service id checks prevent accidental publication on the
///      wrong ledger or duplicate publication after a prior successful run.
contract PublishCanonicalMarketplaceRoutes {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error UnexpectedChain(uint256 expected, uint256 actual);
    error InvalidLedger(address ledger);
    error UnexpectedNextServiceId(uint256 expected, uint256 actual);

    function run() external returns (uint256[] memory serviceIds) {
        uint256 expectedChainId = vm.envUint("EXPECTED_CHAIN_ID");
        if (block.chainid != expectedChainId) revert UnexpectedChain(expectedChainId, block.chainid);

        address ledger = vm.envAddress("MARKETPLACE_LEDGER_ADDRESS");
        uint256 expectedNextServiceId = vm.envOr("EXPECTED_NEXT_SERVICE_ID", uint256(1));

        vm.startBroadcast();
        serviceIds = publish(ledger, expectedNextServiceId);
        vm.stopBroadcast();
    }

    function publish(address ledger, uint256 expectedNextServiceId)
        public
        returns (uint256[] memory serviceIds)
    {
        if (ledger.code.length == 0) revert InvalidLedger(ledger);

        uint256 actualNextServiceId = ICanonicalMarketplaceLedger(ledger).nextServiceId();
        if (actualNextServiceId != expectedNextServiceId) {
            revert UnexpectedNextServiceId(expectedNextServiceId, actualNextServiceId);
        }

        (string[] memory endpointHashes, uint256[] memory pricesPerUnit) = canonicalCatalog();
        serviceIds = ICanonicalMarketplaceLedger(ledger).publishServices(endpointHashes, pricesPerUnit);
    }

    function canonicalCatalog()
        public
        pure
        returns (string[] memory endpointHashes, uint256[] memory pricesPerUnit)
    {
        endpointHashes = new string[](6);
        pricesPerUnit = new uint256[](6);

        endpointHashes[0] = "website-analyzer-v1";
        pricesPerUnit[0] = 25_000;

        endpointHashes[1] = "github-repo-analyzer-v1";
        pricesPerUnit[1] = 50_000;

        endpointHashes[2] = "x-account-analyzer-v1";
        pricesPerUnit[2] = 35_000;

        endpointHashes[3] = "contract-safety-check-v1";
        pricesPerUnit[3] = 15_000;

        endpointHashes[4] = "landing-page-copy-reviewer-v1";
        pricesPerUnit[4] = 20_000;

        endpointHashes[5] = "grant-application-reviewer-v1";
        pricesPerUnit[5] = 30_000;
    }
}
