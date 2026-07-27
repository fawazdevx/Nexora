// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC3009} from "./interfaces/IERC20.sol";
import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";

/// @title NexoraX402Settlement
/// @notice Nexora-owned x402 settlement contract for EIP-3009 (USDC) payments.
///         The payer signs a `receiveWithAuthorization` naming THIS contract as
///         the recipient; the contract pulls the funds, keeps `feeBps` for the
///         Nexora treasury, and forwards the remainder to the seller in one
///         transaction. Because USDC's `receiveWithAuthorization` requires
///         `msg.sender == to`, only this contract can pull the authorized funds,
///         and anyone (payer, seller, or a relayer) may broadcast the settle
///         call — Nexora never needs to fund a hot wallet to earn the fee.
/// @dev Deployed once per chain (Arc, Base, Arbitrum) behind a NexoraProxy,
///      mirroring X402FacilitatorLedger's fee-split model for the raw x402 path.
contract NexoraX402Settlement is NexoraUpgradeable {
    IERC3009 public usdc;
    address public treasury;
    uint16 public feeBps;

    /// @dev Our own replay guard, in addition to USDC's authorizationState.
    ///      Keyed by the signed nonce (which is itself bound to the settlement
    ///      terms — see `_expectedNonce`).
    mapping(bytes32 => bool) public settled;

    event TreasuryUpdated(address indexed treasury);
    event FeeUpdated(uint16 feeBps);
    event UsdcMigrated(address indexed previousUsdc, address indexed newUsdc);
    event SettlementCompleted(
        bytes32 indexed nonce,
        address indexed payer,
        address indexed seller,
        uint256 grossAmount,
        uint256 platformFee
    );

    error ZeroSeller();
    error ZeroValue();
    error AlreadySettled();
    error NonceMismatch();
    error FeeExceedsMax();
    error TransferFailed();
    error InvalidUsdc();
    error UnexpectedUsdc();

    function initialize(address initialOwner, address usdc_, address treasury_, uint16 feeBps_) external {
        __Nexora_init(initialOwner);
        _validateUsdc(usdc_);
        require(treasury_ != address(0), "ZERO_TREASURY");
        require(feeBps_ <= 1_000, "FEE_TOO_HIGH");

        usdc = IERC3009(usdc_);
        treasury = treasury_;
        feeBps = feeBps_;
        emit TreasuryUpdated(treasury_);
        emit FeeUpdated(feeBps_);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "ZERO_TREASURY");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setFeeBps(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1_000, "FEE_TOO_HIGH");
        feeBps = newFeeBps;
        emit FeeUpdated(newFeeBps);
    }

    /// @notice Replace a misconfigured USDC token while proving the caller is
    ///         operating on the expected proxy/chain.
    /// @dev Use through upgradeToAndCall for an atomic implementation + token
    ///      migration during a proxy upgrade.
    function migrateUsdc(address expectedCurrentUsdc, address newUsdc) external onlyOwner {
        if (address(usdc) != expectedCurrentUsdc) revert UnexpectedUsdc();
        _validateUsdc(newUsdc);
        address previousUsdc = address(usdc);
        usdc = IERC3009(newUsdc);
        emit UsdcMigrated(previousUsdc, newUsdc);
    }

    /// @notice The nonce the payer must sign, binding the settlement terms so a
    ///         relayer cannot redirect funds or exceed the agreed fee ceiling.
    /// @dev The EIP-3009 struct the payer signs does not include the seller or a
    ///      fee cap, so we fold them (plus a caller-chosen salt for uniqueness)
    ///      into the otherwise-random nonce. The contract recomputes this from
    ///      calldata and rejects any mismatch.
    function expectedNonce(address seller, uint16 maxFeeBps, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(seller, maxFeeBps, salt));
    }

    /// @notice Pull an EIP-3009-authorized USDC payment, split off the platform
    ///         fee, and forward the remainder to `seller`.
    /// @param from        payer (authorization signer)
    /// @param value       gross USDC amount authorized
    /// @param validAfter  EIP-3009 lower time bound
    /// @param validBefore EIP-3009 upper time bound
    /// @param nonce       signed nonce; MUST equal expectedNonce(seller, maxFeeBps, salt)
    /// @param v,r,s       payer's EIP-3009 signature over the USDC domain
    /// @param seller      recipient of the net amount
    /// @param maxFeeBps   maximum fee (bps) the payer will tolerate
    /// @param salt        payer-chosen entropy making the bound nonce unique
    function settle(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address seller,
        uint16 maxFeeBps,
        bytes32 salt
    ) external nonReentrant returns (uint256 platformFee) {
        if (seller == address(0)) revert ZeroSeller();
        if (value == 0) revert ZeroValue();
        if (settled[nonce]) revert AlreadySettled();
        if (nonce != expectedNonce(seller, maxFeeBps, salt)) revert NonceMismatch();
        if (feeBps > maxFeeBps) revert FeeExceedsMax();

        settled[nonce] = true;

        // Pull the full amount into this contract. USDC enforces msg.sender ==
        // to (this contract) and reverts if the nonce was already used, giving a
        // second, token-level replay guard.
        usdc.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);

        platformFee = (value * feeBps) / 10_000;
        uint256 sellerAmount = value - platformFee;

        if (!usdc.transfer(seller, sellerAmount)) revert TransferFailed();
        if (platformFee > 0 && !usdc.transfer(treasury, platformFee)) revert TransferFailed();

        emit SettlementCompleted(nonce, from, seller, value, platformFee);
    }

    function _validateUsdc(address candidate) internal view {
        if (candidate == address(0) || candidate.code.length == 0) revert InvalidUsdc();
        (bool ok, bytes memory result) = candidate.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || result.length < 32 || abi.decode(result, (uint256)) != 6) revert InvalidUsdc();
        (bool authorizationOk, bytes memory authorizationResult) = candidate.staticcall(
            abi.encodeCall(IERC3009.authorizationState, (address(this), bytes32(0)))
        );
        if (!authorizationOk || authorizationResult.length < 32) revert InvalidUsdc();
    }
}
