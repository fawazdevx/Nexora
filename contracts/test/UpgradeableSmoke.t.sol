// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraPolicyRegistry} from "../src/NexoraPolicyRegistry.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";
import {NexoraSaveEarnVault} from "../src/NexoraSaveEarnVault.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract NexoraPolicyRegistryV2 is NexoraPolicyRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract LegacyPolicyRegistry {
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

    bytes32 internal constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    address public owner;
    bool private _initialized;
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

    constructor() {
        _initialized = true;
    }

    function initialize(address initialOwner) external {
        require(!_initialized, "INITIALIZED");
        _initialized = true;
        owner = initialOwner;
    }

    function seedLegacyState(
        address agent,
        address operator,
        address target,
        address recipient,
        address facilitator,
        bytes32 serviceId
    ) external {
        require(msg.sender == owner, "NOT_OWNER");
        agentProfiles[agent] = AgentProfile(operator, keccak256("legacy-agent"), true);
        policies[agent] = SpendingPolicy(100e6, 20e6, true, true, true);
        allowedContracts[agent][target] = true;
        allowedRecipients[agent][recipient] = true;
        dailySpend[agent][7] = 11e6;
        facilitators[facilitator] = true;
        policyV2[agent] = PolicyV2(300e6, 900e6, 4, 60, 999_999, true, true);
        allowedServiceIds[agent][serviceId] = true;
        weeklySpend[agent][3] = 22e6;
        monthlySpend[agent][2] = 33e6;
        lastSpendAt[agent] = 123_456;
    }

    function upgradeTo(address newImplementation) external {
        require(msg.sender == owner, "NOT_OWNER");
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImplementation)
        }
    }
}

contract LegacyYieldRouter {
    struct Strategy {
        address adapter;
        string protocol;
        uint16 expectedApyBps;
        bool active;
    }

    bytes32 internal constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    address public owner;
    bool private _initialized;
    IERC20 public usdc;
    address public vault;
    address public aiOperator;
    uint256 public activeStrategyId;
    uint256 public nextStrategyId;
    mapping(uint256 => Strategy) public strategies;

    constructor() {
        _initialized = true;
    }

    function initialize(address owner_, address usdc_, address vault_, address aiOperator_) external {
        require(!_initialized, "INITIALIZED");
        _initialized = true;
        owner = owner_;
        usdc = IERC20(usdc_);
        vault = vault_;
        aiOperator = aiOperator_;
        nextStrategyId = 2;
        activeStrategyId = 1;
        strategies[1] = Strategy(address(0x5151), "Legacy XyloNet", 420, true);
    }

    function upgradeTo(address newImplementation) external {
        require(msg.sender == owner, "NOT_OWNER");
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImplementation)
        }
    }
}

contract LegacySaveEarnVault {
    bytes32 internal constant IMPLEMENTATION_SLOT = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);

    address public owner;
    bool private _initialized;
    IERC20 public usdc;
    NexoraYieldRouter public yieldRouter;
    address public treasury;
    uint16 public withdrawalFeeBps;
    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public principalOf;

    constructor() {
        _initialized = true;
    }

    function initialize(
        address owner_,
        address usdc_,
        address yieldRouter_,
        address treasury_,
        uint16 withdrawalFeeBps_
    ) external {
        require(!_initialized, "INITIALIZED");
        _initialized = true;
        owner = owner_;
        usdc = IERC20(usdc_);
        yieldRouter = NexoraYieldRouter(yieldRouter_);
        treasury = treasury_;
        withdrawalFeeBps = withdrawalFeeBps_;
    }

    function seedPosition(address user, uint256 shares, uint256 principal) external {
        require(msg.sender == owner, "NOT_OWNER");
        balanceOf[user] = shares;
        principalOf[user] = principal;
        totalShares += shares;
    }

    function upgradeTo(address newImplementation) external {
        require(msg.sender == owner, "NOT_OWNER");
        bytes32 slot = IMPLEMENTATION_SLOT;
        assembly {
            sstore(slot, newImplementation)
        }
    }
}

contract UpgradeableSmokeTest {
    function testProxyInitializesPolicyRegistry() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );

        NexoraPolicyRegistry registry = NexoraPolicyRegistry(address(proxy));
        assert(registry.owner() == address(this));
    }

    function testImplementationCannotBeInitializedDirectly() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();

        try implementation.initialize(address(this)) {
            revert("DIRECT_INITIALIZE_SUCCEEDED");
        } catch {}
    }

    function testOwnerCanUpgradeProxyImplementation() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );
        NexoraPolicyRegistryV2 nextImplementation = new NexoraPolicyRegistryV2();

        NexoraPolicyRegistry(address(proxy)).upgradeTo(address(nextImplementation));

        uint256 version = NexoraPolicyRegistryV2(address(proxy)).version();
        assert(version == 2);
        assert(NexoraPolicyRegistry(address(proxy)).owner() == address(this));
    }

    function testProxiableUuidCannotBeCalledThroughProxy() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );

        try NexoraPolicyRegistry(address(proxy)).proxiableUUID() {
            revert("PROXIABLE_UUID_DELEGATED");
        } catch {}
    }

    function testProxyCannotUpgradeToAnotherProxy() external {
        NexoraPolicyRegistry firstImplementation = new NexoraPolicyRegistry();
        NexoraProxy firstProxy = new NexoraProxy(
            address(firstImplementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );
        NexoraPolicyRegistry secondImplementation = new NexoraPolicyRegistry();
        NexoraProxy secondProxy = new NexoraProxy(
            address(secondImplementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );

        try NexoraPolicyRegistry(address(firstProxy)).upgradeTo(address(secondProxy)) {
            revert("PROXY_TO_PROXY_UPGRADE_SUCCEEDED");
        } catch {}
    }

    function testOwnershipTransferRequiresAcceptance() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );
        NexoraPolicyRegistry registry = NexoraPolicyRegistry(address(proxy));
        OwnershipAcceptor nextOwner = new OwnershipAcceptor();

        registry.transferOwnership(address(nextOwner));
        assert(registry.owner() == address(this));
        assert(registry.pendingOwner() == address(nextOwner));

        nextOwner.accept(registry);
        assert(registry.owner() == address(nextOwner));
        assert(registry.pendingOwner() == address(0));
    }

    function testPauseBlocksPolicyWrites() external {
        NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeWithSignature("initialize(address)", address(this))
        );
        NexoraPolicyRegistry registry = NexoraPolicyRegistry(address(proxy));
        registry.pause();

        try registry.configureAgentPolicy(
            address(this),
            address(this),
            bytes32(0),
            1,
            1,
            false,
            false,
            true,
            new address[](0),
            new address[](0)
        ) {
            revert("PAUSED_POLICY_WRITE_SUCCEEDED");
        } catch {}

        registry.unpause();
        registry.configureAgentPolicy(
            address(this),
            address(this),
            bytes32(0),
            1,
            1,
            false,
            false,
            true,
            new address[](0),
            new address[](0)
        );
    }

    function testLegacyPolicyStorageSurvivesUpgrade() external {
        address agent = address(0xA11CE);
        address operator = address(0xB0B);
        address target = address(0x1234);
        address recipient = address(0x5678);
        address facilitator = address(0xFACADE);
        bytes32 serviceId = keccak256("legacy-service");

        LegacyPolicyRegistry legacyImplementation = new LegacyPolicyRegistry();
        NexoraProxy proxy = new NexoraProxy(
            address(legacyImplementation),
            abi.encodeCall(LegacyPolicyRegistry.initialize, (address(this)))
        );
        LegacyPolicyRegistry legacy = LegacyPolicyRegistry(address(proxy));
        legacy.seedLegacyState(agent, operator, target, recipient, facilitator, serviceId);

        NexoraPolicyRegistry nextImplementation = new NexoraPolicyRegistry();
        legacy.upgradeTo(address(nextImplementation));
        NexoraPolicyRegistry registry = NexoraPolicyRegistry(address(proxy));

        assert(registry.owner() == address(this));
        (address storedOperator, bytes32 nameHash, bool agentActive) = registry.agentProfiles(agent);
        assert(storedOperator == operator);
        assert(nameHash == keccak256("legacy-agent"));
        assert(agentActive);
        (
            uint256 dailyLimit,
            uint256 transactionCap,
            bool contractAllowlistEnabled,
            bool recipientAllowlistEnabled,
            bool policyActive
        ) = registry.policies(agent);
        assert(dailyLimit == 100e6);
        assert(transactionCap == 20e6);
        assert(contractAllowlistEnabled);
        assert(recipientAllowlistEnabled);
        assert(policyActive);
        assert(registry.allowedContracts(agent, target));
        assert(registry.allowedRecipients(agent, recipient));
        assert(registry.dailySpend(agent, 7) == 11e6);
        assert(registry.facilitators(facilitator));
        (
            uint256 weeklyLimit,
            uint256 monthlyLimit,
            uint256 maxUnitsPerRequest,
            uint256 cooldownSeconds,
            uint64 expiresAt,
            bool requireServiceAllowlist,
            bool requireOnchainPolicy
        ) = registry.policyV2(agent);
        assert(weeklyLimit == 300e6);
        assert(monthlyLimit == 900e6);
        assert(maxUnitsPerRequest == 4);
        assert(cooldownSeconds == 60);
        assert(expiresAt == 999_999);
        assert(requireServiceAllowlist);
        assert(requireOnchainPolicy);
        assert(registry.allowedServiceIds(agent, serviceId));
        assert(registry.weeklySpend(agent, 3) == 22e6);
        assert(registry.monthlySpend(agent, 2) == 33e6);
        assert(registry.lastSpendAt(agent) == 123_456);
        assert(registry.pendingOwner() == address(0));
        assert(!registry.paused());
    }

    function testYieldRouterStorageSurvivesOptimizerUpgrade() external {
        address usdc = address(0x3600);
        address vault = address(0xA11CE);
        address aiOperator = address(0xB0B);
        LegacyYieldRouter legacyImplementation = new LegacyYieldRouter();
        NexoraProxy proxy = new NexoraProxy(
            address(legacyImplementation),
            abi.encodeCall(LegacyYieldRouter.initialize, (address(this), usdc, vault, aiOperator))
        );
        LegacyYieldRouter legacy = LegacyYieldRouter(address(proxy));

        NexoraYieldRouter nextImplementation = new NexoraYieldRouter();
        legacy.upgradeTo(address(nextImplementation));
        NexoraYieldRouter router = NexoraYieldRouter(address(proxy));

        assert(router.owner() == address(this));
        assert(address(router.usdc()) == usdc);
        assert(router.vault() == vault);
        assert(router.aiOperator() == aiOperator);
        assert(router.activeStrategyId() == 1);
        assert(router.nextStrategyId() == 2);
        (address adapter, string memory protocol, uint16 expectedApyBps, bool active) = router.strategies(1);
        assert(adapter == address(0x5151));
        assert(keccak256(bytes(protocol)) == keccak256(bytes("Legacy XyloNet")));
        assert(expectedApyBps == 420);
        assert(active);
        assert(router.lastRebalancedAt() == 0);
        assert(router.minRebalanceInterval() == 0);
        assert(router.maxRebalanceLossBps() == 0);
    }

    function testSaveEarnBalancesBecomeBalancedProfileAfterUpgrade() external {
        address user = address(0xCAFE);
        address usdc = address(0x3600);
        address router = address(0xA11CE);
        address treasury = address(0xBEEF);
        LegacySaveEarnVault legacyImplementation = new LegacySaveEarnVault();
        NexoraProxy proxy = new NexoraProxy(
            address(legacyImplementation),
            abi.encodeCall(
                LegacySaveEarnVault.initialize,
                (address(this), usdc, router, treasury, uint16(100))
            )
        );
        LegacySaveEarnVault legacy = LegacySaveEarnVault(address(proxy));
        legacy.seedPosition(user, 500e6, 480e6);

        NexoraSaveEarnVault nextImplementation = new NexoraSaveEarnVault();
        legacy.upgradeTo(address(nextImplementation));
        NexoraSaveEarnVault vault = NexoraSaveEarnVault(address(proxy));

        assert(vault.owner() == address(this));
        assert(address(vault.usdc()) == usdc);
        assert(address(vault.yieldRouter()) == router);
        assert(vault.treasury() == treasury);
        assert(vault.withdrawalFeeBps() == 100);
        assert(vault.totalShares() == 500e6);
        assert(vault.balanceOf(user) == 500e6);
        assert(vault.principalOf(user) == 480e6);
        assert(vault.sharesOfProfile(vault.BALANCED_PROFILE(), user) == 500e6);
        assert(vault.principalOfProfile(vault.BALANCED_PROFILE(), user) == 480e6);
        assert(vault.totalSharesForProfile(vault.BALANCED_PROFILE()) == 500e6);
    }
}

contract OwnershipAcceptor {
    function accept(NexoraPolicyRegistry registry) external {
        registry.acceptOwnership();
    }
}
