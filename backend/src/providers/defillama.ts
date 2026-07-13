export type DefiLlamaYieldOpportunity = {
  id: string;
  title: string;
  payoutAsset: "USDC";
  automationEnabled: boolean;
  risk: "low" | "medium" | "high";
  provider: "defillama";
  status: "market_data" | "unavailable";
  contractAddress: string | null;
  chain: string;
  project: string;
  symbol: string;
  pool: string;
  poolMeta: string | null;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  stablecoin: boolean;
  exposure: string | null;
  ilRisk: string | null;
  sourceUrl: string;
  notes: string[];
  updatedAt: string;
};

type DefiLlamaPoolPayload = {
  status?: string;
  data?: DefiLlamaPool[];
};

type DefiLlamaPool = {
  chain?: string;
  project?: string;
  symbol?: string;
  tvlUsd?: number;
  apyBase?: number | null;
  apyReward?: number | null;
  apy?: number | null;
  stablecoin?: boolean;
  exposure?: string | null;
  ilRisk?: string | null;
  pool?: string;
  poolMeta?: string | null;
  underlyingTokens?: string[] | null;
};

const DEFILLAMA_YIELDS_URL = "https://yields.llama.fi/pools";
const MARKET_DATA_NOTE = "DeFiLlama mainnet market data only; execution must be handled by a separate approved adapter.";
const KNOWN_USDC_TOKENS = new Set([
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "0x0b2c639c533813f4aad7837caf62653d097ff85",
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e"
]);

export async function fetchDefiLlamaUsdcYields(options: {limit?: number; minTvlUsd?: number} = {}) {
  const response = await fetch(DEFILLAMA_YIELDS_URL, {
    headers: {"user-agent": "NexoraYieldProvider/1.0"},
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    throw new Error(`DeFiLlama returned ${response.status}`);
  }
  const payload = await response.json();
  return normalizeDefiLlamaPools(payload, options);
}

export function normalizeDefiLlamaPools(payload: unknown, options: {limit?: number; minTvlUsd?: number} = {}) {
  const limit = boundedInteger(options.limit ?? 12, 1, 50);
  const minTvlUsd = Number.isFinite(options.minTvlUsd) ? Math.max(0, Number(options.minTvlUsd)) : 250_000;
  const data = Array.isArray((payload as DefiLlamaPoolPayload)?.data) ? (payload as DefiLlamaPoolPayload).data ?? [] : [];
  const updatedAt = new Date().toISOString();

  return data
    .filter((pool) => isUsdcStablePool(pool, minTvlUsd))
    .map((pool) => normalizePool(pool, updatedAt))
    .sort((a, b) => b.apy - a.apy || b.tvlUsd - a.tvlUsd)
    .slice(0, limit);
}

export function summarizeDefiLlamaVaultQuery(query: string, opportunities: DefiLlamaYieldOpportunity[]) {
  const marker = query.toLowerCase();
  const filtered = opportunities.filter((item) => {
    const haystack = `${item.chain} ${item.project} ${item.symbol} ${item.poolMeta ?? ""}`.toLowerCase();
    return marker.includes("usdc") || haystack.includes(marker) || marker.includes(item.project.toLowerCase()) || marker.includes(item.chain.toLowerCase());
  });
  const candidates = (filtered.length > 0 ? filtered : opportunities).slice(0, 5);
  const best = candidates[0] ?? null;
  return {
    status: opportunities.length > 0 ? "ok" : "unavailable",
    providerStatus: {
      vaultData: opportunities.length > 0 ? "live" : "unavailable",
      source: "DeFiLlama Yields API",
      note: MARKET_DATA_NOTE
    },
    vault: query,
    bestOpportunity: best,
    apy: best?.apy ?? null,
    tvlUsd: best?.tvlUsd ?? null,
    riskLevel: best?.risk ?? "review",
    candidates,
    monitoring: {
      asset: "USDC",
      source: "DeFiLlama Yields API",
      automationEnabled: false,
      executionEnabled: false,
      candidateCount: candidates.length,
      updatedAt: best?.updatedAt ?? null
    },
    risks: [
      "DeFiLlama yield results are market data for monitoring and discovery, not an executable deposit route.",
      "Protocol adapters, contract verification, and user approval are required before moving USDC.",
      best?.risk === "high" ? "The strongest matched candidate carries a high risk signal." : "Candidate risk still depends on live liquidity, protocol controls, fees, and withdrawal terms."
    ],
    checks: [
      "APY and TVL are sourced from DeFiLlama yield data.",
      "Treat this as discovery and monitoring data, not an executable deposit route.",
      "Require an approved protocol adapter before an agent can move USDC.",
      "Avoid auto-routing into low-liquidity or unusually high-APY pools."
    ],
    rebalanceTriggers: [
      "Alert when a watched USDC pool APY changes by more than the configured spread.",
      "Alert when TVL falls below the minimum liquidity threshold.",
      "Require user approval before first deposit into any new protocol adapter."
    ],
    summary: best
      ? `${best.project} on ${best.chain} is the strongest matched USDC yield candidate at ${best.apy.toFixed(2)}% APY with $${Math.round(best.tvlUsd).toLocaleString("en-US")} TVL.`
      : "No DeFiLlama USDC yield candidates are currently available."
  };
}

function normalizePool(pool: DefiLlamaPool, updatedAt: string): DefiLlamaYieldOpportunity {
  const chain = String(pool.chain ?? "Unknown");
  const project = String(pool.project ?? "unknown");
  const symbol = String(pool.symbol ?? "USDC");
  const tvlUsd = Number(pool.tvlUsd ?? 0);
  const apy = Number(pool.apy ?? 0);
  const poolId = String(pool.pool ?? `${chain}:${project}:${symbol}`);
  const risk = riskForPool(pool, tvlUsd, apy);
  return {
    id: `defillama:${poolId}`,
    title: `${titleCase(project)} ${symbol} yield on ${chain}`,
    payoutAsset: "USDC",
    automationEnabled: false,
    risk,
    provider: "defillama",
    status: "market_data",
    contractAddress: firstAddress(pool.underlyingTokens),
    chain,
    project,
    symbol,
    pool: poolId,
    poolMeta: pool.poolMeta ?? null,
    tvlUsd: round(tvlUsd, 2),
    apy: round(apy, 4),
    apyBase: nullableNumber(pool.apyBase),
    apyReward: nullableNumber(pool.apyReward),
    stablecoin: Boolean(pool.stablecoin),
    exposure: pool.exposure ?? null,
    ilRisk: pool.ilRisk ?? null,
    sourceUrl: "https://defillama.com/yields",
    notes: [
      MARKET_DATA_NOTE,
      risk === "high" ? "High-risk signal: review APY, TVL, exposure, and protocol assumptions before routing funds." : "Suitable for discovery and alerts; execution remains disabled until a provider adapter is approved."
    ],
    updatedAt
  };
}

function isUsdcStablePool(pool: DefiLlamaPool, minTvlUsd: number) {
  const symbol = String(pool.symbol ?? "").toUpperCase();
  const tvlUsd = Number(pool.tvlUsd ?? 0);
  const apy = Number(pool.apy ?? 0);
  const tokens = (pool.underlyingTokens ?? []).map((token) => token.toLowerCase());
  const hasKnownUsdcToken = tokens.some((token) => KNOWN_USDC_TOKENS.has(token));
  return Boolean(pool.stablecoin) && (symbol.includes("USDC") || hasKnownUsdcToken) && tvlUsd >= minTvlUsd && Number.isFinite(apy) && apy > 0;
}

function riskForPool(pool: DefiLlamaPool, tvlUsd: number, apy: number): "low" | "medium" | "high" {
  const ilRisk = String(pool.ilRisk ?? "").toLowerCase();
  const exposure = String(pool.exposure ?? "").toLowerCase();
  if (apy > 30 || tvlUsd < 250_000 || (ilRisk && ilRisk !== "no")) return "high";
  if (apy > 15 || tvlUsd < 1_000_000 || (exposure && exposure !== "single")) return "medium";
  return "low";
}

function nullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? round(value, 4) : null;
}

function firstAddress(values: string[] | null | undefined) {
  return values?.find((value) => /^0x[a-fA-F0-9]{40}$/.test(value)) ?? null;
}

function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
