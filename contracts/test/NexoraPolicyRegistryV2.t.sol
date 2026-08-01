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

    function testUnrelatedOperatorCannotClaimInactiveAgentWallet() external {
        NexoraPolicyRegistry registry = newRegistry();
        vm.prank(OPERATOR);
        try registry.configureAgentPolicy(
            AGENT,
            OPERATOR,
            bytes32(0),
            100e6,
            20e6,
            false,
            false,
            true,
            new address[](0),
            new address[](0)
        ) {
            revert("AGENT_WALLET_CLAIM_SUCCEEDED");
        } catch {}

        assert(!registry.isAgentActive(AGENT));
    }

    function testAgentWalletCanAuthorizeItsOwnOperator() external {
        NexoraPolicyRegistry registry = newRegistry();
        vm.prank(AGENT);
        registry.configureAgentPolicy(
            AGENT,
            OPERATOR,
            bytes32(0),
            100e6,
            20e6,
            false,
            false,
            true,
            new address[](0),
            new address[](0)
        );

        (address operator,, bool active) = registry.agentProfiles(AGENT);
        assert(operator == OPERATOR);
        assert(active);
    }

    function testReservationPreventsConcurrentLimitOverspendAndFinalizesOnce() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);
        registry.setPolicy(AGENT, 20e6, 20e6, true, true, true);
        bytes32 first = keccak256("settlement:first");
        bytes32 second = keccak256("settlement:second");
        vm.warp(10_000);

        vm.prank(FACILITATOR);
        registry.reserveSpendV2(first, AGENT, TARGET, RECIPIENT, 15e6, SERVICE_ID, 1, 10_300);
        assert(!registry.canSpendV2(AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1));

        vm.prank(FACILITATOR);
        try registry.reserveSpendV2(second, AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1, 10_300) {
            revert("CONCURRENT_RESERVATION_SUCCEEDED");
        } catch {}

        vm.prank(FACILITATOR);
        registry.finalizeSpendV2(first);
        vm.prank(FACILITATOR);
        registry.finalizeSpendV2(first);

        uint256 day = block.timestamp / 1 days;
        assert(registry.dailySpend(AGENT, day) == 15e6);
        assert(registry.reservedDailySpend(AGENT, day) == 0);
    }

    function testExpiredReservationCanBeReleased() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);
        bytes32 settlementId = keccak256("settlement:expired");
        vm.warp(20_000);

        vm.prank(FACILITATOR);
        registry.reserveSpendV2(settlementId, AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1, 20_100);
        vm.warp(20_101);
        registry.releaseExpiredSpendReservation(settlementId);

        assert(registry.canSpendV2(AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1));
    }

    function testPendingReservationCanBeFinalizedAfterExpiry() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);
        bytes32 settlementId = keccak256("settlement:late-finalization");
        uint256 reservedAt = 30_000;
        vm.warp(reservedAt);

        vm.prank(FACILITATOR);
        registry.reserveSpendV2(settlementId, AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1, 30_100);
        vm.warp(30_101);
        vm.prank(FACILITATOR);
        registry.finalizeSpendV2(settlementId);

        uint256 day = reservedAt / 1 days;
        assert(registry.dailySpend(AGENT, day) == 10e6);
        assert(registry.reservedDailySpend(AGENT, day) == 0);
        (, , , , , , , , , , uint8 status) = registry.spendReservations(settlementId);
        assert(status == 2);
    }

    function testReleasedExpiredReservationCanStillRecordConfirmedSettlement() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);
        bytes32 settlementId = keccak256("settlement:released-before-reconciliation");
        uint256 reservedAt = 40_000;
        vm.warp(reservedAt);

        vm.prank(FACILITATOR);
        registry.reserveSpendV2(settlementId, AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1, 40_100);
        vm.warp(40_101);
        registry.releaseExpiredSpendReservation(settlementId);
        vm.prank(FACILITATOR);
        registry.finalizeSpendV2(settlementId);

        uint256 day = reservedAt / 1 days;
        assert(registry.dailySpend(AGENT, day) == 10e6);
        assert(registry.reservedDailySpend(AGENT, day) == 0);
        (, , , , , , , , , , uint8 status) = registry.spendReservations(settlementId);
        assert(status == 2);
    }

    function testReleasedExpiredReservationIsAlreadyCancelledForFailedSettlement() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);
        bytes32 settlementId = keccak256("settlement:expired-failure");
        vm.warp(45_000);

        vm.prank(FACILITATOR);
        registry.reserveSpendV2(settlementId, AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1, 45_100);
        vm.warp(45_101);
        registry.releaseExpiredSpendReservation(settlementId);
        vm.prank(FACILITATOR);
        registry.cancelSpendReservation(settlementId);

        (, , , , , , , , , , uint8 status) = registry.spendReservations(settlementId);
        assert(status == 4);
    }

    function testCancelledReservationCannotBeFinalized() external {
        NexoraPolicyRegistry registry = newRegistry();
        configureBasePolicy(registry);
        bytes32 settlementId = keccak256("settlement:cancelled");
        uint256 reservedAt = 50_000;
        vm.warp(reservedAt);

        vm.prank(FACILITATOR);
        registry.reserveSpendV2(settlementId, AGENT, TARGET, RECIPIENT, 10e6, SERVICE_ID, 1, 50_100);
        vm.prank(FACILITATOR);
        registry.cancelSpendReservation(settlementId);
        vm.prank(FACILITATOR);
        try registry.finalizeSpendV2(settlementId) {
            revert("CANCELLED_RESERVATION_FINALIZED");
        } catch {}

        uint256 day = reservedAt / 1 days;
        assert(registry.dailySpend(AGENT, day) == 0);
        assert(registry.reservedDailySpend(AGENT, day) == 0);
    }

    function newRegistry() internal returns (NexoraPolicyRegistry) {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeWithSignature("initialize(address)", address(this))
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
