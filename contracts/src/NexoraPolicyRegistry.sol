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

    mapping(address => AgentProfile) public agentProfiles;
    mapping(address => SpendingPolicy) public policies;
    mapping(address => mapping(address => bool)) public allowedContracts;
    mapping(address => mapping(address => bool)) public allowedRecipients;
    mapping(address => mapping(uint256 => uint256)) public dailySpend;
    mapping(address => bool) public facilitators;

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

    error NotOperatorOrOwner();
    error NotFacilitator();
    error AgentNotActive();
    error PolicyNotActive();
    error TransactionCapExceeded();
    error DailyLimitExceeded();
    error ContractNotAllowed();
    error RecipientNotAllowed();

    function initialize(address initialOwner) external {
        __Nexora_init(initialOwner);
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
    ) external {
        AgentProfile memory profile = agentProfiles[agentWallet];

        if (!profile.active) {
            if (msg.sender != owner && msg.sender != operator) revert NotOperatorOrOwner();
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
    ) external onlyOperatorOrOwner(agentWallet) {
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
    {
        allowedContracts[agentWallet][target] = allowed;
        emit ContractAllowlistUpdated(agentWallet, target, allowed);
    }

    function setAllowedRecipient(address agentWallet, address recipient, bool allowed)
        external
        onlyOperatorOrOwner(agentWallet)
    {
        allowedRecipients[agentWallet][recipient] = allowed;
        emit RecipientAllowlistUpdated(agentWallet, recipient, allowed);
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

    function isAgentActive(address agentWallet) external view returns (bool) {
        return agentProfiles[agentWallet].active;
    }

    function recordSpend(address agentWallet, address targetContract, address recipient, uint256 amount) external {
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
}
