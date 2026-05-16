import {config} from "./config.js";

type ReadinessItem = {
  key: string;
  label: string;
  configured: boolean;
  requiredFor: string;
};

export function integrationReadiness() {
  const items: ReadinessItem[] = [
    {
      key: "DATABASE_URL",
      label: "PostgreSQL",
      configured: Boolean(config.databaseUrl),
      requiredFor: "operators, services, x402 requests, reputation, and webhook state"
    },
    {
      key: "REDIS_URL",
      label: "Redis",
      configured: Boolean(config.redisUrl),
      requiredFor: "settlement, indexing, and agent action queues"
    },
    {
      key: "CIRCLE_API_KEY",
      label: "Circle API key",
      configured: Boolean(config.circle.apiKey),
      requiredFor: "Circle Agent Wallet creation and wallet operations"
    },
    {
      key: "CIRCLE_ENTITY_SECRET",
      label: "Circle entity secret",
      configured: Boolean(config.circle.entitySecret),
      requiredFor: "Circle programmable wallet signing and secure wallet actions"
    },
    {
      key: "FACILITATOR_PRIVATE_KEY",
      label: "Facilitator signer",
      configured: config.facilitator.signingMode === "wallet" || Boolean(config.facilitator.privateKey),
      requiredFor:
        config.facilitator.signingMode === "wallet"
          ? "not required in wallet-signed settlement mode"
          : "server-side x402 settlement calls on Arc"
    },
    {
      key: "POLICY_REGISTRY_ADDRESS",
      label: "Policy registry proxy",
      configured: Boolean(config.contracts.policyRegistry),
      requiredFor: "agent wallet spending policy reads and writes"
    },
    {
      key: "X402_LEDGER_ADDRESS",
      label: "x402 ledger proxy",
      configured: Boolean(config.contracts.x402Ledger),
      requiredFor: "API publishing, metering, and USDC settlement"
    },
    {
      key: "REPUTATION_ADDRESS",
      label: "Reputation proxy",
      configured: Boolean(config.contracts.reputation),
      requiredFor: "operator reputation indexing and updates"
    },
    {
      key: "TREASURY_ADDRESS",
      label: "Treasury",
      configured: Boolean(config.contracts.treasury),
      requiredFor: "platform fee settlement"
    }
  ];

  return {
    ready: items.every((item) => item.configured),
    missing: items.filter((item) => !item.configured).map((item) => item.key),
    items
  };
}
