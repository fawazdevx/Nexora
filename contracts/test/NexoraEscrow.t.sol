// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraEscrow} from "../src/NexoraEscrow.sol";
import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";

contract MockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Actor {
    MockUsdc public usdc;
    NexoraEscrow public escrow;

    constructor(MockUsdc usdc_, NexoraEscrow escrow_) {
        usdc = usdc_;
        escrow = escrow_;
    }

    function approveEscrow(uint256 amount) external {
        usdc.approve(address(escrow), amount);
    }

    function create(address counterparty, uint256 amount, uint256 bond, uint16 feeBps) external returns (uint256) {
        return escrow.createEscrow(counterparty, amount, bond, feeBps, "Build API", "Ship an API manifest");
    }

    function fund(uint256 escrowId) external {
        escrow.fundEscrow(escrowId);
    }

    function submit(uint256 escrowId) external {
        escrow.submitDeliverable(escrowId, "https://example.com/deliverable");
    }

    function verify(uint256 escrowId) external {
        escrow.verifyDeliverable(escrowId, "ok");
    }

    function release(uint256 escrowId) external {
        escrow.releaseEscrow(escrowId);
    }

    function cancel(uint256 escrowId) external {
        escrow.cancelEscrow(escrowId);
    }
}

contract NexoraEscrowTest {
    function deployEscrow(MockUsdc usdc, address treasury) internal returns (NexoraEscrow escrow) {
        NexoraEscrow implementation = new NexoraEscrow();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(NexoraEscrow.initialize, (address(this), address(usdc), treasury))
        );
        escrow = NexoraEscrow(address(proxy));
    }

    function testEscrowRoutesFeeToTreasuryAndReleasesBond() external {
        MockUsdc usdc = new MockUsdc();
        address treasury = address(0xBEEF);
        NexoraEscrow escrow = deployEscrow(usdc, treasury);
        Actor creator = new Actor(usdc, escrow);
        Actor counterparty = new Actor(usdc, escrow);

        usdc.mint(address(creator), 110e6);
        creator.approveEscrow(110e6);
        uint256 escrowId = creator.create(address(counterparty), 100e6, 10e6, 200);

        creator.fund(escrowId);
        counterparty.submit(escrowId);
        creator.verify(escrowId);
        creator.release(escrowId);

        assert(usdc.balanceOf(treasury) == 2e6);
        assert(usdc.balanceOf(address(counterparty)) == 98e6);
        assert(usdc.balanceOf(address(creator)) == 10e6);
    }

    function testCreateEscrowRejectsExcessiveFee() external {
        MockUsdc usdc = new MockUsdc();
        NexoraEscrow escrow = deployEscrow(usdc, address(0xBEEF));
        Actor creator = new Actor(usdc, escrow);

        try creator.create(address(0xCAFE), 100e6, 10e6, 1_001) {
            revert("EXCESSIVE_FEE_ACCEPTED");
        } catch {}
    }

    function testCreateEscrowRejectsZeroCounterparty() external {
        MockUsdc usdc = new MockUsdc();
        NexoraEscrow escrow = deployEscrow(usdc, address(0xBEEF));
        Actor creator = new Actor(usdc, escrow);

        try creator.create(address(0), 100e6, 10e6, 100) {
            revert("ZERO_COUNTERPARTY_ACCEPTED");
        } catch {}
    }

    function testOnlyCreatorCanReleaseEscrow() external {
        MockUsdc usdc = new MockUsdc();
        NexoraEscrow escrow = deployEscrow(usdc, address(0xBEEF));
        Actor creator = new Actor(usdc, escrow);
        Actor counterparty = new Actor(usdc, escrow);
        Actor stranger = new Actor(usdc, escrow);

        usdc.mint(address(creator), 110e6);
        creator.approveEscrow(110e6);
        uint256 escrowId = creator.create(address(counterparty), 100e6, 10e6, 200);
        creator.fund(escrowId);
        counterparty.submit(escrowId);
        creator.verify(escrowId);

        try stranger.release(escrowId) {
            revert("STRANGER_RELEASED_ESCROW");
        } catch {}
    }

    function testCancelFundedEscrowRefundsCreator() external {
        MockUsdc usdc = new MockUsdc();
        NexoraEscrow escrow = deployEscrow(usdc, address(0xBEEF));
        Actor creator = new Actor(usdc, escrow);
        Actor counterparty = new Actor(usdc, escrow);

        usdc.mint(address(creator), 110e6);
        creator.approveEscrow(110e6);
        uint256 escrowId = creator.create(address(counterparty), 100e6, 10e6, 200);
        creator.fund(escrowId);
        assert(usdc.balanceOf(address(creator)) == 0);

        escrow.cancelEscrow(escrowId);

        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            NexoraEscrow.Status status,
            ,
            ,
            ,

        ) = escrow.escrows(escrowId);
        assert(usdc.balanceOf(address(creator)) == 110e6);
        assert(uint256(status) == uint256(NexoraEscrow.Status.Cancelled));
    }
}
