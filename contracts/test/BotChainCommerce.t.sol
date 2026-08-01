// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployNexoraBotCommerce} from "../script/DeployNexoraBotCommerce.s.sol";
import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {OperatorReputation} from "../src/OperatorReputation.sol";

interface BotVm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract BotChainCommerceTest {
    BotVm internal constant vm = BotVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant BOT_USER = address(0xB07);
    address internal constant MERIDIAN_FACILITATOR = address(0x402);
    address internal constant SELLER = address(0xA11CE);
    address internal constant POLICY_RELAYER = address(0xFEE);
    address internal constant SAFE_OWNER = address(0x5AFE);

    function testDeploysPolicyAndReputationWithoutBotLedger() external {
        DeployNexoraBotCommerce script = new DeployNexoraBotCommerce();
        DeployNexoraBotCommerce.DeployedContracts memory deployed = script.deploy(
            address(script), POLICY_RELAYER
        );

        NexoraPolicyRegistry policy = NexoraPolicyRegistry(deployed.policyProxy);
        OperatorReputation reputation = OperatorReputation(deployed.reputationProxy);

        require(deployed.policyRelayer == POLICY_RELAYER, "RELAYER");
        require(policy.facilitators(POLICY_RELAYER), "FACILITATOR");
        require(reputation.updaters(POLICY_RELAYER), "UPDATER");
    }

    function testRefusesDeploymentWithoutPolicyRelayer() external {
        DeployNexoraBotCommerce script = new DeployNexoraBotCommerce();
        vm.expectRevert(bytes("ZERO_RELAYER"));
        script.deploy(address(script), address(0));
    }

    function testDeploysWithDistinctMultisigOwnerAndConfiguredRelayer() external {
        DeployNexoraBotCommerce script = new DeployNexoraBotCommerce();
        DeployNexoraBotCommerce.DeployedContracts memory deployed = script.deploy(
            SAFE_OWNER, POLICY_RELAYER
        );

        NexoraPolicyRegistry policy = NexoraPolicyRegistry(deployed.policyProxy);
        OperatorReputation reputation = OperatorReputation(deployed.reputationProxy);
        require(policy.owner() == SAFE_OWNER, "POLICY_OWNER");
        require(reputation.owner() == SAFE_OWNER, "REPUTATION_OWNER");
        require(policy.facilitators(POLICY_RELAYER), "FACILITATOR");
        require(reputation.updaters(POLICY_RELAYER), "UPDATER");
    }

    function testConnectedEoaPolicyGuardsMeridianSettlementAccounting() external {
        DeployNexoraBotCommerce script = new DeployNexoraBotCommerce();
        DeployNexoraBotCommerce.DeployedContracts memory deployed = script.deploy(
            address(script), POLICY_RELAYER
        );
        NexoraPolicyRegistry policy = NexoraPolicyRegistry(deployed.policyProxy);
        OperatorReputation reputation = OperatorReputation(deployed.reputationProxy);

        address[] memory contracts = new address[](1);
        contracts[0] = MERIDIAN_FACILITATOR;
        address[] memory recipients = new address[](1);
        recipients[0] = SELLER;
        vm.prank(BOT_USER);
        policy.configureAgentPolicy(
            BOT_USER,
            BOT_USER,
            bytes32(0),
            5e6,
            5e6,
            true,
            true,
            true,
            contracts,
            recipients
        );

        bytes32 serviceId = keccak256("https://api.example.com/paid-report");
        require(policy.canSpendV2(BOT_USER, MERIDIAN_FACILITATOR, SELLER, 4e6, serviceId, 1), "CAN_SPEND");

        vm.prank(POLICY_RELAYER);
        policy.recordSpendV2(BOT_USER, MERIDIAN_FACILITATOR, SELLER, 4e6, serviceId, 1);
        vm.prank(POLICY_RELAYER);
        reputation.record(BOT_USER, 0, 1);

        require(!policy.canSpendV2(BOT_USER, MERIDIAN_FACILITATOR, SELLER, 2e6, serviceId, 1), "CAP_ENFORCED");
        (uint256 successfulPayments, , , , ) = reputation.scorecards(BOT_USER);
        require(successfulPayments == 1, "REPUTATION");
    }

    function testBotSettlementReservationAndReputationAreIdempotent() external {
        DeployNexoraBotCommerce script = new DeployNexoraBotCommerce();
        DeployNexoraBotCommerce.DeployedContracts memory deployed = script.deploy(
            address(script), POLICY_RELAYER
        );
        NexoraPolicyRegistry policy = NexoraPolicyRegistry(deployed.policyProxy);
        OperatorReputation reputation = OperatorReputation(deployed.reputationProxy);

        address[] memory contracts = new address[](1);
        contracts[0] = MERIDIAN_FACILITATOR;
        address[] memory recipients = new address[](1);
        recipients[0] = SELLER;
        vm.prank(BOT_USER);
        policy.configureAgentPolicy(
            BOT_USER,
            BOT_USER,
            bytes32(0),
            5e6,
            5e6,
            true,
            true,
            true,
            contracts,
            recipients
        );

        bytes32 settlementId = keccak256("meridian:bot-chain:payment-1");
        bytes32 serviceId = keccak256("https://api.example.com/paid-report");
        vm.prank(POLICY_RELAYER);
        policy.reserveSpendV2(
            settlementId,
            BOT_USER,
            MERIDIAN_FACILITATOR,
            SELLER,
            4e6,
            serviceId,
            1,
            uint64(block.timestamp + 300)
        );
        vm.prank(POLICY_RELAYER);
        policy.finalizeSpendV2(settlementId);

        bytes32 reputationEventId = keccak256(abi.encodePacked(settlementId, uint8(0), BOT_USER));
        vm.prank(POLICY_RELAYER);
        reputation.recordWithId(reputationEventId, BOT_USER, 0, 1);
        vm.prank(POLICY_RELAYER);
        reputation.recordWithId(reputationEventId, BOT_USER, 0, 1);

        (uint256 successfulPayments, , , , ) = reputation.scorecards(BOT_USER);
        require(successfulPayments == 1, "REPUTATION_REPLAYED");
    }
}
