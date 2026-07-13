import {fetchDefiLlamaUsdcYields} from "../providers/defillama.js";

export async function listEarnOpportunities() {
  const xylonetVault = process.env.XYLONET_VAULT_ADDRESS ?? "0x240Eb85458CD41361bd8C3773253a1D78054f747";
  const marketData = await fetchDefiLlamaUsdcYields({limit: 6, minTvlUsd: 500_000}).catch((error) => [{
    id: "defillama_unavailable",
    title: "DeFiLlama USDC yield intelligence",
    payoutAsset: "USDC" as const,
    automationEnabled: false,
    risk: "medium" as const,
    provider: "defillama",
    status: "unavailable" as const,
    contractAddress: null,
    error: error instanceof Error ? error.message : "DeFiLlama unavailable"
  }]);

  return [
    {
      id: "xylonet_best_yield",
      title: "Nexora router: XyloNet USDC strategy",
      payoutAsset: "USDC",
      automationEnabled: Boolean(xylonetVault),
      risk: "medium",
      provider: "xylonet",
      status: "available",
      contractAddress: xylonetVault
    },
    {
      id: "x402_service_execution",
      title: "Paid x402 service execution",
      payoutAsset: "USDC",
      automationEnabled: true,
      risk: "low",
      provider: "nexora",
      status: "available"
    },
    ...marketData
  ];
}
