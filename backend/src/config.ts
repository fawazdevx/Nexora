import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

loadLocalEnv();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  databaseSslRejectUnauthorized: (process.env.PGSSL_REJECT_UNAUTHORIZED ?? "true").toLowerCase() !== "false",
  redisUrl: process.env.REDIS_URL ?? "",
  arc: {
    rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    explorerUrl: process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app"
  },
  arbitrum: {
    sepoliaRpcUrl: process.env.ARB_SEPOLIA_RPC_URL ?? process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    sepoliaChainId: Number(process.env.ARB_SEPOLIA_CHAIN_ID ?? 421614),
    sepoliaExplorerUrl: process.env.ARB_SEPOLIA_EXPLORER_URL ?? "https://sepolia.arbiscan.io",
    sepoliaUsdc: process.env.ARB_SEPOLIA_USDC_ADDRESS ?? "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    sepoliaPolicyRegistry: process.env.ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS ?? "",
    sepoliaX402Ledger: process.env.ARB_SEPOLIA_X402_LEDGER_ADDRESS ?? "",
    sepoliaReputation: process.env.ARB_SEPOLIA_REPUTATION_ADDRESS ?? "",
    sepoliaYieldRouter: process.env.ARB_SEPOLIA_YIELD_ROUTER_ADDRESS ?? "",
    sepoliaSaveEarnVault: process.env.ARB_SEPOLIA_SAVE_EARN_VAULT_ADDRESS ?? "",
    sepoliaEscrow: process.env.ARB_SEPOLIA_NEXORA_ESCROW_ADDRESS ?? "",
    oneRpcUrl: process.env.ARB_ONE_RPC_URL ?? process.env.ARBITRUM_ONE_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
    oneChainId: Number(process.env.ARB_ONE_CHAIN_ID ?? 42161),
    oneExplorerUrl: process.env.ARB_ONE_EXPLORER_URL ?? "https://arbiscan.io",
    oneUsdc: process.env.ARB_ONE_USDC_ADDRESS ?? "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
  },
  base: {
    sepoliaRpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://base-sepolia-rpc.publicnode.com",
    sepoliaChainId: Number(process.env.BASE_SEPOLIA_CHAIN_ID ?? 84532),
    sepoliaExplorerUrl: process.env.BASE_SEPOLIA_EXPLORER_URL ?? "https://sepolia.basescan.org",
    sepoliaUsdc: process.env.BASE_SEPOLIA_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    sepoliaPolicyRegistry: process.env.BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS ?? "",
    sepoliaX402Ledger: process.env.BASE_SEPOLIA_X402_LEDGER_ADDRESS ?? "",
    sepoliaReputation: process.env.BASE_SEPOLIA_REPUTATION_ADDRESS ?? "",
    sepoliaYieldRouter: process.env.BASE_SEPOLIA_YIELD_ROUTER_ADDRESS ?? "",
    sepoliaSaveEarnVault: process.env.BASE_SEPOLIA_SAVE_EARN_VAULT_ADDRESS ?? "",
    sepoliaEscrow: process.env.BASE_SEPOLIA_NEXORA_ESCROW_ADDRESS ?? ""
  },
  circle: {
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID ?? "",
    agentWalletAccountType: normalizeCircleAccountType(process.env.CIRCLE_AGENT_WALLET_ACCOUNT_TYPE)
  },
  contracts: {
    usdc: process.env.USDC_ADDRESS ?? "",
    policyRegistry: process.env.POLICY_REGISTRY_ADDRESS ?? "",
    x402Ledger: process.env.X402_LEDGER_ADDRESS ?? "",
    reputation: process.env.REPUTATION_ADDRESS ?? "",
    yieldRouter: process.env.YIELD_ROUTER_ADDRESS ?? "",
    saveEarnVault: process.env.SAVE_EARN_VAULT_ADDRESS ?? "",
    nexoraEscrow: process.env.NEXORA_ESCROW_ADDRESS ?? "",
    treasury: process.env.TREASURY_ADDRESS ?? ""
  },
  facilitator: {
    signingMode: process.env.FACILITATOR_SIGNING_MODE ?? "wallet",
    privateKey: process.env.FACILITATOR_PRIVATE_KEY ?? ""
  },
  gateway: {
    apiUrl: process.env.GATEWAY_API_URL ?? "https://gateway-api-testnet.circle.com/v1",
    token: process.env.GATEWAY_TOKEN ?? "USDC"
  },
  security: {
    authSecret: process.env.NEXORA_AUTH_SECRET ?? process.env.AUTH_SECRET ?? "nexora-local-dev-secret",
    requireSignedAuth: (process.env.NEXORA_REQUIRE_SIGNED_AUTH ?? "false").toLowerCase() === "true",
    adminSecret: process.env.NEXORA_ADMIN_SECRET ?? "",
    webhookSecret: process.env.CIRCLE_WEBHOOK_SECRET ?? process.env.NEXORA_WEBHOOK_SECRET ?? "",
    indexerSecret: process.env.NEXORA_INDEXER_SECRET ?? ""
  },
  integrations: {
    xBearerToken: process.env.X_BEARER_TOKEN ?? "",
    synthraApiKey: process.env.SYNTHRA_API_KEY ?? "",
    synthraApiUrl: process.env.SYNTHRA_API_URL ?? "https://trading-api.synthra.org"
  },
  notifications: {
    publicAppUrl: process.env.NEXORA_PUBLIC_APP_URL ?? process.env.FRONTEND_PUBLIC_URL ?? "https://nexorafi.app",
    email: {
      provider: process.env.NEXORA_EMAIL_PROVIDER ?? "resend",
      from: process.env.NEXORA_EMAIL_FROM ?? "",
      resendApiKey: process.env.RESEND_API_KEY ?? ""
    },
    whatsapp: {
      enabled: (process.env.NEXORA_WHATSAPP_ENABLED ?? "false").toLowerCase() === "true",
      provider: process.env.NEXORA_WHATSAPP_PROVIDER ?? "twilio",
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
      authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
      from: process.env.TWILIO_WHATSAPP_FROM ?? ""
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
      webhookSecret: process.env.NEXORA_TELEGRAM_WEBHOOK_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
    }
  }
};

function loadLocalEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = unquoteEnvValue(trimmed.slice(index + 1).trim());
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function unquoteEnvValue(value: string) {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) return value;
  return value.slice(1, -1);
}

function normalizeCircleAccountType(value: string | undefined): "EOA" | "SCA" {
  return value?.toUpperCase() === "SCA" ? "SCA" : "EOA";
}
