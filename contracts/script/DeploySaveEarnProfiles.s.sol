// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NexoraProxy} from "../src/proxy/NexoraProxy.sol";
import {NexoraYieldRouter} from "../src/NexoraYieldRouter.sol";
import {NexoraSaveEarnVault} from "../src/NexoraSaveEarnVault.sol";
import {XyloNetUsdcVaultStrategy} from "../src/strategies/XyloNetUsdcVaultStrategy.sol";

interface VmProfiles {
    function envAddress(string calldata key) external view returns (address value);
    function envOr(string calldata key, address defaultValue) external view returns (address value);
    function envOr(string calldata key, uint256 defaultValue) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeploySaveEarnProfiles {
    VmProfiles internal constant vm = VmProfiles(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant XYLONET_ARC_TESTNET_VAULT = 0x240Eb85458CD41361bd8C3773253a1D78054f747;

    struct ProfileDeployment {
        address conservativeRouterImplementation;
        address conservativeRouterProxy;
        address conservativeAdapter;
        address growthRouterImplementation;
        address growthRouterProxy;
        address growthAdapter;
    }

    function run() external returns (ProfileDeployment memory deployed) {
        address owner = vm.envAddress("OWNER_ADDRESS");
        address aiOperator = vm.envAddress("AI_OPERATOR_ADDRESS");
        address saveEarnVault = vm.envAddress("SAVE_EARN_VAULT_PROXY_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);
        address xyloVault = vm.envOr("XYLONET_VAULT_ADDRESS", XYLONET_ARC_TESTNET_VAULT);
        uint256 conservativeApyBps = vm.envOr("XYLONET_CONSERVATIVE_EXPECTED_APY_BPS", uint256(0));
        uint256 growthApyBps = vm.envOr("XYLONET_GROWTH_EXPECTED_APY_BPS", uint256(0));
        uint256 xyloRiskScoreBps = vm.envOr("XYLONET_RISK_SCORE_BPS", uint256(3_000));
        uint256 maxMigrationLossBps = vm.envOr("SAVE_EARN_OPTIMIZER_MAX_MIGRATION_LOSS_BPS", uint256(25));
        require(conservativeApyBps <= type(uint16).max, "CONSERVATIVE_APY_TOO_HIGH");
        require(growthApyBps <= type(uint16).max, "GROWTH_APY_TOO_HIGH");
        require(maxMigrationLossBps <= 1_000, "LOSS_TOO_HIGH");
        require(xyloRiskScoreBps <= 10_000, "RISK_TOO_HIGH");

        vm.startBroadcast();

        (deployed.conservativeRouterImplementation, deployed.conservativeRouterProxy, deployed.conservativeAdapter) =
            _deployProfile(
                owner,
                aiOperator,
                saveEarnVault,
                usdc,
                xyloVault,
                conservativeApyBps,
                xyloRiskScoreBps,
                3_500,
                maxMigrationLossBps
            );
        NexoraSaveEarnVault(saveEarnVault).configureProfile(
            NexoraSaveEarnVault(saveEarnVault).CONSERVATIVE_PROFILE(),
            deployed.conservativeRouterProxy,
            true
        );

        (deployed.growthRouterImplementation, deployed.growthRouterProxy, deployed.growthAdapter) =
            _deployProfile(
                owner,
                aiOperator,
                saveEarnVault,
                usdc,
                xyloVault,
                growthApyBps,
                xyloRiskScoreBps,
                9_000,
                maxMigrationLossBps
            );
        NexoraSaveEarnVault(saveEarnVault).configureProfile(
            NexoraSaveEarnVault(saveEarnVault).GROWTH_PROFILE(),
            deployed.growthRouterProxy,
            true
        );

        vm.stopBroadcast();
    }

    function _deployProfile(
        address owner,
        address aiOperator,
        address saveEarnVault,
        address usdc,
        address xyloVault,
        uint256 expectedApyBps,
        uint256 riskScoreBps,
        uint256 maximumRiskBps,
        uint256 maxMigrationLossBps
    ) internal returns (address implementation, address proxy, address adapter) {
        implementation = address(new NexoraYieldRouter());
        proxy = address(
            new NexoraProxy(
                implementation,
                abi.encodeCall(NexoraYieldRouter.initialize, (owner, usdc, aiOperator))
            )
        );
        NexoraYieldRouter router = NexoraYieldRouter(proxy);
        router.setVault(saveEarnVault);
        router.setRebalanceControls(1 days, uint16(maxMigrationLossBps));
        router.setProfileRiskLimit(uint16(maximumRiskBps));

        adapter = address(new XyloNetUsdcVaultStrategy(usdc, xyloVault, proxy));
        uint256 strategyId = router.addStrategy(adapter, "XyloNet", uint16(expectedApyBps));
        router.setStrategyRiskScore(strategyId, uint16(riskScoreBps));
        router.activateStrategy(strategyId);
    }
}
