import {createPublicClient, formatUnits, http, isAddress, parseAbi, type Abi, type Address} from "viem";
import {config} from "../config.js";
import {readStore, updateStore, type IndexedChainEventRecord} from "../store.js";

const x402LedgerAbi = parseAbi([
  "event ServicePublished(uint256 indexed serviceId,address indexed publisher,uint256 pricePerUnit,string endpointHash)",
  "event RequestSettled(uint256 indexed serviceId,bytes32 indexed requestHash,address indexed payer,address publisher,uint256 units,uint256 grossAmount,uint256 platformFee)",
  "event AgentRequestSettled(uint256 indexed serviceId,bytes32 indexed requestHash,address indexed agentWallet,address operator,address publisher,uint256 units,uint256 grossAmount,uint256 platformFee)"
]);

const escrowAbi = parseAbi([
  "event EscrowCreated(uint256 indexed escrowId,address indexed creator,address indexed counterparty,uint256 amount)",
  "event EscrowFunded(uint256 indexed escrowId,address indexed creator,uint256 amount)",
  "event EscrowSubmitted(uint256 indexed escrowId,string deliverableUrl)",
  "event EscrowVerified(uint256 indexed escrowId,string verifierNotes)",
  "event EscrowReleased(uint256 indexed escrowId,uint256 creatorAmount,uint256 counterpartyAmount,uint256 feeAmount)",
  "event EscrowCancelled(uint256 indexed escrowId)"
]);

const saveEarnAbi = parseAbi([
  "event Deposited(address indexed user,uint256 assets,uint256 shares)",
  "event Withdrawn(address indexed user,uint256 assets,uint256 fee,uint256 shares)"
]);

const yieldRouterAbi = parseAbi([
  "event StrategyAdded(uint256 indexed strategyId,address indexed adapter,string protocol,uint16 expectedApyBps)",
  "event StrategyActivated(uint256 indexed strategyId,string protocol,uint16 expectedApyBps)",
  "event DepositedToStrategy(uint256 indexed strategyId,uint256 amount)",
  "event WithdrawnFromStrategy(uint256 indexed strategyId,address indexed recipient,uint256 requested,uint256 withdrawn)"
]);

const policyRegistryAbi = parseAbi([
  "event AgentRegistered(address indexed agentWallet,address indexed operator,bytes32 arcNameHash)",
  "event PolicyUpdated(address indexed agentWallet,uint256 dailyLimit,uint256 transactionCap,bool contractAllowlistEnabled,bool recipientAllowlistEnabled,bool active)",
  "event SpendRecorded(address indexed agentWallet,address indexed target,address indexed recipient,uint256 amount)"
]);

type IndexedContract = {
  key: IndexedChainEventRecord["contract"];
  address: string;
  abi: Abi;
};

export async function syncArcIndexer() {
  const contracts = configuredContracts();
  if (contracts.length === 0) {
    return {status: "skipped", reason: "no Arc contract addresses configured", indexed: 0, latestBlock: 0};
  }

  const client = createPublicClient({
    chain: arcChain(),
    transport: http(config.arc.rpcUrl)
  });
  const latestBlock = await client.getBlockNumber();
  const confirmations = BigInt(envInteger("ARC_INDEXER_CONFIRMATIONS", 2, 0));
  const safeLatest = latestBlock > confirmations ? latestBlock - confirmations : latestBlock;
  const maxBlocks = BigInt(envInteger("ARC_INDEXER_MAX_BLOCKS", 5_000, 100));
  let indexed = 0;
  const ranges: Array<{contract: IndexedContract["key"]; address: string; fromBlock: number; toBlock: number; events: number}> = [];

  for (const contract of contracts) {
    const cursor = await cursorFor(contract);
    const fromBlock = cursor + 1n;
    if (fromBlock > safeLatest) continue;
    const toBlock = fromBlock + maxBlocks - 1n > safeLatest ? safeLatest : fromBlock + maxBlocks - 1n;
    const logs = await client.getLogs({
      address: contract.address as Address,
      events: contract.abi,
      fromBlock,
      toBlock
    });
    const records = logs.map((log) => normalizeLog(contract, log)).filter((item): item is IndexedChainEventRecord => Boolean(item));
    await persistIndexed(contract, Number(toBlock), records);
    indexed += records.length;
    ranges.push({
      contract: contract.key,
      address: contract.address,
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      events: records.length
    });
  }

  return {
    status: "ok",
    indexed,
    latestBlock: Number(safeLatest),
    ranges
  };
}

export async function indexedAnalytics() {
  const store = await readStore();
  const events = store.indexedEvents;
  const settled = events.filter((event) => event.contract === "x402Ledger" && (event.event === "RequestSettled" || event.event === "AgentRequestSettled"));
  const escrowReleased = events.filter((event) => event.contract === "nexoraEscrow" && event.event === "EscrowReleased");
  const saveDeposits = events.filter((event) => event.contract === "saveEarnVault" && event.event === "Deposited");
  const saveWithdrawals = events.filter((event) => event.contract === "saveEarnVault" && event.event === "Withdrawn");
  const policySaves = events.filter((event) => event.contract === "policyRegistry" && event.event === "PolicyUpdated");
  const agentRegistrations = events.filter((event) => event.contract === "policyRegistry" && event.event === "AgentRegistered");
  const servicesPublished = events.filter((event) => event.contract === "x402Ledger" && event.event === "ServicePublished");

  const marketplaceGross = sumAmount(settled);
  const marketplaceFees = sumFee(settled);
  const escrowFees = sumFee(escrowReleased);
  const saveDepositVolume = sumAmount(saveDeposits);
  const saveWithdrawalVolume = sumAmount(saveWithdrawals);
  const saveEarnFees = sumFee(saveWithdrawals);
  return {
    cursors: store.indexerCursors,
    recentEvents: events.slice(-60).reverse(),
    summary: {
      indexedEvents: events.length,
      servicesPublished: servicesPublished.length,
      marketplaceSettlements: settled.length,
      marketplaceGrossUsdc: roundUsdc(marketplaceGross),
      marketplaceFeesUsdc: roundUsdc(marketplaceFees),
      escrowReleases: escrowReleased.length,
      escrowFeesUsdc: roundUsdc(escrowFees),
      saveEarnDeposits: saveDeposits.length,
      saveEarnDepositVolumeUsdc: roundUsdc(saveDepositVolume),
      saveEarnWithdrawals: saveWithdrawals.length,
      saveEarnWithdrawalVolumeUsdc: roundUsdc(saveWithdrawalVolume),
      saveEarnFeesUsdc: roundUsdc(saveEarnFees),
      policySaves: policySaves.length,
      agentRegistrations: agentRegistrations.length,
      totalPlatformRevenueUsdc: roundUsdc(marketplaceFees + escrowFees + saveEarnFees)
    },
    bySource: [
      {source: "x402 marketplace fees", revenueUsdc: roundUsdc(marketplaceFees), amountUsdc: roundUsdc(marketplaceFees), kind: "revenue", count: settled.length},
      {source: "escrow fees", revenueUsdc: roundUsdc(escrowFees), amountUsdc: roundUsdc(escrowFees), kind: "revenue", count: escrowReleased.length},
      {source: "Save/Earn withdrawal fees", revenueUsdc: roundUsdc(saveEarnFees), amountUsdc: roundUsdc(saveEarnFees), kind: "revenue", count: saveWithdrawals.length},
      {source: "Save/Earn deposits", revenueUsdc: 0, amountUsdc: roundUsdc(saveDepositVolume), kind: "volume", count: saveDeposits.length},
      {source: "Save/Earn withdrawals", revenueUsdc: 0, amountUsdc: roundUsdc(saveWithdrawalVolume), kind: "volume", count: saveWithdrawals.length},
      {source: "policy saves", revenueUsdc: 0, amountUsdc: 0, kind: "usage", count: policySaves.length}
    ]
  };
}

function configuredContracts(): IndexedContract[] {
  return [
    {key: "x402Ledger", address: config.contracts.x402Ledger, abi: x402LedgerAbi},
    {key: "nexoraEscrow", address: config.contracts.nexoraEscrow, abi: escrowAbi},
    {key: "saveEarnVault", address: config.contracts.saveEarnVault, abi: saveEarnAbi},
    {key: "yieldRouter", address: config.contracts.yieldRouter, abi: yieldRouterAbi},
    {key: "policyRegistry", address: config.contracts.policyRegistry, abi: policyRegistryAbi}
  ].filter((contract) => isAddress(contract.address)) as IndexedContract[];
}

async function cursorFor(contract: IndexedContract) {
  const store = await readStore();
  const id = cursorId(contract);
  const existing = store.indexerCursors.find((cursor) => cursor.id === id);
  if (existing) return BigInt(existing.lastBlock);
  return BigInt(envInteger("ARC_INDEXER_FROM_BLOCK", 0, 0)) - 1n;
}

async function persistIndexed(contract: IndexedContract, lastBlock: number, records: IndexedChainEventRecord[]) {
  await updateStore((store) => {
    const seen = new Set(store.indexedEvents.map((event) => event.id));
    for (const record of records) {
      if (!seen.has(record.id)) {
        store.indexedEvents.push(record);
        seen.add(record.id);
      }
    }
    store.indexedEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    if (store.indexedEvents.length > 10_000) store.indexedEvents = store.indexedEvents.slice(-10_000);

    const id = cursorId(contract);
    const existing = store.indexerCursors.find((cursor) => cursor.id === id);
    const cursor = {
      id,
      chainId: config.arc.chainId,
      contract: contract.key,
      address: contract.address,
      lastBlock,
      updatedAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, cursor);
    else store.indexerCursors.push(cursor);
  });
}

function normalizeLog(contract: IndexedContract, log: {
  transactionHash?: `0x${string}` | null;
  logIndex?: number | null;
  blockNumber?: bigint | null;
  eventName?: string;
  args?: Record<string, unknown> | readonly unknown[];
}): IndexedChainEventRecord | null {
  if (!log.transactionHash || log.logIndex === undefined || log.logIndex === null || log.blockNumber === undefined || log.blockNumber === null) return null;
  const eventName = log.eventName ?? "Unknown";
  const args = stringifyArgs(log.args ?? {});
  const id = `${config.arc.chainId}:${log.transactionHash}:${Number(log.logIndex)}`;
  const base = {
    id,
    chainId: config.arc.chainId,
    contract: contract.key,
    event: eventName,
    address: contract.address,
    blockNumber: Number(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: Number(log.logIndex),
    args,
    createdAt: new Date().toISOString()
  };

  if (contract.key === "x402Ledger") {
    return {
      ...base,
      amountUsdc: usdc(args.grossAmount),
      feeUsdc: usdc(args.platformFee),
      actor: stringArg(args.payer ?? args.agentWallet),
      counterparty: stringArg(args.publisher)
    };
  }
  if (contract.key === "nexoraEscrow") {
    return {
      ...base,
      amountUsdc: usdc(args.amount ?? args.counterpartyAmount),
      feeUsdc: usdc(args.feeAmount),
      actor: stringArg(args.creator),
      counterparty: stringArg(args.counterparty)
    };
  }
  if (contract.key === "saveEarnVault") {
    return {
      ...base,
      amountUsdc: usdc(args.assets),
      feeUsdc: usdc(args.fee),
      actor: stringArg(args.user)
    };
  }
  if (contract.key === "yieldRouter") {
    return {
      ...base,
      amountUsdc: usdc(args.amount ?? args.withdrawn),
      actor: stringArg(args.recipient)
    };
  }
  if (contract.key === "policyRegistry") {
    return {
      ...base,
      amountUsdc: usdc(args.amount),
      actor: stringArg(args.agentWallet),
      counterparty: stringArg(args.recipient ?? args.operator)
    };
  }
  return base;
}

function stringifyArgs(args: Record<string, unknown> | readonly unknown[]) {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "bigint") output[key] = value.toString();
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) output[key] = value;
    else output[key] = String(value);
  }
  return output;
}

function usdc(value: unknown) {
  if (value === undefined || value === null) return undefined;
  try {
    return roundUsdc(Number(formatUnits(BigInt(String(value)), 6)));
  } catch {
    return undefined;
  }
}

function sumAmount(events: IndexedChainEventRecord[]) {
  return events.reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0);
}

function sumFee(events: IndexedChainEventRecord[]) {
  return events.reduce((sum, event) => sum + (event.feeUsdc ?? 0), 0);
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value : null;
}

function cursorId(contract: IndexedContract) {
  return `${config.arc.chainId}:${contract.key}:${contract.address.toLowerCase()}`;
}

function arcChain() {
  return {
    id: config.arc.chainId,
    name: "Arc Testnet",
    nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
    rpcUrls: {default: {http: [config.arc.rpcUrl]}}
  };
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function envInteger(key: string, fallback: number, min: number) {
  const parsed = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}
