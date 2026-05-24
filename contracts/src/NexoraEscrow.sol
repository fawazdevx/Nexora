// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";

contract NexoraEscrow is NexoraUpgradeable {
    enum Status {
        Draft,
        Funded,
        Submitted,
        Verified,
        Released,
        Disputed,
        Cancelled
    }

    struct Escrow {
        address creator;
        address counterparty;
        uint256 amount;
        uint256 performanceBond;
        uint16 platformFeeBps;
        uint256 platformFee;
        uint256 counterpartyNet;
        Status status;
        string title;
        string description;
        string deliverableUrl;
        string verifierNotes;
    }

    IERC20 public usdc;
    address public treasury;
    uint256 public nextEscrowId = 1;

    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(uint256 indexed escrowId, address indexed creator, address indexed counterparty, uint256 amount);
    event EscrowFunded(uint256 indexed escrowId, address indexed creator, uint256 amount);
    event EscrowSubmitted(uint256 indexed escrowId, string deliverableUrl);
    event EscrowVerified(uint256 indexed escrowId, string verifierNotes);
    event EscrowReleased(uint256 indexed escrowId, uint256 creatorAmount, uint256 counterpartyAmount, uint256 feeAmount);
    event EscrowCancelled(uint256 indexed escrowId);
    event TreasuryUpdated(address indexed treasury);

    error NotParticipant();
    error InvalidStatus();
    error TransferFailed();
    error ZeroAmount();

    function initialize(address initialOwner, address usdc_, address treasury_) external {
        __Nexora_init(initialOwner);
        require(usdc_ != address(0), "ZERO_USDC");
        require(treasury_ != address(0), "ZERO_TREASURY");
        usdc = IERC20(usdc_);
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "ZERO_TREASURY");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function createEscrow(
        address counterparty,
        uint256 amount,
        uint256 performanceBond,
        uint16 platformFeeBps,
        string calldata title,
        string calldata description
    ) external returns (uint256 escrowId) {
        if (amount == 0) revert ZeroAmount();
        escrowId = nextEscrowId++;
        uint256 platformFee = (amount * platformFeeBps) / 10_000;
        escrows[escrowId] = Escrow({
            creator: msg.sender,
            counterparty: counterparty,
            amount: amount,
            performanceBond: performanceBond,
            platformFeeBps: platformFeeBps,
            platformFee: platformFee,
            counterpartyNet: amount - platformFee,
            status: Status.Draft,
            title: title,
            description: description,
            deliverableUrl: "",
            verifierNotes: ""
        });
        emit EscrowCreated(escrowId, msg.sender, counterparty, amount);
    }

    function fundEscrow(uint256 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        if (msg.sender != escrow.creator) revert NotParticipant();
        if (escrow.status != Status.Draft) revert InvalidStatus();
        escrow.status = Status.Funded;
        if (!usdc.transferFrom(msg.sender, address(this), escrow.amount + escrow.performanceBond)) revert TransferFailed();
        emit EscrowFunded(escrowId, msg.sender, escrow.amount);
    }

    function submitDeliverable(uint256 escrowId, string calldata deliverableUrl) external {
        Escrow storage escrow = escrows[escrowId];
        if (msg.sender != escrow.counterparty) revert NotParticipant();
        if (escrow.status != Status.Funded) revert InvalidStatus();
        escrow.status = Status.Submitted;
        escrow.deliverableUrl = deliverableUrl;
        emit EscrowSubmitted(escrowId, deliverableUrl);
    }

    function verifyDeliverable(uint256 escrowId, string calldata verifierNotes) external onlyOwner {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.status != Status.Submitted) revert InvalidStatus();
        escrow.status = Status.Verified;
        escrow.verifierNotes = verifierNotes;
        emit EscrowVerified(escrowId, verifierNotes);
    }

    function releaseEscrow(uint256 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.status != Status.Verified) revert InvalidStatus();
        escrow.status = Status.Released;
        uint256 fee = escrow.platformFee;
        uint256 creatorAmount = escrow.amount - fee;
        uint256 counterpartyAmount = escrow.performanceBond;
        if (fee > 0 && !usdc.transfer(treasury, fee)) revert TransferFailed();
        if (!usdc.transfer(escrow.counterparty, creatorAmount)) revert TransferFailed();
        if (!usdc.transfer(escrow.creator, counterpartyAmount)) revert TransferFailed();
        emit EscrowReleased(escrowId, creatorAmount, counterpartyAmount, fee);
    }

    function cancelEscrow(uint256 escrowId) external onlyOwner {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.status != Status.Funded && escrow.status != Status.Draft) revert InvalidStatus();
        escrow.status = Status.Cancelled;
        emit EscrowCancelled(escrowId);
    }
}
