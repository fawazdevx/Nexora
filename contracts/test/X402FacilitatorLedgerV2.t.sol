// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {OperatorReputation} from "../src/OperatorReputation.sol";
import {X402FacilitatorLedger} from "../src/X402FacilitatorLedger.sol";

contract MockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

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

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

contract X402FacilitatorLedgerV2Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OPERATOR = address(0xB0B);
    address internal constant AGENT = address(0xCAFE);
    address internal constant PUBLISHER = address(0xD00D);
    address internal constant TREASURY = address(0xFEE);
    address internal constant FACILITATOR = address(0xFACADE);

    function testSettleAgentRequestHonorsServiceAllowlist() external {
        MockUsdc usdc = new MockUsdc();
        NexoraPolicyRegistry policy = deployPolicyRegistry();
        OperatorReputation reputation = deployReputation();
        X402FacilitatorLedger ledger = deployLedger(address(usdc), address(policy), address(reputation));

        policy.setFacilitator(address(ledger), true);
        reputation.setUpdater(address(ledger), true);
        policy.configureAgentPolicy(
            AGENT,
            OPERATOR,
            bytes32(0),
            100e6,
            20e6,
            true,
            true,
            true,
            _singleAddress(address(ledger)),
            _singleAddress(PUBLISHER)
        );
        policy.setPolicyV2(AGENT, 100e6, 0, 10, 0, 0, true, false);

        bytes32 allowedService = bytes32(uint256(1));
        policy.setAllowedService(AGENT, allowedService, true);
        vm.prank(PUBLISHER);
        ledger.publishService("service:allowed", 5e6);

        usdc.mint(AGENT, 50e6);
        vm.prank(AGENT);
        usdc.approve(address(ledger), 50e6);

        vm.prank(AGENT);
        ledger.settleAgentRequest(1, bytes32(uint256(1)), 2);
    }

    function testBatchPublishCreatesSequentialServicesForOnePublisher() external {
        MockUsdc usdc = new MockUsdc();
        NexoraPolicyRegistry policy = deployPolicyRegistry();
        OperatorReputation reputation = deployReputation();
        X402FacilitatorLedger ledger = deployLedger(address(usdc), address(policy), address(reputation));

        string[] memory endpoints = new string[](2);
        endpoints[0] = "service:one";
        endpoints[1] = "service:two";
        uint256[] memory prices = new uint256[](2);
        prices[0] = 1e6;
        prices[1] = 2e6;

        vm.prank(PUBLISHER);
        uint256[] memory ids = ledger.publishServices(endpoints, prices);
        require(ids.length == 2 && ids[0] == 1 && ids[1] == 2, "IDS");
        (address publisherOne,, uint256 priceOne, bool activeOne) = ledger.services(1);
        (address publisherTwo,, uint256 priceTwo, bool activeTwo) = ledger.services(2);
        require(publisherOne == PUBLISHER && publisherTwo == PUBLISHER, "PUBLISHER");
        require(priceOne == 1e6 && priceTwo == 2e6 && activeOne && activeTwo, "SERVICE_DATA");
    }

    function testOwnerCanMigrateUsdcWithExpectedCurrentGuard() external {
        MockUsdc current = new MockUsdc();
        MockUsdc replacement = new MockUsdc();
        NexoraPolicyRegistry policy = deployPolicyRegistry();
        OperatorReputation reputation = deployReputation();
        X402FacilitatorLedger ledger = deployLedger(address(current), address(policy), address(reputation));

        ledger.migrateUsdc(address(current), address(replacement));
        require(address(ledger.usdc()) == address(replacement), "USDC_NOT_MIGRATED");

        vm.expectRevert(X402FacilitatorLedger.UnexpectedUsdc.selector);
        ledger.migrateUsdc(address(current), address(replacement));
    }

    function deployPolicyRegistry() internal returns (NexoraPolicyRegistry) {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(address(implementation), abi.encodeCall(NexoraPolicyRegistry.initialize, (address(this))));
        return NexoraPolicyRegistry(address(proxy));
    }

    function deployReputation() internal returns (OperatorReputation) {
        OperatorReputation implementation = new OperatorReputation();
        NexoraProxy proxy = new NexoraProxy(address(implementation), abi.encodeCall(OperatorReputation.initialize, (address(this))));
        return OperatorReputation(address(proxy));
    }

    function deployLedger(address usdc, address policy, address reputation) internal returns (X402FacilitatorLedger) {
        X402FacilitatorLedger implementation = new X402FacilitatorLedger();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(X402FacilitatorLedger.initialize, (address(this), usdc, policy, reputation, TREASURY, uint16(200)))
        );
        return X402FacilitatorLedger(address(proxy));
    }

    function _singleAddress(address item) internal pure returns (address[] memory items) {
        items = new address[](1);
        items[0] = item;
    }
}
