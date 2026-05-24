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
}

contract NexoraEscrowTest {
    function testEscrowRoutesFeeToTreasuryAndReleasesBond() external {
        MockUsdc usdc = new MockUsdc();
        address treasury = address(0xBEEF);
        NexoraEscrow implementation = new NexoraEscrow();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(NexoraEscrow.initialize, (address(this), address(usdc), treasury))
        );
        NexoraEscrow escrow = NexoraEscrow(address(proxy));
        Actor creator = new Actor(usdc, escrow);
        Actor counterparty = new Actor(usdc, escrow);

        usdc.mint(address(creator), 110e6);
        creator.approveEscrow(110e6);
        uint256 escrowId = creator.create(address(counterparty), 100e6, 10e6, 200);

        creator.fund(escrowId);
        counterparty.submit(escrowId);
        escrow.verifyDeliverable(escrowId, "ok");
        escrow.releaseEscrow(escrowId);

        assert(usdc.balanceOf(treasury) == 2e6);
        assert(usdc.balanceOf(address(counterparty)) == 98e6);
        assert(usdc.balanceOf(address(creator)) == 10e6);
    }
}
