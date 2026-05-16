// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployNexoraUpgradeable} from "./DeployNexoraUpgradeable.s.sol";

/// @notice First-time Nexora deployment script.
/// @dev Deploys new implementations, new ERC1967 proxies, initializes every module,
///      and wires cross-module permissions. Use upgrade scripts only after this.
contract DeployNexora is DeployNexoraUpgradeable {}
