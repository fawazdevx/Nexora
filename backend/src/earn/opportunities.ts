import {earnOptimizerProfilesStatus} from "./optimizer.js";

export async function listEarnOpportunities() {
  const profiles = await earnOptimizerProfilesStatus();
  return profiles.flatMap((optimizer) => optimizer.strategies.map((strategy) => ({
      id: `strategy:${optimizer.profile}:${strategy.strategyId}`,
      title: `${optimizer.profileLabel}: ${strategy.protocol} USDC strategy`,
      payoutAsset: "USDC",
      automationEnabled: optimizer.enabled,
      risk: strategy.riskScoreBps === null
        ? "unreviewed"
        : strategy.riskScoreBps <= 3_500
          ? "lower"
          : strategy.riskScoreBps <= 6_500
            ? "moderate"
            : "elevated",
      provider: strategy.protocol.toLowerCase(),
      status: strategy.current ? "active" : strategy.active ? "approved" : "disabled",
      contractAddress: strategy.underlyingVault ?? strategy.adapter,
      strategyId: strategy.strategyId,
      profile: optimizer.profile,
      current: strategy.current,
      expectedApyBps: strategy.expectedApyBps,
      totalAssetsUsdc: strategy.totalAssetsUsdc,
      underlyingVaultAssetsUsdc: strategy.underlyingVaultAssetsUsdc,
      assetsPerShare: strategy.assetsPerShare,
      riskScoreBps: strategy.riskScoreBps,
      riskConfigured: strategy.riskConfigured,
      liquidityScoreBps: strategy.liquidityScoreBps,
      optimizerScore: strategy.optimizerScore,
      eligibleForAutomaticRouting: strategy.eligibleForAutomaticRouting,
      telemetryStatus: strategy.telemetryStatus,
      checkedAt: optimizer.checkedAt
    })));
}
