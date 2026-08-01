// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraUpgradeable} from "./proxy/NexoraUpgradeable.sol";

contract NexoraPolicyRegistry is NexoraUpgradeable {
    struct SpendingPolicy {
        uint256 dailyLimit;
        uint256 transactionCap;
        bool contractAllowlistEnabled;
        bool recipientAllowlistEnabled;
        bool active;
    }

    struct AgentProfile {
        address operator;
        bytes32 arcNameHash;
        bool active;
    }

    struct PolicyV2 {
        uint256 weeklyLimit;
        uint256 monthlyLimit;
        uint256 maxUnitsPerRequest;
        uint256 cooldownSeconds;
        uint64 expiresAt;
        bool requireServiceAllowlist;
        bool requireOnchainPolicy;
    }

    struct SpendReservation {
        address agentWallet;
        address targetContract;
        address recipient;
        uint256 amount;
        bytes32 serviceId;
        uint256 units;
        uint256 day;
        uint256 week;
        uint256 month;
        uint64 expiresAt;
        uint8 status;
    }

    mapping(address => AgentProfile) public agentProfiles;
    mapping(address => SpendingPolicy) public policies;
    mapping(address => mapping(address => bool)) public allowedContracts;
    mapping(address => mapping(address => bool)) public allowedRecipients;
    mapping(address => mapping(uint256 => uint256)) public dailySpend;
    mapping(address => bool) public facilitators;
    mapping(address => PolicyV2) public policyV2;
    mapping(address => mapping(bytes32 => bool)) public allowedServiceIds;
    mapping(address => mapping(uint256 => uint256)) public weeklySpend;
    mapping(address => mapping(uint256 => uint256)) public monthlySpend;
    mapping(address => uint256) public lastSpendAt;
    mapping(bytes32 => SpendReservation) public spendReservations;
    mapping(address => mapping(uint256 => uint256)) public reservedDailySpend;
    mapping(address => mapping(uint256 => uint256)) public reservedWeeklySpend;
    mapping(address => mapping(uint256 => uint256)) public reservedMonthlySpend;

    event FacilitatorSet(address indexed facilitator, bool enabled);
    event AgentRegistered(address indexed agentWallet, address indexed operator, bytes32 arcNameHash);
    event PolicyUpdated(
        address indexed agentWallet,
        uint256 dailyLimit,
        uint256 transactionCap,
        bool contractAllowlistEnabled,
        bool recipientAllowlistEnabled,
        bool active
    );
    event ContractAllowlistUpdated(address indexed agentWallet, address indexed target, bool allowed);
    event RecipientAllowlistUpdated(address indexed agentWallet, address indexed recipient, bool allowed);
    event SpendRecorded(address indexed agentWallet, address indexed target, address indexed recipient, uint256 amount);
    event PolicyV2Updated(
        address indexed agentWallet,
        uint256 weeklyLimit,
        uint256 monthlyLimit,
        uint256 maxUnitsPerRequest,
        uint256 cooldownSeconds,
        uint64 expiresAt,
        bool requireServiceAllowlist,
        bool requireOnchainPolicy
    );
    event ServiceAllowlistUpdated(address indexed agentWallet, bytes32 indexed serviceId, bool allowed);
    event SpendReserved(
        bytes32 indexed settlementId,
        address indexed agentWallet,
        address indexed recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units,
        uint64 expiresAt
    );
    event SpendReservationFinalized(bytes32 indexed settlementId, address indexed agentWallet, uint256 amount);
    event SpendReservationCancelled(bytes32 indexed settlementId, address indexed agentWallet, uint256 amount);
    event SpendReservationExpired(bytes32 indexed settlementId, address indexed agentWallet, uint256 amount);

    error NotOperatorOrOwner();
    error NotFacilitator();
    error AgentNotActive();
    error PolicyNotActive();
    error TransactionCapExceeded();
    error DailyLimitExceeded();
    error ContractNotAllowed();
    error RecipientNotAllowed();
    error WeeklyLimitExceeded();
    error MonthlyLimitExceeded();
    error ServiceNotAllowed();
    error UnitsExceeded();
    error CooldownActive();
    error PolicyExpired();
    error AgentRegistrationUnauthorized();
    error InvalidSettlementId();
    error ReservationAlreadyExists();
    error ReservationNotPending();
    error ReservationNotExpired();
    error InvalidReservationExpiry();

    uint8 private constant _RESERVATION_PENDING = 1;
    uint8 private constant _RESERVATION_FINALIZED = 2;
    uint8 private constant _RESERVATION_CANCELLED = 3;
    uint8 private constant _RESERVATION_EXPIRED = 4;

    function initialize(address initialOwner) external {
        __Nexora_init(initialOwner);
    }

    function initialize(address initialOwner, address initialFacilitator) external {
        __Nexora_init(initialOwner);
        require(initialFacilitator != address(0), "ZERO_FACILITATOR");
        facilitators[initialFacilitator] = true;
        emit FacilitatorSet(initialFacilitator, true);
    }

    modifier onlyOperatorOrOwner(address agentWallet) {
        if (msg.sender != owner && msg.sender != agentProfiles[agentWallet].operator) {
            revert NotOperatorOrOwner();
        }
        _;
    }

    function setFacilitator(address facilitator, bool enabled) external onlyOwner {
        facilitators[facilitator] = enabled;
        emit FacilitatorSet(facilitator, enabled);
    }

    function registerAgent(address agentWallet, address operator, bytes32 arcNameHash) external onlyOwner {
        _registerAgent(agentWallet, operator, arcNameHash);
    }

    function configureAgentPolicy(
        address agentWallet,
        address operator,
        bytes32 arcNameHash,
        uint256 dailyLimit,
        uint256 transactionCap,
        bool contractAllowlistEnabled,
        bool recipientAllowlistEnabled,
        bool active,
        address[] calldata contractAllowlist,
        address[] calldata recipientAllowlist
    ) external whenNotPaused {
        AgentProfile memory profile = agentProfiles[agentWallet];

        if (!profile.active) {
            if (msg.sender != owner && msg.sender != agentWallet) revert AgentRegistrationUnauthorized();
            _registerAgent(agentWallet, operator, arcNameHash);
        } else if (msg.sender != owner && msg.sender != profile.operator) {
            revert NotOperatorOrOwner();
        }

        _setPolicy(
            agentWallet,
            dailyLimit,
            transactionCap,
            contractAllowlistEnabled,
            recipientAllowlistEnabled,
            active
        );

        for (uint256 i = 0; i < contractAllowlist.length; i++) {
            allowedContracts[agentWallet][contractAllowlist[i]] = true;
            emit ContractAllowlistUpdated(agentWallet, contractAllowlist[i], true);
        }

        for (uint256 i = 0; i < recipientAllowlist.length; i++) {
            allowedRecipients[agentWallet][recipientAllowlist[i]] = true;
            emit RecipientAllowlistUpdated(agentWallet, recipientAllowlist[i], true);
        }
    }

    function _registerAgent(address agentWallet, address operator, bytes32 arcNameHash) internal {
        require(agentWallet != address(0), "ZERO_AGENT");
        require(operator != address(0), "ZERO_OPERATOR");
        agentProfiles[agentWallet] = AgentProfile({operator: operator, arcNameHash: arcNameHash, active: true});
        emit AgentRegistered(agentWallet, operator, arcNameHash);
    }

    function setPolicy(
        address agentWallet,
        uint256 dailyLimit,
        uint256 transactionCap,
        bool contractAllowlistEnabled,
        bool recipientAllowlistEnabled,
        bool active
    ) external onlyOperatorOrOwner(agentWallet) whenNotPaused {
        _setPolicy(
            agentWallet,
            dailyLimit,
            transactionCap,
            contractAllowlistEnabled,
            recipientAllowlistEnabled,
            active
        );
    }

    function _setPolicy(
        address agentWallet,
        uint256 dailyLimit,
        uint256 transactionCap,
        bool contractAllowlistEnabled,
        bool recipientAllowlistEnabled,
        bool active
    ) internal {
        policies[agentWallet] = SpendingPolicy({
            dailyLimit: dailyLimit,
            transactionCap: transactionCap,
            contractAllowlistEnabled: contractAllowlistEnabled,
            recipientAllowlistEnabled: recipientAllowlistEnabled,
            active: active
        });
        emit PolicyUpdated(
            agentWallet,
            dailyLimit,
            transactionCap,
            contractAllowlistEnabled,
            recipientAllowlistEnabled,
            active
        );
    }

    function setAllowedContract(address agentWallet, address target, bool allowed)
        external
        onlyOperatorOrOwner(agentWallet)
        whenNotPaused
    {
        allowedContracts[agentWallet][target] = allowed;
        emit ContractAllowlistUpdated(agentWallet, target, allowed);
    }

    function setAllowedRecipient(address agentWallet, address recipient, bool allowed)
        external
        onlyOperatorOrOwner(agentWallet)
        whenNotPaused
    {
        allowedRecipients[agentWallet][recipient] = allowed;
        emit RecipientAllowlistUpdated(agentWallet, recipient, allowed);
    }

    function setPolicyV2(
        address agentWallet,
        uint256 weeklyLimit,
        uint256 monthlyLimit,
        uint256 maxUnitsPerRequest,
        uint256 cooldownSeconds,
        uint64 expiresAt,
        bool requireServiceAllowlist,
        bool requireOnchainPolicy
    ) external onlyOperatorOrOwner(agentWallet) whenNotPaused {
        policyV2[agentWallet] = PolicyV2({
            weeklyLimit: weeklyLimit,
            monthlyLimit: monthlyLimit,
            maxUnitsPerRequest: maxUnitsPerRequest,
            cooldownSeconds: cooldownSeconds,
            expiresAt: expiresAt,
            requireServiceAllowlist: requireServiceAllowlist,
            requireOnchainPolicy: requireOnchainPolicy
        });
        emit PolicyV2Updated(
            agentWallet,
            weeklyLimit,
            monthlyLimit,
            maxUnitsPerRequest,
            cooldownSeconds,
            expiresAt,
            requireServiceAllowlist,
            requireOnchainPolicy
        );
    }

    function setAllowedService(address agentWallet, bytes32 serviceId, bool allowed)
        external
        onlyOperatorOrOwner(agentWallet)
        whenNotPaused
    {
        allowedServiceIds[agentWallet][serviceId] = allowed;
        emit ServiceAllowlistUpdated(agentWallet, serviceId, allowed);
    }

    function canSpend(address agentWallet, address targetContract, address recipient, uint256 amount)
        public
        view
        returns (bool)
    {
        AgentProfile memory profile = agentProfiles[agentWallet];
        SpendingPolicy memory policy = policies[agentWallet];
        uint256 day = block.timestamp / 1 days;

        if (!profile.active || !policy.active) return false;
        if (amount == 0 || amount > policy.transactionCap) return false;
        if (dailySpend[agentWallet][day] + amount > policy.dailyLimit) return false;
        if (policy.contractAllowlistEnabled && !allowedContracts[agentWallet][targetContract]) return false;
        if (policy.recipientAllowlistEnabled && !allowedRecipients[agentWallet][recipient]) return false;

        return true;
    }

    function canSpendV2(
        address agentWallet,
        address targetContract,
        address recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units
    ) public view returns (bool) {
        return _canSpend(agentWallet, targetContract, recipient, amount, serviceId, units);
    }

    function isAgentActive(address agentWallet) external view returns (bool) {
        return agentProfiles[agentWallet].active;
    }

    function recordSpend(address agentWallet, address targetContract, address recipient, uint256 amount)
        external
        whenNotPaused
    {
        if (!facilitators[msg.sender]) revert NotFacilitator();

        AgentProfile memory profile = agentProfiles[agentWallet];
        SpendingPolicy memory policy = policies[agentWallet];
        if (!profile.active) revert AgentNotActive();
        if (!policy.active) revert PolicyNotActive();
        if (amount == 0 || amount > policy.transactionCap) revert TransactionCapExceeded();

        uint256 day = block.timestamp / 1 days;
        if (dailySpend[agentWallet][day] + amount > policy.dailyLimit) revert DailyLimitExceeded();
        if (policy.contractAllowlistEnabled && !allowedContracts[agentWallet][targetContract]) {
            revert ContractNotAllowed();
        }
        if (policy.recipientAllowlistEnabled && !allowedRecipients[agentWallet][recipient]) {
            revert RecipientNotAllowed();
        }

        dailySpend[agentWallet][day] += amount;
        emit SpendRecorded(agentWallet, targetContract, recipient, amount);
    }

    function recordSpendV2(
        address agentWallet,
        address targetContract,
        address recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units
    ) external whenNotPaused {
        _recordSpend(agentWallet, targetContract, recipient, amount, serviceId, units);
    }

    function reserveSpendV2(
        bytes32 settlementId,
        address agentWallet,
        address targetContract,
        address recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units,
        uint64 expiresAt
    ) external whenNotPaused {
        if (!facilitators[msg.sender]) revert NotFacilitator();
        if (settlementId == bytes32(0)) revert InvalidSettlementId();
        if (spendReservations[settlementId].status != 0) revert ReservationAlreadyExists();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 7 days) {
            revert InvalidReservationExpiry();
        }
        _requireCanSpend(agentWallet, targetContract, recipient, amount, serviceId, units, true);

        uint256 day = block.timestamp / 1 days;
        uint256 week = block.timestamp / 1 weeks;
        uint256 month = _monthIndex(block.timestamp);
        spendReservations[settlementId] = SpendReservation({
            agentWallet: agentWallet,
            targetContract: targetContract,
            recipient: recipient,
            amount: amount,
            serviceId: serviceId,
            units: units,
            day: day,
            week: week,
            month: month,
            expiresAt: expiresAt,
            status: _RESERVATION_PENDING
        });
        reservedDailySpend[agentWallet][day] += amount;
        reservedWeeklySpend[agentWallet][week] += amount;
        reservedMonthlySpend[agentWallet][month] += amount;
        emit SpendReserved(settlementId, agentWallet, recipient, amount, serviceId, units, expiresAt);
    }

    function finalizeSpendV2(bytes32 settlementId) external whenNotPaused {
        if (!facilitators[msg.sender]) revert NotFacilitator();
        SpendReservation storage reservation = spendReservations[settlementId];
        if (reservation.status == _RESERVATION_FINALIZED) return;
        if (reservation.status == _RESERVATION_PENDING) {
            _releaseReserved(reservation);
        } else if (reservation.status != _RESERVATION_EXPIRED) {
            revert ReservationNotPending();
        }
        dailySpend[reservation.agentWallet][reservation.day] += reservation.amount;
        weeklySpend[reservation.agentWallet][reservation.week] += reservation.amount;
        monthlySpend[reservation.agentWallet][reservation.month] += reservation.amount;
        lastSpendAt[reservation.agentWallet] = block.timestamp;
        reservation.status = _RESERVATION_FINALIZED;
        emit SpendRecorded(
            reservation.agentWallet,
            reservation.targetContract,
            reservation.recipient,
            reservation.amount
        );
        emit SpendReservationFinalized(settlementId, reservation.agentWallet, reservation.amount);
    }

    function cancelSpendReservation(bytes32 settlementId) external whenNotPaused {
        if (!facilitators[msg.sender]) revert NotFacilitator();
        _cancelSpendReservation(settlementId, false);
    }

    function releaseExpiredSpendReservation(bytes32 settlementId) external {
        _cancelSpendReservation(settlementId, true);
    }

    function _recordSpend(
        address agentWallet,
        address targetContract,
        address recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units
    ) internal {
        if (!facilitators[msg.sender]) revert NotFacilitator();

        AgentProfile memory profile = agentProfiles[agentWallet];
        SpendingPolicy memory policy = policies[agentWallet];
        PolicyV2 memory advanced = policyV2[agentWallet];
        if (!profile.active) revert AgentNotActive();
        if (!policy.active) revert PolicyNotActive();
        if (amount == 0 || amount > policy.transactionCap) revert TransactionCapExceeded();
        if (advanced.expiresAt != 0 && block.timestamp > advanced.expiresAt) revert PolicyExpired();
        if (advanced.maxUnitsPerRequest != 0 && units > advanced.maxUnitsPerRequest) revert UnitsExceeded();
        if (advanced.requireServiceAllowlist && !allowedServiceIds[agentWallet][serviceId]) revert ServiceNotAllowed();
        if (advanced.cooldownSeconds != 0 && lastSpendAt[agentWallet] != 0) {
            if (block.timestamp < lastSpendAt[agentWallet] + advanced.cooldownSeconds) revert CooldownActive();
        }

        uint256 day = block.timestamp / 1 days;
        if (dailySpend[agentWallet][day] + amount > policy.dailyLimit) revert DailyLimitExceeded();
        uint256 week = block.timestamp / 1 weeks;
        if (advanced.weeklyLimit != 0 && weeklySpend[agentWallet][week] + amount > advanced.weeklyLimit) {
            revert WeeklyLimitExceeded();
        }
        uint256 month = _monthIndex(block.timestamp);
        if (advanced.monthlyLimit != 0 && monthlySpend[agentWallet][month] + amount > advanced.monthlyLimit) {
            revert MonthlyLimitExceeded();
        }
        if (policy.contractAllowlistEnabled && !allowedContracts[agentWallet][targetContract]) {
            revert ContractNotAllowed();
        }
        if (policy.recipientAllowlistEnabled && !allowedRecipients[agentWallet][recipient]) {
            revert RecipientNotAllowed();
        }

        dailySpend[agentWallet][day] += amount;
        weeklySpend[agentWallet][week] += amount;
        monthlySpend[agentWallet][month] += amount;
        lastSpendAt[agentWallet] = block.timestamp;
        emit SpendRecorded(agentWallet, targetContract, recipient, amount);
    }

    function _cancelSpendReservation(bytes32 settlementId, bool requireExpired) internal {
        SpendReservation storage reservation = spendReservations[settlementId];
        if (reservation.status == _RESERVATION_CANCELLED) return;
        if (reservation.status == _RESERVATION_EXPIRED) return;
        if (reservation.status != _RESERVATION_PENDING) revert ReservationNotPending();
        if (requireExpired && block.timestamp <= reservation.expiresAt) revert ReservationNotExpired();
        _releaseReserved(reservation);
        if (requireExpired) {
            reservation.status = _RESERVATION_EXPIRED;
            emit SpendReservationExpired(settlementId, reservation.agentWallet, reservation.amount);
        } else {
            reservation.status = _RESERVATION_CANCELLED;
            emit SpendReservationCancelled(settlementId, reservation.agentWallet, reservation.amount);
        }
    }

    function _releaseReserved(SpendReservation storage reservation) internal {
        reservedDailySpend[reservation.agentWallet][reservation.day] -= reservation.amount;
        reservedWeeklySpend[reservation.agentWallet][reservation.week] -= reservation.amount;
        reservedMonthlySpend[reservation.agentWallet][reservation.month] -= reservation.amount;
    }

    function _canSpend(
        address agentWallet,
        address targetContract,
        address recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units
    ) internal view returns (bool) {
        AgentProfile memory profile = agentProfiles[agentWallet];
        SpendingPolicy memory policy = policies[agentWallet];
        PolicyV2 memory advanced = policyV2[agentWallet];
        uint256 day = block.timestamp / 1 days;

        if (!profile.active || !policy.active) return false;
        if (amount == 0 || amount > policy.transactionCap) return false;
        if (advanced.expiresAt != 0 && block.timestamp > advanced.expiresAt) return false;
        if (advanced.maxUnitsPerRequest != 0 && units > advanced.maxUnitsPerRequest) return false;
        if (advanced.requireServiceAllowlist && !allowedServiceIds[agentWallet][serviceId]) return false;
        if (advanced.cooldownSeconds != 0 && lastSpendAt[agentWallet] != 0) {
            if (block.timestamp < lastSpendAt[agentWallet] + advanced.cooldownSeconds) return false;
        }
        if (dailySpend[agentWallet][day] + reservedDailySpend[agentWallet][day] + amount > policy.dailyLimit) {
            return false;
        }
        uint256 week = block.timestamp / 1 weeks;
        if (
            advanced.weeklyLimit != 0
                && weeklySpend[agentWallet][week] + reservedWeeklySpend[agentWallet][week] + amount
                    > advanced.weeklyLimit
        ) return false;
        uint256 month = _monthIndex(block.timestamp);
        if (
            advanced.monthlyLimit != 0
                && monthlySpend[agentWallet][month] + reservedMonthlySpend[agentWallet][month] + amount
                    > advanced.monthlyLimit
        ) return false;
        if (policy.contractAllowlistEnabled && !allowedContracts[agentWallet][targetContract]) return false;
        if (policy.recipientAllowlistEnabled && !allowedRecipients[agentWallet][recipient]) return false;

        return true;
    }

    function _requireCanSpend(
        address agentWallet,
        address targetContract,
        address recipient,
        uint256 amount,
        bytes32 serviceId,
        uint256 units,
        bool includeReservations
    ) internal view {
        AgentProfile memory profile = agentProfiles[agentWallet];
        SpendingPolicy memory policy = policies[agentWallet];
        PolicyV2 memory advanced = policyV2[agentWallet];
        if (!profile.active) revert AgentNotActive();
        if (!policy.active) revert PolicyNotActive();
        if (amount == 0 || amount > policy.transactionCap) revert TransactionCapExceeded();
        if (advanced.expiresAt != 0 && block.timestamp > advanced.expiresAt) revert PolicyExpired();
        if (advanced.maxUnitsPerRequest != 0 && units > advanced.maxUnitsPerRequest) revert UnitsExceeded();
        if (advanced.requireServiceAllowlist && !allowedServiceIds[agentWallet][serviceId]) revert ServiceNotAllowed();
        if (advanced.cooldownSeconds != 0 && lastSpendAt[agentWallet] != 0) {
            if (block.timestamp < lastSpendAt[agentWallet] + advanced.cooldownSeconds) revert CooldownActive();
        }

        uint256 day = block.timestamp / 1 days;
        uint256 dailyReserved = includeReservations ? reservedDailySpend[agentWallet][day] : 0;
        if (dailySpend[agentWallet][day] + dailyReserved + amount > policy.dailyLimit) revert DailyLimitExceeded();
        uint256 week = block.timestamp / 1 weeks;
        uint256 weeklyReserved = includeReservations ? reservedWeeklySpend[agentWallet][week] : 0;
        if (advanced.weeklyLimit != 0 && weeklySpend[agentWallet][week] + weeklyReserved + amount > advanced.weeklyLimit) {
            revert WeeklyLimitExceeded();
        }
        uint256 month = _monthIndex(block.timestamp);
        uint256 monthlyReserved = includeReservations ? reservedMonthlySpend[agentWallet][month] : 0;
        if (
            advanced.monthlyLimit != 0
                && monthlySpend[agentWallet][month] + monthlyReserved + amount > advanced.monthlyLimit
        ) revert MonthlyLimitExceeded();
        if (policy.contractAllowlistEnabled && !allowedContracts[agentWallet][targetContract]) {
            revert ContractNotAllowed();
        }
        if (policy.recipientAllowlistEnabled && !allowedRecipients[agentWallet][recipient]) {
            revert RecipientNotAllowed();
        }
    }

    function _monthIndex(uint256 timestamp) internal pure returns (uint256) {
        return timestamp / 30 days;
    }
}
