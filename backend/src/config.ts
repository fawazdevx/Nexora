import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

loadLocalEnv();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  arc: {
    rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    explorerUrl: process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app"
  },
  circle: {
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? ""
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
