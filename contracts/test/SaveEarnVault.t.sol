// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";
import {NexoraSaveEarnVault} from "../src/NexoraSaveEarnVault.sol";
import {IYieldStrategy} from "../src/interfaces/IYieldStrategy.sol";

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

contract SaveEarnVaultTest {
    MockUsdc public usdc;
    NexoraYieldRouter public router;
    NexoraSaveEarnVault public vault;
    MockYieldStrategy public strategy;

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

    function testWithdrawChargesPlatformFeeOnAssetsIncludingYield() external {
        setUp();
        usdc.mint(address(this), 1_000e6);
        usdc.approve(address(vault), 1_000e6);
        vault.deposit(1_000e6);
        strategy.addYield(100e6);

        vault.withdraw(1_000e6);

        assert(usdc.balanceOf(treasury) == 11e6);
        assert(usdc.balanceOf(address(this)) == 1_089e6);
        assert(vault.totalShares() == 0);
    }
}
