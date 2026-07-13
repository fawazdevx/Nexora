import {createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseAbiItem, type Address} from "viem";

export type WalletRiskProviderStatus = "live" | "partial" | "not_configured" | "provider_error";

export type WalletRiskChainConfig = {
  key: string;
  name: string;
  chainId: number;
  rpcUrl?: string;
  explorerUrl?: string;
  usdcAddress?: string;
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  knownSpenders?: Array<{address: string; label: string}>;
  approvalHistoryStartBlock?: bigint | number;
  approvalLogChunkSize?: number;
  approvalScanBlocks?: number;
};

export type WalletApprovalSnapshot = {
  chainKey: string;
  chainName: string;
  chainId: number;
  token: "USDC";
  tokenAddress: string;
  owner: string;
  spender: string;
  spenderLabel: string | null;
  allowanceRaw: string;
  allowanceUsdc: number;
  latestApprovalRaw: string;
  latestApprovalUsdc: number;
  latestApprovalTxHash: string | null;
  latestApprovalBlock: number | null;
  firstApprovalTxHash: string | null;
  firstApprovalBlock: number | null;
  approvalEventCount: number;
  isUnlimited: boolean;
  active: boolean;
};

export type WalletApprovalChainSnapshot = {
  key: string;
  name: string;
  chainId: number;
  status: WalletRiskProviderStatus;
  live: boolean;
  nativeBalance: number | null;
  usdcBalance: number | null;
  transactionCount: number | null;
  scannedFromBlock: bigint | number | null;
  scannedToBlock: bigint | number | null;
  approvalCoverage: "full_history" | "partial_history" | "none";
  approvalLogQueries: number;
  approvalEventsScanned: number;
  approvals: WalletApprovalSnapshot[];
  errorMessage: string | null;
};

export type CounterpartyChainSnapshot = {
  key: string;
  name: string;
  chainId: number;
  status: WalletRiskProviderStatus;
  live: boolean;
  nativeBalance: number | null;
  usdcBalance: number | null;
  transactionCount: number | null;
  isContract: boolean | null;
  errorMessage: string | null;
};

export type CounterpartyLocalActivity = {
  settledPayments: number;
  failedPayments: number;
  publishedServices: number;
  lastSeenAt: string | null;
};

const APPROVAL_EVENT = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");
const DEFAULT_APPROVAL_LOG_CHUNK_BLOCKS = 100_000;
const MAX_UINT256 = (1n << 256n) - 1n;

type WalletRiskPublicClient = ReturnType<typeof publicClient>;
type WalletRiskClientFactory = (chain: WalletRiskChainConfig) => WalletRiskPublicClient;

export async function scanWalletApprovalExposure(wallet: string, options: {
  chains: WalletRiskChainConfig[];
  createClient?: WalletRiskClientFactory;
}) {
  const normalizedWallet = normalizeAddress(wallet);
  if (!normalizedWallet) {
    return normalizeWalletApprovalExposureReport({
      wallet,
      chains: []
    });
  }

  const clientFactory = options.createClient ?? publicClient;
  const chains = await Promise.all(options.chains.map((chain) => collectApprovalChainSnapshot(chain, normalizedWallet, clientFactory)));
  return normalizeWalletApprovalExposureReport({
    wallet: normalizedWallet,
    chains
  });
}

export async function screenCounterpartyWallet(input: {
  counterparty: string;
  chains: WalletRiskChainConfig[];
  localActivity?: Partial<CounterpartyLocalActivity> | null;
  complianceProviderConfigured?: boolean;
}) {
  const wallet = extractAddress(input.counterparty);
  if (!wallet) {
    return normalizeCounterpartyScreeningReport({
      counterparty: input.counterparty,
      wallet: null,
      chains: [],
      localActivity: normalizeLocalActivity(input.localActivity),
      complianceProviderConfigured: Boolean(input.complianceProviderConfigured)
    });
  }

  const chains = await Promise.all(input.chains.map((chain) => collectCounterpartyChainSnapshot(chain, wallet)));
  return normalizeCounterpartyScreeningReport({
    counterparty: input.counterparty,
    wallet,
    chains,
    localActivity: normalizeLocalActivity(input.localActivity),
    complianceProviderConfigured: Boolean(input.complianceProviderConfigured)
  });
}

export function normalizeWalletApprovalExposureReport(input: {
  wallet: string;
  chains: WalletApprovalChainSnapshot[];
}) {
  const wallet = normalizeAddress(input.wallet);
  const chains = input.chains.map((chain) => ({
    key: chain.key,
    name: chain.name,
    chainId: chain.chainId,
    status: chain.status,
    live: chain.live,
    nativeBalance: nullableRound(chain.nativeBalance),
    usdcBalance: nullableRound(chain.usdcBalance),
    transactionCount: chain.transactionCount,
    scannedFromBlock: numberOrNull(chain.scannedFromBlock),
    scannedToBlock: numberOrNull(chain.scannedToBlock),
    approvalCoverage: chain.approvalCoverage ?? "none",
    approvalLogQueries: safeNonNegativeInteger(chain.approvalLogQueries),
    approvalEventsScanned: safeNonNegativeInteger(chain.approvalEventsScanned),
    approvalsObserved: chain.approvals.length,
    activeApprovals: chain.approvals.filter((approval) => approval.active).length,
    errorMessage: chain.errorMessage
  }));
  const approvals = input.chains.flatMap((chain) => chain.approvals).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.isUnlimited !== b.isUnlimited) return a.isUnlimited ? -1 : 1;
    return b.allowanceUsdc - a.allowanceUsdc;
  });
  const activeApprovals = approvals.filter((approval) => approval.active);
  const unlimitedApprovals = activeApprovals.filter((approval) => approval.isUnlimited);
  const finiteExposureUsdc = round(
    activeApprovals
      .filter((approval) => !approval.isUnlimited)
      .reduce((sum, approval) => sum + safeNumber(approval.allowanceUsdc), 0),
    6
  );
  const live = chains.some((chain) => chain.live);
  const approvalStatus = aggregateStatus(input.chains);
  const fullHistoricalCoverage = input.chains.length > 0
    && input.chains.every((chain) => chain.status === "live" && chain.approvalCoverage === "full_history");
  const totalUsdcBalance = round(
    input.chains.reduce((sum, chain) => sum + safeNumber(chain.usdcBalance), 0),
    6
  );
  const transactionCount = input.chains.reduce((sum, chain) => sum + safeNumber(chain.transactionCount), 0);
  const riskLevel = !wallet || approvalStatus === "provider_error" || approvalStatus === "partial"
    ? "high"
    : unlimitedApprovals.length > 0
      ? "high"
      : activeApprovals.length > 0
        ? "medium"
        : live
          ? "low"
          : "review";

  return {
    status: wallet ? (approvalStatus === "provider_error" ? "provider_error" : "ok") : "invalid_input",
    decision: "manual_review",
    wallet: wallet ?? input.wallet,
    live,
    riskLevel,
    providerStatus: {
      approvals: approvalStatus,
      chainTelemetry: aggregateStatus(input.chains),
      coverage: fullHistoricalCoverage ? "full_historical_rpc_approval_logs_plus_current_allowance" : live ? "partial_rpc_approval_logs_plus_current_allowance_for_observed_spenders" : "none",
      note: live
        ? fullHistoricalCoverage
          ? "Nexora scanned full historical USDC Approval logs through configured RPCs and queried current allowance for every observed spender."
          : "At least one configured chain returned only partial approval history. Nexora did not infer wallet clearance for chains without full historical RPC coverage."
        : "No live RPC approval telemetry was available. Nexora did not infer wallet clearance."
    },
    metrics: {
      chainsScanned: chains.filter((chain) => chain.live).length,
      totalApprovalEvents: approvals.reduce((sum, approval) => sum + safeNonNegativeInteger(approval.approvalEventCount ?? 1), 0),
      totalActiveApprovals: activeApprovals.length,
      totalUnlimitedApprovals: unlimitedApprovals.length,
      transactionCount,
      totalUsdcBalance
    },
    exposure: {
      finiteExposureUsdc,
      unlimitedApprovals: unlimitedApprovals.length,
      activeSpenders: new Set(activeApprovals.map((approval) => approval.spender.toLowerCase())).size,
      chainsWithErrors: chains.filter((chain) => chain.status === "provider_error").map((chain) => chain.name)
    },
    chains,
    approvals,
    checks: wallet
      ? [
        "Wallet address format is valid.",
        live ? "At least one configured chain returned live wallet telemetry." : "No configured chain returned live wallet telemetry.",
        activeApprovals.length > 0 ? `${activeApprovals.length} active USDC approval(s) were observed from live chain data.` : "No active approvals were observed in the configured historical scan.",
        unlimitedApprovals.length > 0 ? `${unlimitedApprovals.length} unlimited approval(s) require revocation or explicit approval.` : "No unlimited approvals were observed for scanned spenders.",
        fullHistoricalCoverage ? "Configured live chains completed a full historical approval log scan." : "Do not treat missing approval events as clearance until every configured chain completes historical approval coverage."
      ]
      : [
        "Wallet address format is invalid or incomplete.",
        "Nexora did not run live allowance checks for this input."
      ],
    recommendedPolicy: {
      transactionCapUsdc: wallet ? 10 : 0,
      dailyLimitUsdc: wallet ? 50 : 0,
      weeklyLimitUsdc: wallet ? 150 : 0,
      requireOnchainPolicy: true,
      requireApprovalRevocation: unlimitedApprovals.length > 0,
      recipientAllowlist: wallet ? [wallet] : []
    },
    recommendations: [
      "Revoke unlimited approvals before funding an agent-operated wallet.",
      "Use exact allowances for x402 settlement and protocol spenders.",
      "Keep first production transactions low value until approval history is reviewed."
    ],
    summary: wallet
      ? live
        ? `Live wallet approval report found ${activeApprovals.length} active USDC approval(s) across ${chains.filter((chain) => chain.live).length} configured chain(s).`
        : "Wallet address is valid, but no live approval provider is configured or reachable."
      : "Invalid wallet input. Do not fund or allowlist this address."
  };
}

export function normalizeCounterpartyScreeningReport(input: {
  counterparty: string;
  wallet: string | null;
  chains: CounterpartyChainSnapshot[];
  localActivity?: Partial<CounterpartyLocalActivity> | null;
  complianceProviderConfigured?: boolean;
}) {
  const wallet = input.wallet ? normalizeAddress(input.wallet) : extractAddress(input.counterparty);
  const localActivity = normalizeLocalActivity(input.localActivity);
  const chains = input.chains.map((chain) => ({
    key: chain.key,
    name: chain.name,
    chainId: chain.chainId,
    status: chain.status,
    live: chain.live,
    nativeBalance: nullableRound(chain.nativeBalance),
    usdcBalance: nullableRound(chain.usdcBalance),
    transactionCount: chain.transactionCount,
    isContract: chain.isContract,
    errorMessage: chain.errorMessage
  }));
  const live = chains.some((chain) => chain.live);
  const transactionCount = input.chains.reduce((sum, chain) => sum + safeNumber(chain.transactionCount), 0);
  const totalUsdcBalance = round(input.chains.reduce((sum, chain) => sum + safeNumber(chain.usdcBalance), 0), 6);
  const contractChains = chains.filter((chain) => chain.isContract).map((chain) => chain.name);
  const chainTelemetry = aggregateStatus(input.chains);
  const riskLevel = !wallet
    ? "high"
    : !input.complianceProviderConfigured
      ? "manual_review"
      : contractChains.length > 0 || localActivity.failedPayments > 0
        ? "medium"
        : "review";

  return {
    status: wallet ? (chainTelemetry === "provider_error" ? "provider_error" : "ok") : "invalid_input",
    decision: "manual_review",
    counterparty: input.counterparty,
    wallet,
    live,
    riskLevel,
    providerStatus: {
      sanctions: input.complianceProviderConfigured ? "configured" : "not_configured",
      chainTelemetry,
      localActivity: "live",
      note: input.complianceProviderConfigured
        ? "A KYT provider is configured, but this report still requires provider result storage before automatic approval."
        : "No sanctions/KYT provider is configured. Nexora returns live wallet telemetry only and keeps the compliance decision in manual review."
    },
    metrics: {
      chainsScanned: chains.filter((chain) => chain.live).length,
      transactionCount,
      totalUsdcBalance,
      contractChains: contractChains.length,
      settledPayments: localActivity.settledPayments,
      failedPayments: localActivity.failedPayments,
      publishedServices: localActivity.publishedServices
    },
    localActivity,
    chains,
    checks: wallet
      ? [
        "Wallet address format is valid.",
        live ? "At least one configured chain returned live counterparty telemetry." : "No configured chain returned live counterparty telemetry.",
        input.complianceProviderConfigured ? "Compliance provider configuration was detected." : "Sanctions/KYT provider is not configured; do not treat this as legal clearance.",
        contractChains.length > 0 ? `Counterparty is a contract on ${contractChains.join(", ")}.` : "No contract bytecode was observed on scanned chains.",
        localActivity.settledPayments > 0 ? "Nexora local settlement history exists for this counterparty." : "No settled Nexora marketplace history was found for this counterparty."
      ]
      : [
        "No valid wallet address was detected.",
        "Screen business identity and payout wallet separately before payment."
      ],
    recommendations: [
      "Require manual approval for the first payment to this counterparty.",
      "Attach KYT provider references before marking the counterparty cleared.",
      "Use low transaction caps until both chain telemetry and local payment history are reviewed."
    ],
    summary: wallet
      ? "Counterparty wallet screening completed with live chain telemetry where configured; compliance remains manual review until KYT is configured."
      : "No counterparty wallet was available for live screening."
  };
}

async function collectApprovalChainSnapshot(
  chain: WalletRiskChainConfig,
  wallet: Address,
  createClient: WalletRiskClientFactory = publicClient
): Promise<WalletApprovalChainSnapshot> {
  const usdcAddress = normalizeAddress(chain.usdcAddress);
  if (!chain.rpcUrl?.trim() || !usdcAddress) {
    return approvalChainUnavailable(chain, "RPC URL or USDC address is not configured.");
  }

  const client = createClient(chain);
  try {
    const [latestBlock, nativeBalanceRaw, usdcBalanceRaw, transactionCount] = await Promise.all([
      client.getBlockNumber(),
      client.getBalance({address: wallet}),
      client.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet]
      }),
      client.getTransactionCount({address: wallet})
    ]);
    const fromBlock = approvalHistoryStartBlock(chain);
    if (fromBlock > latestBlock) {
      return {
        key: chain.key,
        name: chain.name,
        chainId: chain.chainId,
        status: "partial",
        live: true,
        nativeBalance: Number(formatUnits(nativeBalanceRaw, chain.nativeCurrency?.decimals ?? 18)),
        usdcBalance: usdcAmount(usdcBalanceRaw),
        transactionCount,
        scannedFromBlock: null,
        scannedToBlock: latestBlock,
        approvalCoverage: "none",
        approvalLogQueries: 0,
        approvalEventsScanned: 0,
        approvals: [],
        errorMessage: `Approval history start block ${fromBlock.toString()} is after latest block ${latestBlock.toString()}.`
      };
    }

    const scan = await scanHistoricalApprovalLogs(client, {
      usdcAddress,
      owner: wallet,
      fromBlock,
      toBlock: latestBlock,
      chunkSize: approvalLogChunkSize(chain)
    });
    const approvalsBySpender = approvalsBySpenderFromLogs(scan.logs);
    for (const spender of chain.knownSpenders ?? []) {
      const address = normalizeAddress(spender.address);
      if (address && !approvalsBySpender.has(address.toLowerCase())) {
        approvalsBySpender.set(address.toLowerCase(), emptyObservedApproval(address));
      }
    }

    const approvals = (await Promise.all([...approvalsBySpender.values()].map(async (approval) => {
      const allowance = await client.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, approval.spender]
      });
      return {
        chainKey: chain.key,
        chainName: chain.name,
        chainId: chain.chainId,
        token: "USDC" as const,
        tokenAddress: usdcAddress,
        owner: wallet,
        spender: approval.spender,
        spenderLabel: spenderLabel(chain, approval.spender),
        allowanceRaw: allowance.toString(),
        allowanceUsdc: usdcAmount(allowance),
        latestApprovalRaw: approval.value.toString(),
        latestApprovalUsdc: usdcAmount(approval.value),
        latestApprovalTxHash: approval.latestTxHash,
        latestApprovalBlock: numberOrNull(approval.latestBlockNumber),
        firstApprovalTxHash: approval.firstTxHash,
        firstApprovalBlock: numberOrNull(approval.firstBlockNumber),
        approvalEventCount: approval.eventCount,
        isUnlimited: isUnlimitedAllowance(allowance),
        active: allowance > 0n
      };
    }))).filter((approval) => approval.approvalEventCount > 0 || approval.active);

    return {
      key: chain.key,
      name: chain.name,
      chainId: chain.chainId,
      status: "live",
      live: true,
      nativeBalance: Number(formatUnits(nativeBalanceRaw, chain.nativeCurrency?.decimals ?? 18)),
      usdcBalance: usdcAmount(usdcBalanceRaw),
      transactionCount,
      scannedFromBlock: fromBlock,
      scannedToBlock: latestBlock,
      approvalCoverage: "full_history",
      approvalLogQueries: scan.queryCount,
      approvalEventsScanned: scan.logs.length,
      approvals,
      errorMessage: null
    };
  } catch (error) {
    return {
      key: chain.key,
      name: chain.name,
      chainId: chain.chainId,
      status: "provider_error",
      live: false,
      nativeBalance: null,
      usdcBalance: null,
      transactionCount: null,
      scannedFromBlock: null,
      scannedToBlock: null,
      approvalCoverage: "none",
      approvalLogQueries: 0,
      approvalEventsScanned: 0,
      approvals: [],
      errorMessage: error instanceof Error ? error.message : "RPC approval scan failed"
    };
  }
}

async function collectCounterpartyChainSnapshot(chain: WalletRiskChainConfig, wallet: Address): Promise<CounterpartyChainSnapshot> {
  const usdcAddress = normalizeAddress(chain.usdcAddress);
  if (!chain.rpcUrl?.trim() || !usdcAddress) {
    return counterpartyChainUnavailable(chain, "RPC URL or USDC address is not configured.");
  }

  const client = publicClient(chain);
  try {
    const [nativeBalanceRaw, usdcBalanceRaw, transactionCount, code] = await Promise.all([
      client.getBalance({address: wallet}),
      client.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet]
      }),
      client.getTransactionCount({address: wallet}),
      client.getCode({address: wallet})
    ]);
    return {
      key: chain.key,
      name: chain.name,
      chainId: chain.chainId,
      status: "live",
      live: true,
      nativeBalance: Number(formatUnits(nativeBalanceRaw, chain.nativeCurrency?.decimals ?? 18)),
      usdcBalance: usdcAmount(usdcBalanceRaw),
      transactionCount,
      isContract: Boolean(code && code !== "0x"),
      errorMessage: null
    };
  } catch (error) {
    return {
      key: chain.key,
      name: chain.name,
      chainId: chain.chainId,
      status: "provider_error",
      live: false,
      nativeBalance: null,
      usdcBalance: null,
      transactionCount: null,
      isContract: null,
      errorMessage: error instanceof Error ? error.message : "RPC counterparty screen failed"
    };
  }
}

function publicClient(chain: WalletRiskChainConfig) {
  return createPublicClient({
    chain: {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency ?? {name: "Ether", symbol: "ETH", decimals: 18},
      rpcUrls: {default: {http: [chain.rpcUrl ?? ""]}}
    },
    transport: http(chain.rpcUrl, {timeout: 18_000})
  });
}

function approvalChainUnavailable(chain: WalletRiskChainConfig, message: string): WalletApprovalChainSnapshot {
  return {
    key: chain.key,
    name: chain.name,
    chainId: chain.chainId,
    status: "not_configured",
    live: false,
    nativeBalance: null,
    usdcBalance: null,
    transactionCount: null,
    scannedFromBlock: null,
    scannedToBlock: null,
    approvalCoverage: "none",
    approvalLogQueries: 0,
    approvalEventsScanned: 0,
    approvals: [],
    errorMessage: message
  };
}

function counterpartyChainUnavailable(chain: WalletRiskChainConfig, message: string): CounterpartyChainSnapshot {
  return {
    key: chain.key,
    name: chain.name,
    chainId: chain.chainId,
    status: "not_configured",
    live: false,
    nativeBalance: null,
    usdcBalance: null,
    transactionCount: null,
    isContract: null,
    errorMessage: message
  };
}

function aggregateStatus(chains: Array<{status: WalletRiskProviderStatus; live: boolean}>): WalletRiskProviderStatus {
  const live = chains.filter((chain) => chain.status === "live" || chain.live).length;
  const errors = chains.filter((chain) => chain.status === "provider_error").length;
  const partials = chains.filter((chain) => chain.status === "partial").length;
  const notConfigured = chains.filter((chain) => chain.status === "not_configured").length;
  if (live > 0 && (errors > 0 || partials > 0 || notConfigured > 0)) return "partial";
  if (live > 0) return "live";
  if (partials > 0) return "partial";
  if (errors > 0) return "provider_error";
  return "not_configured";
}

type ApprovalLog = {
  args?: {
    spender?: Address;
    value?: bigint;
  };
  transactionHash?: string | null;
  blockNumber?: bigint | null;
  logIndex?: number | string | null;
};

type ObservedApproval = {
  spender: Address;
  value: bigint;
  latestTxHash: string | null;
  latestBlockNumber: bigint | null;
  latestLogIndex: number;
  firstTxHash: string | null;
  firstBlockNumber: bigint | null;
  firstLogIndex: number;
  eventCount: number;
};

async function scanHistoricalApprovalLogs(
  client: WalletRiskPublicClient,
  input: {
    usdcAddress: Address;
    owner: Address;
    fromBlock: bigint;
    toBlock: bigint;
    chunkSize: bigint;
  }
) {
  const logs: ApprovalLog[] = [];
  let queryCount = 0;
  let cursor = input.fromBlock;
  let chunkSize = input.chunkSize > 0n ? input.chunkSize : BigInt(DEFAULT_APPROVAL_LOG_CHUNK_BLOCKS);

  while (cursor <= input.toBlock) {
    const toBlock = minBigInt(input.toBlock, cursor + chunkSize - 1n);
    try {
      const chunkLogs = await client.getLogs({
        address: input.usdcAddress,
        event: APPROVAL_EVENT,
        args: {owner: input.owner},
        fromBlock: cursor,
        toBlock
      });
      logs.push(...chunkLogs as ApprovalLog[]);
      queryCount += 1;
      cursor = toBlock + 1n;
    } catch (error) {
      if (chunkSize > 1n && isLogRangeTooLargeError(error)) {
        chunkSize = maxBigInt(1n, chunkSize / 2n);
        continue;
      }
      throw error;
    }
  }

  return {logs, queryCount};
}

function approvalsBySpenderFromLogs(logs: ApprovalLog[]) {
  const approvalsBySpender = new Map<string, ObservedApproval>();
  for (const log of logs) {
    const spender = normalizeAddress(log.args?.spender);
    const value = log.args?.value;
    if (!spender || typeof value !== "bigint") continue;

    const blockNumber = typeof log.blockNumber === "bigint" ? log.blockNumber : null;
    const logIndex = safeNonNegativeInteger(log.logIndex);
    const txHash = log.transactionHash ?? null;
    const key = spender.toLowerCase();
    const existing = approvalsBySpender.get(key);
    if (!existing) {
      approvalsBySpender.set(key, {
        spender,
        value,
        latestTxHash: txHash,
        latestBlockNumber: blockNumber,
        latestLogIndex: logIndex,
        firstTxHash: txHash,
        firstBlockNumber: blockNumber,
        firstLogIndex: logIndex,
        eventCount: 1
      });
      continue;
    }

    existing.eventCount += 1;
    if (isEarlierApproval(blockNumber, logIndex, existing.firstBlockNumber, existing.firstLogIndex)) {
      existing.firstTxHash = txHash;
      existing.firstBlockNumber = blockNumber;
      existing.firstLogIndex = logIndex;
    }
    if (isLaterApproval(blockNumber, logIndex, existing.latestBlockNumber, existing.latestLogIndex)) {
      existing.value = value;
      existing.latestTxHash = txHash;
      existing.latestBlockNumber = blockNumber;
      existing.latestLogIndex = logIndex;
    }
  }

  return approvalsBySpender;
}

function emptyObservedApproval(spender: Address): ObservedApproval {
  return {
    spender,
    value: 0n,
    latestTxHash: null,
    latestBlockNumber: null,
    latestLogIndex: 0,
    firstTxHash: null,
    firstBlockNumber: null,
    firstLogIndex: 0,
    eventCount: 0
  };
}

function approvalHistoryStartBlock(chain: WalletRiskChainConfig) {
  return safeNonNegativeBigInt(chain.approvalHistoryStartBlock, 0n);
}

function approvalLogChunkSize(chain: WalletRiskChainConfig) {
  return BigInt(safePositiveInteger(chain.approvalLogChunkSize ?? chain.approvalScanBlocks, DEFAULT_APPROVAL_LOG_CHUNK_BLOCKS));
}

function isEarlierApproval(leftBlock: bigint | null, leftIndex: number, rightBlock: bigint | null, rightIndex: number) {
  if (leftBlock === null) return false;
  if (rightBlock === null) return true;
  if (leftBlock !== rightBlock) return leftBlock < rightBlock;
  return leftIndex < rightIndex;
}

function isLaterApproval(leftBlock: bigint | null, leftIndex: number, rightBlock: bigint | null, rightIndex: number) {
  if (leftBlock === null) return false;
  if (rightBlock === null) return true;
  if (leftBlock !== rightBlock) return leftBlock > rightBlock;
  return leftIndex >= rightIndex;
}

function isLogRangeTooLargeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /block range|range is too|too many|more than|response size|query returned|limit exceeded|-32005/i.test(message);
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function normalizeLocalActivity(input?: Partial<CounterpartyLocalActivity> | null): CounterpartyLocalActivity {
  return {
    settledPayments: safeNonNegativeInteger(input?.settledPayments),
    failedPayments: safeNonNegativeInteger(input?.failedPayments),
    publishedServices: safeNonNegativeInteger(input?.publishedServices),
    lastSeenAt: typeof input?.lastSeenAt === "string" && input.lastSeenAt.trim() ? input.lastSeenAt : null
  };
}

function extractAddress(value: string) {
  const match = value.match(/0x[a-fA-F0-9]{40}/);
  return normalizeAddress(match?.[0]);
}

function normalizeAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

function spenderLabel(chain: WalletRiskChainConfig, spender: string) {
  const match = chain.knownSpenders?.find((item) => normalizeAddress(item.address)?.toLowerCase() === spender.toLowerCase());
  return match?.label ?? null;
}

function usdcAmount(value: bigint) {
  return round(Number(formatUnits(value, 6)), 6);
}

function isUnlimitedAllowance(value: bigint) {
  return value >= MAX_UINT256 / 2n;
}

function numberOrNull(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : BigInt(Number.MAX_SAFE_INTEGER));
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableRound(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? round(value, 6) : null;
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeNonNegativeInteger(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function safePositiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function safeNonNegativeBigInt(value: unknown, fallback: bigint) {
  if (typeof value === "bigint") return value >= 0n ? value : fallback;
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) && numeric >= 0 ? BigInt(Math.trunc(numeric)) : fallback;
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
