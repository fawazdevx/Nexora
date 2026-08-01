// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract NexoraUpgradeable {
    bytes32 internal constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
    bytes32 internal constant REENTRANCY_GUARD_SLOT = bytes32(uint256(keccak256("nexora.proxy.reentrancy.status")) - 1);
    bytes32 internal constant PENDING_OWNER_SLOT = bytes32(uint256(keccak256("nexora.proxy.pending.owner")) - 1);
    bytes32 internal constant PAUSED_SLOT = bytes32(uint256(keccak256("nexora.proxy.paused")) - 1);
    address private immutable __self = address(this);

    address public owner;
    bool private _initialized;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed pendingOwner);
    event Upgraded(address indexed implementation);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error NotOwner();
    error NotPendingOwner();
    error AlreadyInitialized();
    error InvalidImplementation();
    error UnsupportedProxiableUUID();
    error ReentrantCall();
    error UnauthorizedCallContext();
    error ContractPaused();
    error ContractNotPaused();

    constructor() {
        _initialized = true;
    }

    modifier initializer() {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProxy() {
        if (address(this) == __self || _implementation() != __self) revert UnauthorizedCallContext();
        _;
    }

    modifier notDelegated() {
        if (address(this) != __self) revert UnauthorizedCallContext();
        _;
    }

    modifier whenNotPaused() {
        if (paused()) revert ContractPaused();
        _;
    }

    modifier whenPaused() {
        if (!paused()) revert ContractNotPaused();
        _;
    }

    modifier nonReentrant() {
        bytes32 slot = REENTRANCY_GUARD_SLOT;
        uint256 status;
        assembly {
            status := sload(slot)
        }
        if (status == 2) revert ReentrantCall();
        assembly {
            sstore(slot, 2)
        }
        _;
        assembly {
            sstore(slot, 1)
        }
    }

    function __Nexora_init(address initialOwner) internal initializer {
        require(initialOwner != address(0), "ZERO_OWNER");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        _setPendingOwner(newOwner);
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        address nextOwner = pendingOwner();
        if (msg.sender != nextOwner) revert NotPendingOwner();
        address previousOwner = owner;
        owner = nextOwner;
        _setPendingOwner(address(0));
        emit OwnershipTransferred(previousOwner, owner);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        _setPendingOwner(address(0));
        emit OwnershipTransferStarted(owner, address(0));
    }

    function pause() external onlyOwner whenNotPaused {
        _setPaused(true);
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner whenPaused {
        _setPaused(false);
        emit Unpaused(msg.sender);
    }

    function pendingOwner() public view returns (address pendingOwner_) {
        bytes32 slot = PENDING_OWNER_SLOT;
        assembly {
            pendingOwner_ := sload(slot)
        }
    }

    function paused() public view returns (bool paused_) {
        bytes32 slot = PAUSED_SLOT;
        uint256 value;
        assembly {
            value := sload(slot)
        }
        paused_ = value != 0;
    }

    function upgradeTo(address newImplementation) external onlyProxy onlyOwner {
        _upgradeTo(newImplementation);
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyProxy onlyOwner {
        _upgradeTo(newImplementation);
        (bool ok, bytes memory result) = newImplementation.delegatecall(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function proxiableUUID() external view notDelegated returns (bytes32) {
        return IMPLEMENTATION_SLOT;
    }

    function _upgradeTo(address newImplementation) internal {
        if (newImplementation.code.length == 0) revert InvalidImplementation();
        (bool ok, bytes memory result) = newImplementation.staticcall(abi.encodeWithSignature("proxiableUUID()"));
        if (!ok || result.length != 32 || abi.decode(result, (bytes32)) != IMPLEMENTATION_SLOT) {
            revert UnsupportedProxiableUUID();
        }

        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImplementation)
        }
        emit Upgraded(newImplementation);
    }

    function _implementation() internal view returns (address implementation_) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            implementation_ := sload(slot)
        }
    }

    function _setPendingOwner(address pendingOwner_) internal {
        bytes32 slot = PENDING_OWNER_SLOT;
        assembly {
            sstore(slot, pendingOwner_)
        }
    }

    function _setPaused(bool paused_) internal {
        bytes32 slot = PAUSED_SLOT;
        assembly {
            sstore(slot, paused_)
        }
    }
}
