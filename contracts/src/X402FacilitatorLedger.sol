// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {NexoraPolicyRegistry} from "./NexoraPolicyRegistry.sol";
import {OperatorReputation} from "./OperatorReputation.sol";
import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";

contract X402FacilitatorLedger is NexoraUpgradeable {
    struct Service {
        address publisher;
        string endpointHash;
        uint256 pricePerUnit;
        bool active;
    }

    IERC20 public usdc;
    NexoraPolicyRegistry public policyRegistry;
    OperatorReputation public reputation;
    address public treasury;
    uint16 public feeBps;
    uint256 public nextServiceId;

    mapping(uint256 => Service) public services;
    mapping(bytes32 => bool) public settledRequests;

    event TreasuryUpdated(address indexed treasury);
    event FeeUpdated(uint16 feeBps);
    event ServicePublished(uint256 indexed serviceId, address indexed publisher, uint256 pricePerUnit, string endpointHash);
    event ServiceStatusUpdated(uint256 indexed serviceId, bool active);
    event RequestSettled(
        uint256 indexed serviceId,
        bytes32 indexed requestHash,
        address indexed payer,
        address publisher,
        uint256 units,
        uint256 grossAmount,
        uint256 platformFee
    );

    error NotPublisher();
    error InactiveService();
    error DuplicateRequest();
    error ZeroUnits();
    error PolicyRejected();
    error TransferFailed();

    function initialize(
        address initialOwner,
        address usdc_,
        address policyRegistry_,
        address reputation_,
        address treasury_,
        uint16 feeBps_
    ) external {
        __Nexora_init(initialOwner);
        require(usdc_ != address(0), "ZERO_USDC");
        require(policyRegistry_ != address(0), "ZERO_POLICY");
        require(reputation_ != address(0), "ZERO_REPUTATION");
        require(treasury_ != address(0), "ZERO_TREASURY");
        require(feeBps_ <= 1_000, "FEE_TOO_HIGH");

        usdc = IERC20(usdc_);
        policyRegistry = NexoraPolicyRegistry(policyRegistry_);
        reputation = OperatorReputation(reputation_);
        treasury = treasury_;
        feeBps = feeBps_;
        nextServiceId = 1;
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

    function publishService(string calldata endpointHash, uint256 pricePerUnit) external returns (uint256 serviceId) {
        require(pricePerUnit > 0, "ZERO_PRICE");
        serviceId = nextServiceId++;
        services[serviceId] = Service({
            publisher: msg.sender,
            endpointHash: endpointHash,
            pricePerUnit: pricePerUnit,
            active: true
        });
        emit ServicePublished(serviceId, msg.sender, pricePerUnit, endpointHash);
    }

    function setServiceStatus(uint256 serviceId, bool active) external {
        Service storage service = services[serviceId];
        if (msg.sender != service.publisher && msg.sender != owner) revert NotPublisher();
        service.active = active;
        emit ServiceStatusUpdated(serviceId, active);
    }

    function settleRequest(uint256 serviceId, bytes32 requestHash, address payer, uint256 units)
        external
        returns (uint256 grossAmount)
    {
        Service memory service = services[serviceId];
        if (!service.active) revert InactiveService();
        if (settledRequests[requestHash]) revert DuplicateRequest();
        if (units == 0) revert ZeroUnits();

        grossAmount = service.pricePerUnit * units;

        if (policyRegistry.isAgentActive(payer)) {
            if (!policyRegistry.canSpend(payer, address(this), service.publisher, grossAmount)) revert PolicyRejected();
            policyRegistry.recordSpend(payer, address(this), service.publisher, grossAmount);
        }

        settledRequests[requestHash] = true;
        uint256 platformFee = (grossAmount * feeBps) / 10_000;
        uint256 publisherAmount = grossAmount - platformFee;

        if (!usdc.transferFrom(payer, service.publisher, publisherAmount)) revert TransferFailed();
        if (platformFee > 0 && !usdc.transferFrom(payer, treasury, platformFee)) revert TransferFailed();

        reputation.record(service.publisher, 0, 1);
        reputation.record(service.publisher, 2, units);

        emit RequestSettled(serviceId, requestHash, payer, service.publisher, units, grossAmount, platformFee);
    }
}
