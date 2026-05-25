import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

loadLocalEnv();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
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
    sepoliaEscrow: process.env.ARB_SEPOLIA_NEXORA_ESCROW_ADDRESS ?? "",
    oneRpcUrl: process.env.ARB_ONE_RPC_URL ?? process.env.ARBITRUM_ONE_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
    oneChainId: Number(process.env.ARB_ONE_CHAIN_ID ?? 42161),
    oneExplorerUrl: process.env.ARB_ONE_EXPLORER_URL ?? "https://arbiscan.io",
    oneUsdc: process.env.ARB_ONE_USDC_ADDRESS ?? "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
  },
  circle: {
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
    kitKey: process.env.CIRCLE_KIT_KEY ?? process.env.KIT_KEY ?? process.env.VITE_CIRCLE_KIT_KEY ?? ""
  },
  contracts: {
    usdc: process.env.USDC_ADDRESS ?? "",
    policyRegistry: process.env.POLICY_REGISTRY_ADDRESS ?? "",
    x402Ledger: process.env.X402_LEDGER_ADDRESS ?? "",
    reputation: process.env.REPUTATION_ADDRESS ?? "",
    treasury: process.env.TREASURY_ADDRESS ?? ""
  },
  facilitator: {
    signingMode: process.env.FACILITATOR_SIGNING_MODE ?? "wallet",
    privateKey: process.env.FACILITATOR_PRIVATE_KEY ?? ""
  },
  integrations: {
    xBearerToken: process.env.X_BEARER_TOKEN ?? ""
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
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
