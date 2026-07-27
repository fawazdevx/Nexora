// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraX402Settlement} from "../src/NexoraX402Settlement.sol";

/// @dev Mock USDC modelling the parts of EIP-3009 the contract relies on:
///      receiveWithAuthorization enforces msg.sender == to, moves funds, and
///      reverts if the nonce was already used (token-level replay guard).
contract MockUsdc3009 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256,
        uint256,
        bytes32 nonce,
        uint8,
        bytes32,
        bytes32
    ) external {
        require(msg.sender == to, "CALLER_MUST_BE_PAYEE");
        require(!authorizationState[from][nonce], "AUTH_USED");
        require(balanceOf[from] >= value, "BALANCE");
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert() external;
}

contract NexoraX402SettlementTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant OWNER = address(0xB0B);
    address internal constant PAYER = address(0xCAFE);
    address internal constant SELLER = address(0xD00D);
    address internal constant TREASURY = address(0xFEE);
    address internal constant RELAYER = address(0xBEEF);

    uint16 internal constant FEE_BPS = 250; // 2.5%
    bytes32 internal constant SALT = keccak256("salt-1");

    function _deploy() internal returns (NexoraX402Settlement s, MockUsdc3009 usdc) {
        usdc = new MockUsdc3009();
        NexoraX402Settlement impl = new NexoraX402Settlement();
        NexoraProxy proxy = new NexoraProxy(
            address(impl),
            abi.encodeCall(NexoraX402Settlement.initialize, (OWNER, address(usdc), TREASURY, FEE_BPS))
        );
        s = NexoraX402Settlement(address(proxy));
    }

    function _settle(
        NexoraX402Settlement s,
        uint256 value,
        uint16 maxFeeBps,
        address seller,
        bytes32 salt,
        address caller
    ) internal returns (uint256 fee) {
        bytes32 nonce = s.expectedNonce(seller, maxFeeBps, salt);
        vm.prank(caller);
        fee = s.settle(PAYER, value, 0, type(uint256).max, nonce, 27, bytes32(0), bytes32(0), seller, maxFeeBps, salt);
    }

    function testHappyPathSplitsFeeAndForwardsNet() external {
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        usdc.mint(PAYER, 100e6);

        uint256 fee = _settle(s, 100e6, FEE_BPS, SELLER, SALT, RELAYER);

        require(fee == 2_500_000, "FEE");
        require(usdc.balanceOf(SELLER) == 97_500_000, "SELLER_NET");
        require(usdc.balanceOf(TREASURY) == 2_500_000, "TREASURY_FEE");
        require(usdc.balanceOf(address(s)) == 0, "NO_DUST");
    }

    function testAnyoneCanSubmitTheSettlement() external {
        // Nexora funds nothing: the payer, seller, or an arbitrary relayer can
        // broadcast. Here the SELLER broadcasts and the split is unchanged.
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        usdc.mint(PAYER, 40e6);

        _settle(s, 40e6, FEE_BPS, SELLER, SALT, SELLER);

        require(usdc.balanceOf(SELLER) == 39e6, "SELLER_NET");
        require(usdc.balanceOf(TREASURY) == 1e6, "TREASURY_FEE");
    }

    function testRejectsRedirectedSeller() external {
        // A relayer that pulls the payer's signed nonce but substitutes its own
        // address as the seller must fail the nonce binding.
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        usdc.mint(PAYER, 100e6);

        bytes32 signedNonce = s.expectedNonce(SELLER, FEE_BPS, SALT);
        vm.prank(RELAYER);
        vm.expectRevert(NexoraX402Settlement.NonceMismatch.selector);
        s.settle(PAYER, 100e6, 0, type(uint256).max, signedNonce, 27, bytes32(0), bytes32(0), RELAYER, FEE_BPS, SALT);
    }

    function testRejectsFeeAbovePayerCeiling() external {
        // Owner raises fee after the payer signed with a lower ceiling.
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        usdc.mint(PAYER, 100e6);
        vm.prank(OWNER);
        s.setFeeBps(300);

        bytes32 nonce = s.expectedNonce(SELLER, 250, SALT);
        vm.prank(RELAYER);
        vm.expectRevert(NexoraX402Settlement.FeeExceedsMax.selector);
        s.settle(PAYER, 100e6, 0, type(uint256).max, nonce, 27, bytes32(0), bytes32(0), SELLER, 250, SALT);
    }

    function testDoubleSettleRevertsOnOurGuard() external {
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        usdc.mint(PAYER, 200e6);

        _settle(s, 100e6, FEE_BPS, SELLER, SALT, RELAYER);

        bytes32 nonce = s.expectedNonce(SELLER, FEE_BPS, SALT);
        vm.prank(RELAYER);
        vm.expectRevert(NexoraX402Settlement.AlreadySettled.selector);
        s.settle(PAYER, 100e6, 0, type(uint256).max, nonce, 27, bytes32(0), bytes32(0), SELLER, FEE_BPS, SALT);
    }

    function testZeroFeePathSendsFullAmount() external {
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        vm.prank(OWNER);
        s.setFeeBps(0);
        usdc.mint(PAYER, 10e6);

        _settle(s, 10e6, 0, SELLER, SALT, RELAYER);

        require(usdc.balanceOf(SELLER) == 10e6, "SELLER_FULL");
        require(usdc.balanceOf(TREASURY) == 0, "NO_FEE");
    }

    function testZeroSellerReverts() external {
        (NexoraX402Settlement s, MockUsdc3009 usdc) = _deploy();
        usdc.mint(PAYER, 10e6);
        bytes32 nonce = s.expectedNonce(address(0), FEE_BPS, SALT);
        vm.prank(RELAYER);
        vm.expectRevert(NexoraX402Settlement.ZeroSeller.selector);
        s.settle(PAYER, 10e6, 0, type(uint256).max, nonce, 27, bytes32(0), bytes32(0), address(0), FEE_BPS, SALT);
    }

    function testZeroValueReverts() external {
        (NexoraX402Settlement s,) = _deploy();
        bytes32 nonce = s.expectedNonce(SELLER, FEE_BPS, SALT);
        vm.prank(RELAYER);
        vm.expectRevert(NexoraX402Settlement.ZeroValue.selector);
        s.settle(PAYER, 0, 0, type(uint256).max, nonce, 27, bytes32(0), bytes32(0), SELLER, FEE_BPS, SALT);
    }

    function testSetFeeBpsOnlyOwner() external {
        (NexoraX402Settlement s,) = _deploy();
        vm.prank(RELAYER);
        vm.expectRevert(); // NotOwner
        s.setFeeBps(100);
    }

    function testSetTreasuryOnlyOwner() external {
        (NexoraX402Settlement s,) = _deploy();
        vm.prank(RELAYER);
        vm.expectRevert(); // NotOwner
        s.setTreasury(RELAYER);
    }

    function testFeeCapEnforcedOnSetter() external {
        (NexoraX402Settlement s,) = _deploy();
        vm.prank(OWNER);
        vm.expectRevert(); // FEE_TOO_HIGH require string
        s.setFeeBps(1_001);
    }

    function testOwnerCanMigrateUsdcWithExpectedCurrentGuard() external {
        (NexoraX402Settlement s, MockUsdc3009 current) = _deploy();
        MockUsdc3009 replacement = new MockUsdc3009();

        vm.prank(OWNER);
        s.migrateUsdc(address(current), address(replacement));
        require(address(s.usdc()) == address(replacement), "USDC_NOT_MIGRATED");

        vm.prank(OWNER);
        vm.expectRevert(NexoraX402Settlement.UnexpectedUsdc.selector);
        s.migrateUsdc(address(current), address(replacement));
    }
}
