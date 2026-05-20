export function listEarnOpportunities() {
  const xylonetVault = process.env.XYLONET_VAULT_ADDRESS ?? "0x240Eb85458CD41361bd8C3773253a1D78054f747";

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
    }
  ];
}
