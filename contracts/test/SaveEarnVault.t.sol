// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";
import {NexoraSaveEarnVault} from "../src/NexoraSaveEarnVault.sol";
import {IYieldStrategy} from "../src/interfaces/IYieldStrategy.sol";
import {XyloNetUsdcVaultStrategy} from "../src/strategies/XyloNetUsdcVaultStrategy.sol";

contract MockUsdc {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockYieldStrategy is IYieldStrategy {
    MockUsdc public immutable usdc;
    address public immutable router;
    uint256 public assets;

    constructor(address usdc_, address router_) {
        usdc = MockUsdc(usdc_);
        router = router_;
    }

    function asset() external view returns (address) {
        return address(usdc);
    }

    function totalAssets() external view returns (uint256) {
        return assets;
    }

    function deposit(uint256 amount) external {
        require(msg.sender == router, "ROUTER");
        require(usdc.transferFrom(msg.sender, address(this), amount), "TRANSFER");
        assets += amount;
    }

    function withdraw(uint256 amount, address recipient) external returns (uint256 withdrawn) {
        require(msg.sender == router, "ROUTER");
        withdrawn = amount > assets ? assets : amount;
        assets -= withdrawn;
        require(usdc.transfer(recipient, withdrawn), "TRANSFER");
    }

    function addYield(uint256 amount) external {
        usdc.mint(address(this), amount);
        assets += amount;
    }
}

contract MockXyloNetVault {
    MockUsdc public immutable assetToken;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    uint256 public totalAssets;

    constructor(address usdc_) {
        assetToken = MockUsdc(usdc_);
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function previewWithdraw(uint256 assets) external pure returns (uint256) {
        return assets;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assetToken.transferFrom(msg.sender, address(this), assets), "TRANSFER");
        shares = assets;
        balanceOf[receiver] += shares;
        totalSupply += shares;
        totalAssets += assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(msg.sender == owner, "OWNER");
        shares = assets;
        require(balanceOf[owner] >= shares, "SHARES");
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        totalAssets -= assets;
        require(assetToken.transfer(receiver, assets), "TRANSFER");
    }
}

contract SaveEarnVaultTest {
    MockUsdc public usdc;
    NexoraYieldRouter public router;
    NexoraSaveEarnVault public vault;
    MockYieldStrategy public strategy;
    MockYieldStrategy public secondStrategy;
    NexoraYieldRouter public conservativeRouter;
    MockYieldStrategy public conservativeStrategy;

    address public treasury = address(0xBEEF);
    address public user = address(0xCAFE);

    function setUp() public {
        usdc = new MockUsdc();

        NexoraYieldRouter routerImplementation = new NexoraYieldRouter();
        NexoraProxy routerProxy = new NexoraProxy(
            address(routerImplementation),
            abi.encodeCall(NexoraYieldRouter.initialize, (address(this), address(usdc), address(this)))
        );
        router = NexoraYieldRouter(address(routerProxy));

        NexoraSaveEarnVault vaultImplementation = new NexoraSaveEarnVault();
        NexoraProxy vaultProxy = new NexoraProxy(
            address(vaultImplementation),
            abi.encodeCall(
                NexoraSaveEarnVault.initialize,
                (address(this), address(usdc), address(router), treasury, 100)
            )
        );
        vault = NexoraSaveEarnVault(address(vaultProxy));
        router.setVault(address(vault));

        strategy = new MockYieldStrategy(address(usdc), address(router));
        uint256 strategyId = router.addStrategy(address(strategy), "Mock Xylonet", 420);
        router.activateStrategy(strategyId);
    }

    function testDepositRoutesUsdcToActiveStrategy() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);

        vault.deposit(1_000e6);

        assert(vault.balanceOf(address(this)) == 1_000e6);
        assert(router.totalAssets() == 1_000e6);
        assert(usdc.balanceOf(address(strategy)) == 1_000e6);
    }

    function testXyloNetAdapterDepositsUnderlyingUsdcIntoExternalVault() external {
        usdc = new MockUsdc();

        NexoraYieldRouter routerImplementation = new NexoraYieldRouter();
        NexoraProxy routerProxy = new NexoraProxy(
            address(routerImplementation),
            abi.encodeCall(NexoraYieldRouter.initialize, (address(this), address(usdc), address(this)))
        );
        router = NexoraYieldRouter(address(routerProxy));

        NexoraSaveEarnVault vaultImplementation = new NexoraSaveEarnVault();
        NexoraProxy vaultProxy = new NexoraProxy(
            address(vaultImplementation),
            abi.encodeCall(
                NexoraSaveEarnVault.initialize,
                (address(this), address(usdc), address(router), treasury, 100)
            )
        );
        vault = NexoraSaveEarnVault(address(vaultProxy));
        router.setVault(address(vault));

        MockXyloNetVault underlying = new MockXyloNetVault(address(usdc));
        XyloNetUsdcVaultStrategy xyloAdapter =
            new XyloNetUsdcVaultStrategy(address(usdc), address(underlying), address(router));
        uint256 strategyId = router.addStrategy(address(xyloAdapter), "XyloNet", 420);
        router.setStrategyRiskScore(strategyId, 3_000);
        router.activateStrategy(strategyId);

        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);

        assert(usdc.balanceOf(address(vault)) == 0);
        assert(usdc.balanceOf(address(router)) == 0);
        assert(usdc.balanceOf(address(xyloAdapter)) == 0);
        assert(usdc.balanceOf(address(underlying)) == 1_000e6);
        assert(underlying.balanceOf(address(xyloAdapter)) == 1_000e6);
        assert(router.totalAssets() == 1_000e6);
    }

    function testWithdrawChargesPlatformFeeOnlyOnProfit() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);
        strategy.addYield(100e6);

        vault.withdraw(1_000e6);

        assert(usdc.balanceOf(treasury) == 1e6);
        assert(usdc.balanceOf(address(this)) == 1_099e6);
        assert(vault.totalShares() == 0);
    }

    function testWithdrawZeroFeeWhenNoProfit() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);

        vault.withdraw(1_000e6);

        assert(usdc.balanceOf(treasury) == 0);
        assert(usdc.balanceOf(address(this)) == 1_000e6);
    }

    function testRebalanceMovesAllAssetsToApprovedStrategy() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);
        strategy.addYield(100e6);

        secondStrategy = new MockYieldStrategy(address(usdc), address(router));
        uint256 secondStrategyId = router.addStrategy(address(secondStrategy), "Second vault", 600);
        router.setRebalanceControls(0, 100);
        router.setStrategyRiskScore(secondStrategyId, 4_000);
        router.setProfileRiskLimit(6_500);
        uint256 routed = router.rebalanceTo(secondStrategyId, 1_099e6);

        assert(routed == 1_100e6);
        assert(router.activeStrategyId() == secondStrategyId);
        assert(strategy.totalAssets() == 0);
        assert(secondStrategy.totalAssets() == 1_100e6);
        assert(router.totalAssets() == 1_100e6);
    }

    function testCannotSwitchStrategyWithoutMigratingAssets() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);

        secondStrategy = new MockYieldStrategy(address(usdc), address(router));
        uint256 secondStrategyId = router.addStrategy(address(secondStrategy), "Second vault", 600);

        (bool ok,) = address(router).call(abi.encodeCall(NexoraYieldRouter.activateStrategy, (secondStrategyId)));
        assert(!ok);
        assert(router.activeStrategyId() == 1);
    }

    function testRebalanceRejectsStrategyAboveProfileRiskLimit() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);

        secondStrategy = new MockYieldStrategy(address(usdc), address(router));
        uint256 secondStrategyId = router.addStrategy(address(secondStrategy), "High-risk vault", 1_200);
        router.setStrategyRiskScore(secondStrategyId, 7_500);
        router.setProfileRiskLimit(6_500);
        router.setRebalanceControls(0, 100);

        (bool ok,) = address(router).call(
            abi.encodeCall(NexoraYieldRouter.rebalanceTo, (secondStrategyId, 990e6))
        );
        assert(!ok);
        assert(router.activeStrategyId() == 1);
        assert(strategy.totalAssets() == 1_000e6);
        assert(secondStrategy.totalAssets() == 0);
    }

    function testProfilesRouteFundsAndAccountSeparately() external {
        setUp();
        _configureConservativeProfile();
        bytes32 conservative = vault.CONSERVATIVE_PROFILE();

        usdc.mint(address(this), 1_500e6);
        usdc.approve(address(vault), 1_500e6);
        vault.deposit(1_000e6);
        vault.depositForProfile(conservative, 500e6);

        assert(vault.balanceOf(address(this)) == 1_000e6);
        assert(vault.sharesOfProfile(conservative, address(this)) == 500e6);
        assert(vault.totalShares() == 1_000e6);
        assert(vault.totalSharesForProfile(conservative) == 500e6);
        assert(strategy.totalAssets() == 1_000e6);
        assert(conservativeStrategy.totalAssets() == 500e6);
        assert(vault.totalAssets() == 1_000e6);
        assert(vault.totalAssetsForProfile(conservative) == 500e6);

        vault.withdrawFromProfile(conservative, 500e6);
        assert(vault.sharesOfProfile(conservative, address(this)) == 0);
        assert(strategy.totalAssets() == 1_000e6);
        assert(vault.balanceOf(address(this)) == 1_000e6);
    }

    function testExistingBalancesRemainInBalancedProfile() external {
        setUp();
        usdc.mint(address(this), 250e6);
        usdc.approve(address(vault), 250e6);
        vault.deposit(250e6);

        assert(vault.sharesOfProfile(vault.BALANCED_PROFILE(), address(this)) == 250e6);
        assert(vault.principalOfProfile(vault.BALANCED_PROFILE(), address(this)) == 250e6);
        assert(vault.totalSharesForProfile(vault.BALANCED_PROFILE()) == 250e6);
    }

    function _configureConservativeProfile() internal {
        NexoraYieldRouter implementation = new NexoraYieldRouter();
        NexoraProxy proxy = new NexoraProxy(
            address(implementation),
            abi.encodeCall(NexoraYieldRouter.initialize, (address(this), address(usdc), address(this)))
        );
        conservativeRouter = NexoraYieldRouter(address(proxy));
        conservativeRouter.setVault(address(vault));
        conservativeStrategy = new MockYieldStrategy(address(usdc), address(conservativeRouter));
        uint256 strategyId = conservativeRouter.addStrategy(address(conservativeStrategy), "Conservative XyloNet", 300);
        conservativeRouter.setStrategyRiskScore(strategyId, 3_000);
        conservativeRouter.setProfileRiskLimit(3_500);
        conservativeRouter.activateStrategy(strategyId);
        vault.configureProfile(vault.CONSERVATIVE_PROFILE(), address(conservativeRouter), true);
    }
}
