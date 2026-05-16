export function listEarnOpportunities() {
  const xylonetConfigured = Boolean(process.env.XYLONET_API_URL);
  const synthraConfigured = Boolean(process.env.SYNTHRA_API_URL);

  return [
    {
      id: "xylonet_best_yield",
      title: "Xylonet USDC yield route",
      payoutAsset: "USDC",
      automationEnabled: xylonetConfigured,
      risk: "medium",
      provider: "xylonet",
      status: xylonetConfigured ? "available" : "requires_XYLONET_API_URL"
    },
    {
      id: "synthra_best_yield",
      title: "Synthra USDC yield route",
      payoutAsset: "USDC",
      automationEnabled: synthraConfigured,
      risk: "medium",
      provider: "synthra",
      status: synthraConfigured ? "available" : "requires_SYNTHRA_API_URL"
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
