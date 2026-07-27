// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PublishCanonicalMarketplaceRoutes} from "../script/PublishCanonicalMarketplaceRoutes.s.sol";

interface PublicationVm {
    function expectRevert(bytes calldata revertData) external;
}

contract MockCanonicalMarketplaceLedger {
    uint256 public nextServiceId = 1;
    string[] internal publishedEndpoints;
    uint256[] internal publishedPrices;

    function publishServices(string[] calldata endpointHashes, uint256[] calldata pricesPerUnit)
        external
        returns (uint256[] memory serviceIds)
    {
        require(endpointHashes.length == pricesPerUnit.length, "LENGTH");
        serviceIds = new uint256[](endpointHashes.length);
        for (uint256 i = 0; i < endpointHashes.length; i++) {
            serviceIds[i] = nextServiceId++;
            publishedEndpoints.push(endpointHashes[i]);
            publishedPrices.push(pricesPerUnit[i]);
        }
    }

    function endpoint(uint256 index) external view returns (string memory) {
        return publishedEndpoints[index];
    }

    function price(uint256 index) external view returns (uint256) {
        return publishedPrices[index];
    }
}

contract CanonicalMarketplacePublicationTest {
    PublicationVm internal constant vm =
        PublicationVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testPublishesTheSixCanonicalRoutesInStableOrder() external {
        PublishCanonicalMarketplaceRoutes script = new PublishCanonicalMarketplaceRoutes();
        MockCanonicalMarketplaceLedger ledger = new MockCanonicalMarketplaceLedger();

        uint256[] memory serviceIds = script.publish(address(ledger), 1);

        require(serviceIds.length == 6, "SERVICE_COUNT");
        for (uint256 i = 0; i < serviceIds.length; i++) {
            require(serviceIds[i] == i + 1, "SERVICE_ID");
        }
        require(keccak256(bytes(ledger.endpoint(0))) == keccak256("website-analyzer-v1"), "WEBSITE");
        require(keccak256(bytes(ledger.endpoint(1))) == keccak256("github-repo-analyzer-v1"), "GITHUB");
        require(keccak256(bytes(ledger.endpoint(2))) == keccak256("x-account-analyzer-v1"), "X_ACCOUNT");
        require(keccak256(bytes(ledger.endpoint(3))) == keccak256("contract-safety-check-v1"), "CONTRACT");
        require(keccak256(bytes(ledger.endpoint(4))) == keccak256("landing-page-copy-reviewer-v1"), "COPY");
        require(keccak256(bytes(ledger.endpoint(5))) == keccak256("grant-application-reviewer-v1"), "GRANT");
        require(ledger.price(0) == 25_000, "WEBSITE_PRICE");
        require(ledger.price(1) == 50_000, "GITHUB_PRICE");
        require(ledger.price(2) == 35_000, "X_PRICE");
        require(ledger.price(3) == 15_000, "CONTRACT_PRICE");
        require(ledger.price(4) == 20_000, "COPY_PRICE");
        require(ledger.price(5) == 30_000, "GRANT_PRICE");
        require(ledger.nextServiceId() == 7, "NEXT_SERVICE_ID");
    }

    function testRefusesToDuplicateAnExistingPublication() external {
        PublishCanonicalMarketplaceRoutes script = new PublishCanonicalMarketplaceRoutes();
        MockCanonicalMarketplaceLedger ledger = new MockCanonicalMarketplaceLedger();
        script.publish(address(ledger), 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                PublishCanonicalMarketplaceRoutes.UnexpectedNextServiceId.selector,
                uint256(1),
                uint256(7)
            )
        );
        script.publish(address(ledger), 1);
    }
}
