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
    event UsdcMigrated(address indexed previousUsdc, address indexed newUsdc);
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
    event AgentRequestSettled(
        uint256 indexed serviceId,
        bytes32 indexed requestHash,
        address indexed agentWallet,
        address operator,
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
    error InvalidUsdc();
    error UnexpectedUsdc();
    error InvalidBatch();

    function initialize(
        address initialOwner,
        address usdc_,
        address policyRegistry_,
        address reputation_,
        address treasury_,
        uint16 feeBps_
    ) external {
        __Nexora_init(initialOwner);
        _validateUsdc(usdc_);
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

    /// @notice Atomically replace a misconfigured payment token while guarding
    ///         against upgrading the wrong proxy or chain.
    /// @dev Intended to be called through upgradeToAndCall so the implementation
    ///      and token correction happen in one owner transaction.
    function migrateUsdc(address expectedCurrentUsdc, address newUsdc) external onlyOwner {
        if (address(usdc) != expectedCurrentUsdc) revert UnexpectedUsdc();
        _validateUsdc(newUsdc);
        address previousUsdc = address(usdc);
        usdc = IERC20(newUsdc);
        emit UsdcMigrated(previousUsdc, newUsdc);
    }

    function publishService(string calldata endpointHash, uint256 pricePerUnit) external returns (uint256 serviceId) {
        return _publishService(msg.sender, endpointHash, pricePerUnit);
    }

    /// @notice Publish multiple routes owned by the same publisher in one
    ///         transaction. Every service still receives its own id and event.
    function publishServices(string[] calldata endpointHashes, uint256[] calldata pricesPerUnit)
        external
        returns (uint256[] memory serviceIds)
    {
        uint256 length = endpointHashes.length;
        if (length == 0 || length != pricesPerUnit.length || length > 50) revert InvalidBatch();
        serviceIds = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            serviceIds[i] = _publishService(msg.sender, endpointHashes[i], pricesPerUnit[i]);
        }
    }

    function _publishService(address publisher, string calldata endpointHash, uint256 pricePerUnit)
        internal
        returns (uint256 serviceId)
    {
        require(pricePerUnit > 0, "ZERO_PRICE");
        require(bytes(endpointHash).length > 0, "EMPTY_ENDPOINT");
        serviceId = nextServiceId++;
        services[serviceId] = Service({
            publisher: publisher,
            endpointHash: endpointHash,
            pricePerUnit: pricePerUnit,
            active: true
        });
        emit ServicePublished(serviceId, publisher, pricePerUnit, endpointHash);
    }

    function setServiceStatus(uint256 serviceId, bool active) external {
        Service storage service = services[serviceId];
        require(service.publisher != address(0), "UNKNOWN_SERVICE");
        if (msg.sender != service.publisher && msg.sender != owner) revert NotPublisher();
        service.active = active;
        emit ServiceStatusUpdated(serviceId, active);
    }

    function settleRequest(uint256 serviceId, bytes32 requestHash, address payer, uint256 units)
        external
        nonReentrant
        returns (uint256 grossAmount)
    {
        Service memory service = services[serviceId];
        require(service.publisher != address(0), "UNKNOWN_SERVICE");
        require(requestHash != bytes32(0), "ZERO_REQUEST");
        require(payer != address(0), "ZERO_PAYER");
        if (!service.active) revert InactiveService();
        if (settledRequests[requestHash]) revert DuplicateRequest();
        if (units == 0) revert ZeroUnits();

        grossAmount = service.pricePerUnit * units;

        if (policyRegistry.isAgentActive(payer)) {
            bytes32 serviceKey = bytes32(serviceId);
            if (!policyRegistry.canSpendV2(payer, address(this), service.publisher, grossAmount, serviceKey, units)) {
                revert PolicyRejected();
            }
            policyRegistry.recordSpendV2(payer, address(this), service.publisher, grossAmount, serviceKey, units);
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

    function settleAgentRequest(uint256 serviceId, bytes32 requestHash, uint256 units)
        external
        nonReentrant
        returns (uint256 grossAmount)
    {
        Service memory service = services[serviceId];
        require(service.publisher != address(0), "UNKNOWN_SERVICE");
        require(requestHash != bytes32(0), "ZERO_REQUEST");
        if (!service.active) revert InactiveService();
        if (settledRequests[requestHash]) revert DuplicateRequest();
        if (units == 0) revert ZeroUnits();

        address agentWallet = msg.sender;
        grossAmount = service.pricePerUnit * units;
        bytes32 serviceKey = bytes32(serviceId);
        if (!policyRegistry.canSpendV2(agentWallet, address(this), service.publisher, grossAmount, serviceKey, units)) {
            revert PolicyRejected();
        }
        policyRegistry.recordSpendV2(agentWallet, address(this), service.publisher, grossAmount, serviceKey, units);

        settledRequests[requestHash] = true;
        uint256 platformFee = (grossAmount * feeBps) / 10_000;
        uint256 publisherAmount = grossAmount - platformFee;

        if (!usdc.transferFrom(agentWallet, service.publisher, publisherAmount)) revert TransferFailed();
        if (platformFee > 0 && !usdc.transferFrom(agentWallet, treasury, platformFee)) revert TransferFailed();

        reputation.record(service.publisher, 0, 1);
        reputation.record(service.publisher, 2, units);
        (address operator,,) = policyRegistry.agentProfiles(agentWallet);

        emit AgentRequestSettled(
            serviceId,
            requestHash,
            agentWallet,
            operator,
            service.publisher,
            units,
            grossAmount,
            platformFee
        );
    }

    function _validateUsdc(address candidate) internal view {
        if (candidate == address(0) || candidate.code.length == 0) revert InvalidUsdc();
        (bool ok, bytes memory result) = candidate.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || result.length < 32 || abi.decode(result, (uint256)) != 6) revert InvalidUsdc();
    }
}
