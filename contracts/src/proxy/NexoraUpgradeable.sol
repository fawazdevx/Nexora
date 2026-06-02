// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract NexoraUpgradeable {
    bytes32 internal constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
    bytes32 internal constant REENTRANCY_GUARD_SLOT = bytes32(uint256(keccak256("nexora.proxy.reentrancy.status")) - 1);

    address public owner;
    bool private _initialized;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Upgraded(address indexed implementation);

    error NotOwner();
    error AlreadyInitialized();
    error InvalidImplementation();
    error UnsupportedProxiableUUID();
    error ReentrantCall();

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
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function upgradeTo(address newImplementation) external onlyOwner {
        _upgradeTo(newImplementation);
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyOwner {
        _upgradeTo(newImplementation);
        (bool ok, bytes memory result) = newImplementation.delegatecall(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function proxiableUUID() external pure returns (bytes32) {
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
}
