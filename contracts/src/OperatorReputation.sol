// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";

contract OperatorReputation is NexoraUpgradeable {
    struct Scorecard {
        uint256 successfulPayments;
        uint256 completedTasks;
        uint256 marketplaceSales;
        uint256 ecosystemContributions;
        bool verifiedBuilder;
    }

    mapping(address => bool) public updaters;
    mapping(address => Scorecard) public scorecards;
    mapping(bytes32 => bool) public processedEvents;

    event UpdaterSet(address indexed updater, bool enabled);
    event ReputationRecorded(address indexed operator, uint8 metric, uint256 amount);
    event VerifiedBuilderSet(address indexed operator, bool verified);

    error NotUpdater();

    function initialize(address initialOwner) external {
        __Nexora_init(initialOwner);
        updaters[initialOwner] = true;
        emit UpdaterSet(initialOwner, true);
    }

    function initialize(address initialOwner, address initialUpdater) external {
        __Nexora_init(initialOwner);
        require(initialUpdater != address(0), "ZERO_UPDATER");
        updaters[initialUpdater] = true;
        emit UpdaterSet(initialUpdater, true);
    }

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert NotUpdater();
        _;
    }

    function setUpdater(address updater, bool enabled) external onlyOwner {
        updaters[updater] = enabled;
        emit UpdaterSet(updater, enabled);
    }

    function record(address operator, uint8 metric, uint256 amount) external onlyUpdater whenNotPaused {
        _record(operator, metric, amount);
    }

    function recordWithId(bytes32 eventId, address operator, uint8 metric, uint256 amount)
        external
        onlyUpdater
        whenNotPaused
    {
        require(eventId != bytes32(0), "ZERO_EVENT_ID");
        if (processedEvents[eventId]) return;
        processedEvents[eventId] = true;
        _record(operator, metric, amount);
    }

    function _record(address operator, uint8 metric, uint256 amount) internal {
        require(operator != address(0), "ZERO_OPERATOR");
        require(amount > 0, "ZERO_AMOUNT");

        Scorecard storage card = scorecards[operator];
        if (metric == 0) card.successfulPayments += amount;
        else if (metric == 1) card.completedTasks += amount;
        else if (metric == 2) card.marketplaceSales += amount;
        else if (metric == 3) card.ecosystemContributions += amount;
        else revert("INVALID_METRIC");

        emit ReputationRecorded(operator, metric, amount);
    }

    function setVerifiedBuilder(address operator, bool verified) external onlyUpdater whenNotPaused {
        scorecards[operator].verifiedBuilder = verified;
        emit VerifiedBuilderSet(operator, verified);
    }
}
