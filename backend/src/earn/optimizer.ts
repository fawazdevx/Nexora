import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {config} from "../config.js";
import {readStore, updateStore, type EarnOptimizerRunRecord} from "../store.js";

const routerAbi = parseAbi([
  "function activeStrategyId() view returns (uint256)",
  "function nextStrategyId() view returns (uint256)",
  "function strategies(uint256) view returns (address adapter,string protocol,uint16 expectedApyBps,bool active)",
  "function strategyRiskScoreBps(uint256) view returns (uint16)",
  "function strategyRiskConfigured(uint256) view returns (bool)",
  "function aiOperator() view returns (address)",
  "function lastRebalancedAt() view returns (uint64)",
  "function minRebalanceInterval() view returns (uint64)",
  "function maxRebalanceLossBps() view returns (uint16)",
  "function rebalanceTo(uint256 strategyId,uint256 minAssetsOut) returns (uint256 assetsRouted)"
]);

const strategyAbi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function vault() view returns (address)"
]);

const erc4626Abi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)"
]);

export type EarnStrategySnapshot = {
  strategyId: number;
  adapter: Address;
  protocol: string;
  active: boolean;
  current: boolean;
  expectedApyBps: number | null;
  comparisonApyBps: number | null;
  yieldSource: "observed_share_price" | "configured" | "unavailable";
  totalAssetsUsdc: number;
  underlyingVault: Address | null;
  underlyingVaultAssetsUsdc: number | null;
  assetsPerShare: number | null;
  telemetryStatus: "live" | "limited" | "unavailable";
  riskScoreBps: number | null;
  riskConfigured: boolean;
  liquidityScoreBps: number;
  optimizerScore: number | null;
  eligibleForAutomaticRouting: boolean;
};

export type EarnProfileId = "conservative" | "balanced" | "growth";

export type EarnOptimizerStatus = {
  profile: EarnProfileId;
  profileLabel: string;
  riskPreference: string;
  routerAddress: Address | null;
  configured: boolean;
  enabled: boolean;
  executionEnabled: boolean;
  chainId: number;
  intervalHours: number;
  minImprovementBps: number;
  maxMigrationLossBps: number;
  activeStrategyId: number | null;
  strategies: EarnStrategySnapshot[];
  decision: ReturnType<typeof selectOptimizerDecision>;
  lastRun: EarnOptimizerRunRecord | null;
  nextCheckAt: string | null;
  checkedAt: string;
};

export async function earnOptimizerProfilesStatus() {
  return Promise.all((["conservative", "balanced", "growth"] as EarnProfileId[]).map(earnOptimizerStatus));
}

export function selectOptimizerDecision(
  strategies: EarnStrategySnapshot[],
  activeStrategyId: number | null,
  minImprovementBps: number,
  profile: EarnProfileId = "balanced"
) {
  const approved = strategies.filter((strategy) => strategy.active && strategy.telemetryStatus !== "unavailable");
  const active = approved.find((strategy) => strategy.strategyId === activeStrategyId) ?? null;
  if (!active) {
    const initial = approved
      .filter((strategy) => strategy.eligibleForAutomaticRouting)
      .sort(compareOptimizerScore)[0] ?? null;
    return {
      action: initial ? "rebalance" as const : "unavailable" as const,
      selectedStrategyId: initial?.strategyId ?? null,
      reason: initial
        ? `${initial.protocol} is the highest-ranked approved strategy for the ${profile} profile.`
        : "No approved strategy has complete yield, liquidity, and risk telemetry."
    };
  }
  if (approved.length < 2) {
    return {
      action: "stay" as const,
      selectedStrategyId: active.strategyId,
      reason: `${active.protocol} is the only approved strategy. Nexora will not fabricate a comparison.`
    };
  }

  const comparable = approved.filter((strategy) => strategy.eligibleForAutomaticRouting);
  if (
    comparable.length < 2
    || active.comparisonApyBps === null
    || active.optimizerScore === null
  ) {
    return {
      action: "stay" as const,
      selectedStrategyId: active.strategyId,
      reason: "At least two approved strategies need complete comparable yield, liquidity, and risk telemetry before an automatic rebalance."
    };
  }
  const selected = [...comparable].sort(compareOptimizerScore)[0] ?? active;
  const improvement = (selected.comparisonApyBps ?? 0) - active.comparisonApyBps;
  if (
    selected.strategyId === active.strategyId
    || (selected.optimizerScore ?? 0) <= active.optimizerScore
    || improvement < minImprovementBps
  ) {
    return {
      action: "stay" as const,
      selectedStrategyId: active.strategyId,
      reason: `No approved ${profile} strategy improves both its risk-adjusted score and expected APY by the required ${minImprovementBps} bps.`
    };
  }
  return {
    action: "rebalance" as const,
    selectedStrategyId: selected.strategyId,
    reason: `${selected.protocol} improves expected APY by ${improvement} bps and has the strongest eligible ${profile} risk-adjusted score.`
  };
}

export async function earnOptimizerStatus(profile: EarnProfileId = "balanced"): Promise<EarnOptimizerStatus> {
  const checkedAt = new Date();
  const profileConfig = optimizerProfile(profile);
  let strategies = profileConfig.routerAddress ? await readStrategies(profileConfig.routerAddress) : [];
  const store = await readStore();
  const lastRun = store.earnOptimizerRuns.find((run) => run.profile === profile) ?? null;
  strategies = applyObservedYield(strategies, lastRun, checkedAt);
  strategies = scoreOptimizerStrategies(strategies, profile);
  const activeStrategyId = strategies.find((strategy) => strategy.current)?.strategyId ?? null;
  const nextCheckAt = lastRun
    ? new Date(Date.parse(lastRun.createdAt) + config.earnOptimizer.intervalHours * 60 * 60 * 1000).toISOString()
    : checkedAt.toISOString();
  return {
    profile,
    profileLabel: profileConfig.label,
    riskPreference: profileConfig.riskPreference,
    routerAddress: profileConfig.routerAddress,
    configured: Boolean(profileConfig.routerAddress),
    enabled: config.earnOptimizer.enabled,
    executionEnabled: config.earnOptimizer.executionEnabled,
    chainId: config.arc.chainId,
    intervalHours: config.earnOptimizer.intervalHours,
    minImprovementBps: profileConfig.minImprovementBps,
    maxMigrationLossBps: config.earnOptimizer.maxMigrationLossBps,
    activeStrategyId,
    strategies,
    decision: selectOptimizerDecision(strategies, activeStrategyId, profileConfig.minImprovementBps, profile),
    lastRun,
    nextCheckAt,
    checkedAt: checkedAt.toISOString()
  };
}

export async function evaluateEarnOptimizer(options: {execute?: boolean; force?: boolean} = {}) {
  const status = await earnOptimizerStatus("balanced");
  return evaluateProfileStatus(status, options);
}

export async function evaluateEarnOptimizerProfile(
  profile: EarnProfileId,
  options: {execute?: boolean; force?: boolean} = {}
) {
  const status = await earnOptimizerStatus(profile);
  return evaluateProfileStatus(status, options);
}

export async function evaluateAllEarnOptimizers(options: {execute?: boolean; force?: boolean} = {}) {
  const results = [];
  for (const profile of ["conservative", "balanced", "growth"] as EarnProfileId[]) {
    results.push(await evaluateEarnOptimizerProfile(profile, options));
  }
  return {evaluatedAt: new Date().toISOString(), results};
}

async function evaluateProfileStatus(
  status: EarnOptimizerStatus,
  options: {execute?: boolean; force?: boolean}
) {
  if (!status.configured) {
    return {
      profile: status.profile,
      status: "skipped" as const,
      reason: `${status.profileLabel} router is not configured.`,
      createdAt: new Date().toISOString()
    };
  }
  const now = Date.now();
  const dueAt = status.lastRun
    ? Date.parse(status.lastRun.createdAt) + status.intervalHours * 60 * 60 * 1000
    : 0;
  if (!options.force && now < dueAt) {
    return {
      status: "skipped" as const,
      reason: `Next optimizer check is scheduled for ${new Date(dueAt).toISOString()}.`,
      createdAt: new Date().toISOString()
    };
  }
  if (status.decision.action !== "rebalance" || status.decision.selectedStrategyId === null) {
    return recordRun(status, status.decision.action === "stay" ? "stay" : "failed", status.decision.reason);
  }
  if (!options.execute || !config.earnOptimizer.executionEnabled) {
    return recordRun(status, "rebalance_recommended", status.decision.reason);
  }

  try {
    const txHash = await executeRebalance(status, status.decision.selectedStrategyId);
    return recordRun(status, "rebalanced", status.decision.reason, txHash);
  } catch (error) {
    return recordRun(status, "failed", error instanceof Error ? error.message : "Optimizer rebalance failed.");
  }
}

async function readStrategies(routerAddress: Address): Promise<EarnStrategySnapshot[]> {
  const client = publicClient();
  const [activeRaw, nextRaw] = await Promise.all([
    client.readContract({address: routerAddress, abi: routerAbi, functionName: "activeStrategyId"}),
    client.readContract({address: routerAddress, abi: routerAbi, functionName: "nextStrategyId"})
  ]);
  const activeStrategyId = Number(activeRaw);
  const output: EarnStrategySnapshot[] = [];
  for (let strategyId = 1; strategyId < Number(nextRaw); strategyId += 1) {
    const [[adapter, protocol, expectedApyBps, active], risk] = await Promise.all([
      client.readContract({
        address: routerAddress,
        abi: routerAbi,
        functionName: "strategies",
        args: [BigInt(strategyId)]
      }),
      readStrategyRisk(routerAddress, strategyId)
    ]);
    if (!isAddress(adapter)) continue;
    output.push(await strategySnapshot({
      strategyId,
      adapter,
      protocol,
      expectedApyBps: Number(expectedApyBps),
      active,
      current: strategyId === activeStrategyId,
      riskScoreBps: risk.configured ? risk.scoreBps : null,
      riskConfigured: risk.configured
    }));
  }
  return output;
}

async function strategySnapshot(input: {
  strategyId: number;
  adapter: Address;
  protocol: string;
  expectedApyBps: number;
  active: boolean;
  current: boolean;
  riskScoreBps: number | null;
  riskConfigured: boolean;
}): Promise<EarnStrategySnapshot> {
  const client = publicClient();
  try {
    const totalAssets = await client.readContract({
      address: input.adapter,
      abi: strategyAbi,
      functionName: "totalAssets"
    });
    let underlyingVault: Address | null = null;
    let underlyingVaultAssetsUsdc: number | null = null;
    let assetsPerShare: number | null = null;
    try {
      underlyingVault = await client.readContract({
        address: input.adapter,
        abi: strategyAbi,
        functionName: "vault"
      });
      const [vaultAssets, totalSupply, shareDecimals] = await Promise.all([
        client.readContract({address: underlyingVault, abi: erc4626Abi, functionName: "totalAssets"}),
        client.readContract({address: underlyingVault, abi: erc4626Abi, functionName: "totalSupply"}),
        client.readContract({address: underlyingVault, abi: erc4626Abi, functionName: "decimals"})
      ]);
      const oneShare = 10n ** BigInt(Math.min(Number(shareDecimals), 36));
      const oneShareAssets = await client.readContract({
        address: underlyingVault,
        abi: erc4626Abi,
        functionName: "convertToAssets",
        args: [oneShare]
      });
      underlyingVaultAssetsUsdc = Number(formatUnits(vaultAssets, 6));
      assetsPerShare = totalSupply > 0n ? Number(formatUnits(oneShareAssets, 6)) : 1;
    } catch {
      // Generic future adapters can still participate using their approved
      // expected APY and adapter-level totalAssets telemetry.
    }
    return {
      strategyId: input.strategyId,
      adapter: input.adapter,
      protocol: input.protocol,
      active: input.active,
      current: input.current,
      expectedApyBps: input.expectedApyBps > 0 ? input.expectedApyBps : null,
      comparisonApyBps: input.expectedApyBps > 0 ? input.expectedApyBps : null,
      yieldSource: input.expectedApyBps > 0 ? "configured" : "unavailable",
      totalAssetsUsdc: Number(formatUnits(totalAssets, 6)),
      underlyingVault,
      underlyingVaultAssetsUsdc,
      assetsPerShare,
      telemetryStatus: underlyingVault ? "live" : "limited",
      riskScoreBps: input.riskScoreBps,
      riskConfigured: input.riskConfigured,
      liquidityScoreBps: liquidityScore(underlyingVaultAssetsUsdc ?? Number(formatUnits(totalAssets, 6))),
      optimizerScore: null,
      eligibleForAutomaticRouting: false
    };
  } catch {
    return {
      strategyId: input.strategyId,
      adapter: input.adapter,
      protocol: input.protocol,
      active: input.active,
      current: input.current,
      expectedApyBps: input.expectedApyBps > 0 ? input.expectedApyBps : null,
      comparisonApyBps: input.expectedApyBps > 0 ? input.expectedApyBps : null,
      yieldSource: input.expectedApyBps > 0 ? "configured" : "unavailable",
      totalAssetsUsdc: 0,
      underlyingVault: null,
      underlyingVaultAssetsUsdc: null,
      assetsPerShare: null,
      telemetryStatus: "unavailable",
      riskScoreBps: input.riskScoreBps,
      riskConfigured: input.riskConfigured,
      liquidityScoreBps: 0,
      optimizerScore: null,
      eligibleForAutomaticRouting: false
    };
  }
}

export function scoreOptimizerStrategies(strategies: EarnStrategySnapshot[], profile: EarnProfileId) {
  const settings = profileScoring(profile);
  return strategies.map((strategy) => {
    const riskEligible = strategy.riskConfigured
      && strategy.riskScoreBps !== null
      && strategy.riskScoreBps <= settings.maximumRiskBps;
    const hasYield = strategy.comparisonApyBps !== null;
    const telemetryEligible = strategy.telemetryStatus !== "unavailable" && strategy.liquidityScoreBps > 0;
    const eligibleForAutomaticRouting = strategy.active && riskEligible && hasYield && telemetryEligible;
    if (!eligibleForAutomaticRouting || strategy.riskScoreBps === null || strategy.comparisonApyBps === null) {
      return {...strategy, optimizerScore: null, eligibleForAutomaticRouting};
    }
    const yieldScoreBps = Math.max(0, Math.min(strategy.comparisonApyBps, 10_000));
    const safetyScoreBps = 10_000 - strategy.riskScoreBps;
    const optimizerScore = Math.round((
      yieldScoreBps * settings.yieldWeight
      + strategy.liquidityScoreBps * settings.liquidityWeight
      + safetyScoreBps * settings.safetyWeight
    ) / 100);
    return {...strategy, optimizerScore, eligibleForAutomaticRouting};
  });
}

async function readStrategyRisk(routerAddress: Address, strategyId: number) {
  const client = publicClient();
  try {
    const [scoreBps, configured] = await Promise.all([
      client.readContract({
        address: routerAddress,
        abi: routerAbi,
        functionName: "strategyRiskScoreBps",
        args: [BigInt(strategyId)]
      }),
      client.readContract({
        address: routerAddress,
        abi: routerAbi,
        functionName: "strategyRiskConfigured",
        args: [BigInt(strategyId)]
      })
    ]);
    return {scoreBps: Number(scoreBps), configured};
  } catch {
    // Routers deployed before risk metadata was added stay readable, but no
    // automatic migration is permitted until the implementation is upgraded
    // and the owner explicitly configures each strategy's risk score.
    return {scoreBps: 0, configured: false};
  }
}

function profileScoring(profile: EarnProfileId) {
  if (profile === "conservative") {
    return {yieldWeight: 30, liquidityWeight: 35, safetyWeight: 35, maximumRiskBps: 3_500};
  }
  if (profile === "growth") {
    return {yieldWeight: 70, liquidityWeight: 15, safetyWeight: 15, maximumRiskBps: 9_000};
  }
  return {yieldWeight: 50, liquidityWeight: 25, safetyWeight: 25, maximumRiskBps: 6_500};
}

function liquidityScore(totalAssetsUsdc: number | null) {
  if (totalAssetsUsdc === null || !Number.isFinite(totalAssetsUsdc) || totalAssetsUsdc <= 0) return 0;
  if (totalAssetsUsdc >= 10_000_000) return 10_000;
  if (totalAssetsUsdc >= 5_000_000) return 9_000;
  if (totalAssetsUsdc >= 1_000_000) return 8_000;
  if (totalAssetsUsdc >= 500_000) return 6_500;
  if (totalAssetsUsdc >= 100_000) return 5_000;
  return 3_000;
}

function compareOptimizerScore(a: EarnStrategySnapshot, b: EarnStrategySnapshot) {
  return (b.optimizerScore ?? -1) - (a.optimizerScore ?? -1)
    || (b.comparisonApyBps ?? -1) - (a.comparisonApyBps ?? -1)
    || b.totalAssetsUsdc - a.totalAssetsUsdc;
}

async function executeRebalance(status: EarnOptimizerStatus, strategyId: number) {
  const key = config.earnOptimizer.privateKey as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Save/Earn optimizer execution key is not configured.");
  }
  if (!status.routerAddress) {
    throw new Error("Yield router address is not configured.");
  }
  const account = privateKeyToAccount(key);
  const client = publicClient();
  const aiOperator = await client.readContract({
    address: status.routerAddress,
    abi: routerAbi,
    functionName: "aiOperator"
  });
  if (aiOperator.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Configured optimizer wallet is not the router AI operator.");
  }
  const active = status.strategies.find((strategy) => strategy.current);
  const activeAssets = active ? BigInt(Math.floor(active.totalAssetsUsdc * 1_000_000)) : 0n;
  const minAssetsOut = activeAssets * BigInt(10_000 - status.maxMigrationLossBps) / 10_000n;
  const chain = arcChain();
  const wallet = createWalletClient({account, chain, transport: http(config.arc.rpcUrl)});
  const {request} = await client.simulateContract({
    account,
    address: status.routerAddress,
    abi: routerAbi,
    functionName: "rebalanceTo",
    args: [BigInt(strategyId), minAssetsOut]
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({hash: txHash});
  if (receipt.status !== "success") throw new Error("Save/Earn rebalance transaction reverted.");
  return txHash;
}

async function recordRun(
  status: EarnOptimizerStatus,
  runStatus: EarnOptimizerRunRecord["status"],
  reason: string,
  txHash: string | null = null
) {
  const active = status.strategies.find((strategy) => strategy.current) ?? null;
  const selected = status.strategies.find((strategy) => strategy.strategyId === status.decision.selectedStrategyId) ?? null;
  const run: EarnOptimizerRunRecord = {
    id: crypto.randomUUID(),
    profile: status.profile,
    chainId: status.chainId,
    status: runStatus,
    activeStrategyId: active?.strategyId ?? null,
    selectedStrategyId: selected?.strategyId ?? null,
    activeProtocol: active?.protocol ?? null,
    selectedProtocol: selected?.protocol ?? null,
    reason,
    strategyCount: status.strategies.length,
    activeApyBps: active?.comparisonApyBps ?? null,
    selectedApyBps: selected?.comparisonApyBps ?? null,
    strategyTelemetry: status.strategies.map((strategy) => ({
      strategyId: strategy.strategyId,
      assetsPerShare: strategy.assetsPerShare,
      observedAt: status.checkedAt
    })),
    txHash,
    createdAt: new Date().toISOString()
  };
  await updateStore((store) => {
    store.earnOptimizerRuns.unshift(run);
    store.earnOptimizerRuns = store.earnOptimizerRuns.slice(0, 200);
  });
  return run;
}

function optimizerProfile(profile: EarnProfileId) {
  if (profile === "conservative") {
    return {
      label: "Conservative",
      riskPreference: "Prioritizes liquidity, stability, and reviewed low-risk adapters.",
      routerAddress: isAddress(config.contracts.conservativeYieldRouter)
        ? config.contracts.conservativeYieldRouter
        : null,
      minImprovementBps: config.earnOptimizer.conservativeMinImprovementBps
    } as const;
  }
  if (profile === "growth") {
    return {
      label: "Growth",
      riskPreference: "Accepts reviewed higher-variance routes for stronger net yield.",
      routerAddress: isAddress(config.contracts.growthYieldRouter)
        ? config.contracts.growthYieldRouter
        : null,
      minImprovementBps: config.earnOptimizer.growthMinImprovementBps
    } as const;
  }
  return {
    label: "Balanced",
    riskPreference: "Balances net yield, liquidity, stability, and migration cost.",
    routerAddress: isAddress(config.contracts.yieldRouter) ? config.contracts.yieldRouter : null,
    minImprovementBps: config.earnOptimizer.minImprovementBps
  } as const;
}

function applyObservedYield(
  strategies: EarnStrategySnapshot[],
  previousRun: EarnOptimizerRunRecord | null,
  observedAt: Date
) {
  if (!previousRun) return strategies;
  const minimumWindowMs = Math.min(config.earnOptimizer.intervalHours, 24) * 60 * 60 * 1000;
  return strategies.map((strategy) => {
    if (!strategy.assetsPerShare || strategy.assetsPerShare <= 0) return strategy;
    const previous = previousRun.strategyTelemetry.find((item) => item.strategyId === strategy.strategyId);
    if (!previous?.assetsPerShare || previous.assetsPerShare <= 0) return strategy;
    const elapsedMs = observedAt.getTime() - Date.parse(previous.observedAt);
    if (!Number.isFinite(elapsedMs) || elapsedMs < minimumWindowMs * 0.9) return strategy;
    const change = strategy.assetsPerShare / previous.assetsPerShare - 1;
    const annualizedBps = Math.round(change * (365 * 24 * 60 * 60 * 1000 / elapsedMs) * 10_000);
    if (!Number.isFinite(annualizedBps) || annualizedBps < -10_000 || annualizedBps > 100_000) {
      return strategy;
    }
    return {
      ...strategy,
      comparisonApyBps: annualizedBps,
      yieldSource: "observed_share_price" as const
    };
  });
}

function publicClient() {
  return createPublicClient({chain: arcChain(), transport: http(config.arc.rpcUrl)});
}

function arcChain() {
  return {
    id: config.arc.chainId,
    name: "Arc Testnet",
    nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
    rpcUrls: {default: {http: [config.arc.rpcUrl]}}
  } as const;
}
