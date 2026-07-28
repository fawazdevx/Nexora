import {pathToFileURL} from "node:url";
import {isAddress} from "viem";
import {config} from "./config.js";
import {reconcileCanonicalMarketplaceRoutes} from "./marketplace/services.js";

type ReconcileArguments = {
  chainId: number;
  txHash: `0x${string}`;
};

export function parseReconcileArguments(argv: string[]): ReconcileArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") throw Object.assign(new Error(reconcileUsage()), {help: true});
    if (flag !== "--chain" && flag !== "--tx") throw new Error(`Unknown argument: ${flag ?? ""}\n\n${reconcileUsage()}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value\n\n${reconcileUsage()}`);
    values.set(flag, value);
    index += 1;
  }

  const chainId = Number(values.get("--chain"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error(`--chain must be a positive EVM chain ID\n\n${reconcileUsage()}`);
  const txHash = values.get("--tx") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error(`--tx must be a 32-byte transaction hash\n\n${reconcileUsage()}`);
  return {chainId, txHash: txHash as `0x${string}`};
}

export function reconcileUsage() {
  return "Usage: npm run marketplace:reconcile -- --chain <chain-id> --tx <publication-tx-hash>";
}

async function main() {
  const args = parseReconcileArguments(process.argv.slice(2));
  const publisherAddress = config.contracts.marketplacePublisher;
  if (!isAddress(publisherAddress)) {
    throw new Error("NEXORA_MARKETPLACE_PUBLISHER_ADDRESS must be configured before reconciliation.");
  }
  const result = await reconcileCanonicalMarketplaceRoutes({
    publisherAddress,
    settlementChainId: args.chainId,
    txHash: args.txHash
  });
  process.stdout.write(`${JSON.stringify({
    publisherAddress: result.publisherAddress,
    settlementChainId: result.settlementChainId,
    txHash: result.txHash,
    verifiedPublications: result.verifiedPublications,
    imported: result.imported,
    archived: result.archived,
    routeIds: result.routeIds
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const help = typeof error === "object" && error !== null && "help" in error;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = help ? 0 : 1;
  });
}
