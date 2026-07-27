import {getService} from "../marketplace/services.js";
import {createPublicClient, http, parseAbi, parseEventLogs} from "viem";
import {config} from "../config.js";
import {ARC_MEMO_CONTRACT, arcMemoAbi, attachSettlementMemoContext, buildX402PaymentMemo, normalizeMemo, type NexoraMemoScope, type NexoraStructuredMemo} from "../memos.js";
import {dispatchNotification} from "../notifications.js";
import {insertPayment, isVisibleAgent, pushNotification, readStore, RequestHashConflictError, updatePaymentById, type PaymentRecord, type ServiceRecord} from "../store.js";
import {evaluateAgentPolicy} from "../policies/engine.js";
import {evaluateAutomationRecipesForOperator} from "../automation/recipes.js";

type AuthorizeInput = {
  serviceId: string;
  payer: string;
  requestHash: string;
  units: number;
  agentId?: string | null;
  privacyScope?: NexoraMemoScope;
  // Opt-in: when a request is blocked only because it is too large, retry once
  // at the policy-suggested unit count instead of failing. Money behavior, so
  // it is off unless the caller explicitly asks for it.
  autoRetry?: boolean;
};

// Thrown when a policy blocks an authorization. Carries the structured
// remediation so the HTTP layer can return it to the agent verbatim.
export class PolicyBlockedError extends Error {
  readonly status = 402;
  constructor(
    message: string,
    readonly paymentId: string,
    readonly remediation: import("../policies/engine.js").PolicyRemediation | undefined,
    readonly autoRetried: boolean
  ) {
    super(message);
    this.name = "PolicyBlockedError";
  }
}

type PaymentRequiredInput = {
  serviceId: string;
  amountUsdc: number;
  resource: string;
  payTo: string;
};

type SettleInput = {
  authorizationId: string;
  txHash?: string;
  memo?: NexoraStructuredMemo | null;
  targetContract?: string | null;
  callDataHash?: string | null;
  memoIndex?: number | null;
};

const x402LedgerSettlementAbi = parseAbi([
  "event RequestSettled(uint256 indexed serviceId,bytes32 indexed requestHash,address indexed payer,address publisher,uint256 units,uint256 grossAmount,uint256 platformFee)",
  "event AgentRequestSettled(uint256 indexed serviceId,bytes32 indexed requestHash,address indexed agentWallet,address operator,address publisher,uint256 units,uint256 grossAmount,uint256 platformFee)"
]);

const x402LedgerReadAbi = parseAbi([
  "function treasury() view returns (address)"
]);

const erc20TransferAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)"
]);

// Per-chain settlement context. A published service records the EVM chain its
// ledger lives on (settlementChainId); each chain has its own ledger + USDC and
// an independent serviceId counter, so verification must run against the right
// chain. Treasury is shared across Nexora's deployments (verified on-chain), but
// resolved per-chain here so a future split treasury stays correct. Only legacy
// records with a null chain default to Arc; unknown chain IDs fail closed.
export type SettlementChainContext = {
  chainId: number;
  label: string;
  rpcUrl: string;
  usdc: string;
  ledger: string;
  treasury: string;
  // Only Arc carries the on-chain Memo contract; memo-backed settlement is
  // Arc-only and skipped elsewhere.
  supportsMemo: boolean;
};

export function settlementContextForChainId(chainId: number | null | undefined): SettlementChainContext {
  const treasury = config.contracts.treasury;
  if (chainId === null || chainId === undefined || chainId === config.arc.chainId) {
    return {chainId: config.arc.chainId, label: "Arc Testnet", rpcUrl: config.arc.rpcUrl, usdc: config.contracts.usdc, ledger: config.contracts.x402Ledger, treasury, supportsMemo: true};
  }
  if (chainId === config.base.sepoliaChainId) {
    return {chainId: config.base.sepoliaChainId, label: "Base Sepolia", rpcUrl: config.base.sepoliaRpcUrl, usdc: config.base.sepoliaUsdc, ledger: config.base.sepoliaX402Ledger, treasury, supportsMemo: false};
  }
  if (chainId === config.base.mainnetChainId) {
    return {chainId: config.base.mainnetChainId, label: "Base", rpcUrl: config.base.mainnetRpcUrl, usdc: config.base.mainnetUsdc, ledger: config.base.mainnetX402Ledger, treasury, supportsMemo: false};
  }
  if (chainId === config.arbitrum.sepoliaChainId) {
    return {chainId: config.arbitrum.sepoliaChainId, label: "Arbitrum Sepolia", rpcUrl: config.arbitrum.sepoliaRpcUrl, usdc: config.arbitrum.sepoliaUsdc, ledger: config.arbitrum.sepoliaX402Ledger, treasury, supportsMemo: false};
  }
  if (chainId === config.arbitrum.oneChainId) {
    return {chainId: config.arbitrum.oneChainId, label: "Arbitrum One", rpcUrl: config.arbitrum.oneRpcUrl, usdc: config.arbitrum.oneUsdc, ledger: config.arbitrum.oneX402Ledger, treasury, supportsMemo: false};
  }
  throw new Error(`Chain ${chainId} is not enabled for Nexora marketplace settlement`);
}

type VerifiedSettlement = {
  ledger: {
    grossAmountUsdc: number;
    platformFeeUsdc: number;
    publisherNetUsdc: number;
  };
  memo: {
    targetContract: string;
    callDataHash: string;
    memoIndex: number;
  } | null;
};

export function paymentRequired(input: PaymentRequiredInput) {
  return {
    status: 402,
    headers: {
      "x-accept-payment": "x402"
    },
    body: {
      x402Version: 1,
      scheme: "exact",
      network: "arc-testnet",
      asset: "USDC",
      amount: input.amountUsdc,
      payTo: input.payTo,
      resource: input.resource,
      serviceId: input.serviceId
    }
  };
}

export async function authorizeX402(input: AuthorizeInput) {
  const service = await getService(input.serviceId);
  if (!service) throw new Error("service not found");
  if (!service.active) throw new Error("service is inactive");
  await assertLedgerTreasuryMatchesConfig(settlementContextForChainId(service.settlementChainId));
  const store = await readStore();
  // Fast-fail on an already-used request hash. This is a best-effort early
  // check; the authoritative one runs inside the write transaction below, since
  // this read happens before async work (ledger check, policy eval) and cannot
  // guard against a concurrent authorization of the same hash on its own.
  if (store.payments.some((payment) => payment.requestHash === input.requestHash)) {
    throw new Error("request hash has already been used");
  }
  const agent = input.agentId
    ? store.agents.find((item) => isVisibleAgent(item) && item.id === input.agentId)
    : store.agents.find((item) => isVisibleAgent(item) && item.operatorAddress.toLowerCase() === input.payer.toLowerCase());
  const agentWallet = agentWalletAddressForService(agent, service);

  let effectiveUnits = input.units;
  let autoRetried = false;
  let policyCheck = evaluateAgentPolicy({agent, service, units: effectiveUnits, payments: store.payments});

  // Opt-in auto-retry: if the only problem is size and the policy told us a
  // compliant unit count, retry once at that count before giving up.
  if (
    !policyCheck.allowed
    && input.autoRetry
    && policyCheck.remediation?.retryable
    && (policyCheck.remediation.suggestedMaxUnits ?? 0) >= 1
    && (policyCheck.remediation.suggestedMaxUnits ?? 0) < effectiveUnits
  ) {
    const retryUnits = policyCheck.remediation.suggestedMaxUnits as number;
    const retryCheck = evaluateAgentPolicy({agent, service, units: retryUnits, payments: store.payments});
    if (retryCheck.allowed) {
      effectiveUnits = retryUnits;
      autoRetried = true;
      policyCheck = retryCheck;
    }
  }

  if (!policyCheck.allowed) {
    const failedAuthorizationId = crypto.randomUUID();
    const failedMemo = buildX402PaymentMemo({
      authorizationId: failedAuthorizationId,
      payer: input.payer,
      service,
      agent,
      requestHash: input.requestHash,
      units: input.units,
      amountUsdc: service.pricePerUnitUsdc * input.units,
      policyMode: "blocked",
      privacyScope: input.privacyScope ?? "selective"
    });
    const failedPayment = {
      id: crypto.randomUUID(),
      authorizationId: failedAuthorizationId,
      serviceId: service.id,
      serviceName: service.name,
      payer: input.payer,
      agentId: agent?.id ?? null,
      agentWallet,
      publisherAddress: service.publisherAddress,
      amountUsdc: service.pricePerUnitUsdc * input.units,
      grossAmountUsdc: service.pricePerUnitUsdc * input.units,
      platformFeeUsdc: 0,
      publisherNetUsdc: 0,
      facilitatorFeeBps: service.manifest.platformFeeBps,
      units: input.units,
      requestHash: input.requestHash,
      status: "policy_blocked" as const,
      policyReason: policyCheck.reason,
      remediation: policyCheck.remediation ?? null,
      memo: failedMemo,
      txHash: null,
      createdAt: new Date().toISOString(),
      settledAt: null
    };
    await insertPayment(failedPayment);
    await evaluateAutomationRecipesForOperator(input.payer).catch(() => undefined);
    throw new PolicyBlockedError(policyCheck.reason ?? "policy blocked this payment", failedPayment.id, policyCheck.remediation, false);
  }

  const authorizationId = crypto.randomUUID();
  const grossAmountUsdc = service.pricePerUnitUsdc * effectiveUnits;
  const platformFeeUsdc = roundUsdc((grossAmountUsdc * service.manifest.platformFeeBps) / 10_000);
  const createdAt = new Date().toISOString();
  const memo = buildX402PaymentMemo({
    authorizationId,
    payer: input.payer,
    service,
    agent,
    requestHash: input.requestHash,
    units: effectiveUnits,
    amountUsdc: grossAmountUsdc,
    policyMode: "auto",
    privacyScope: input.privacyScope ?? "selective",
    createdAt
  });
  const payment = {
    id: authorizationId,
    authorizationId,
    serviceId: service.id,
    serviceName: service.name,
    payer: input.payer,
    agentId: agent?.id ?? null,
    agentWallet,
    publisherAddress: service.publisherAddress,
    amountUsdc: grossAmountUsdc,
    grossAmountUsdc,
    platformFeeUsdc,
    publisherNetUsdc: roundUsdc(grossAmountUsdc - platformFeeUsdc),
    facilitatorFeeBps: service.manifest.platformFeeBps,
    units: effectiveUnits,
    requestHash: input.requestHash,
    status: "authorized" as const,
    policyReason: null,
    memo,
    txHash: null,
    createdAt
  };

  // Authoritative replay guard. insertPayment enforces the active-only
  // request-hash uniqueness atomically — via the partial unique index in DB
  // mode, or under the blob lock in file mode — closing the check-then-act
  // race that the early read above cannot. A concurrent authorization of the
  // same request hash that already committed is rejected here. Notifications
  // are written in the same transaction as the payment insert.
  try {
    await insertPayment(payment, (store) => {
      pushNotification(store, {
        operatorAddress: input.payer,
        title: "Payment authorized",
        detail: `${payment.amountUsdc} USDC for ${service.name}`,
        kind: "payment"
      });
      pushNotification(store, {
        operatorAddress: service.publisherAddress,
        title: "API purchase authorized",
        detail: `${payment.amountUsdc} USDC for ${service.name}`,
        kind: "payment"
      });
    });
  } catch (error) {
    if (error instanceof RequestHashConflictError) {
      throw new Error("request hash has already been used");
    }
    throw error;
  }

  return {
    authorizationId,
    paymentRequired: false,
    status: "authorized",
    autoRetried,
    requestedUnits: input.units,
    units: effectiveUnits,
    settlement: {
      asset: "USDC",
      network: settlementContextForChainId(service.settlementChainId).label,
      chainId: settlementContextForChainId(service.settlementChainId).chainId,
      mode: "x402",
      amountUsdc: payment.amountUsdc,
      platformFeeUsdc,
      publisherNetUsdc: payment.publisherNetUsdc,
      payTo: service.publisherAddress,
      chainServiceId: service.chainServiceId,
      contractAction: "X402FacilitatorLedger.settleRequest",
      memo
    }
  };
}

export async function settleX402(input: SettleInput) {
  const store = await readStore();
  const existingPayment = store.payments.find((entry) => entry.authorizationId === input.authorizationId || entry.id === input.authorizationId);
  if (!existingPayment) {
    return {status: "missing_authorization"};
  }

  const existingMemo = normalizeMemo(existingPayment.memo);
  const suppliedMemo = normalizeMemo(input.memo);
  const selectedMemo = suppliedMemo ?? existingMemo;
  if (suppliedMemo && existingMemo && suppliedMemo.memoId.toLowerCase() !== existingMemo.memoId.toLowerCase()) {
    throw new Error("settlement memo does not match authorization memo");
  }

  const service = await getService(existingPayment.serviceId);
  if (!service && existingPayment.status !== "settled") throw new Error("settlement service not found");
  const verifiedSettlement = existingPayment.status === "authorized" && service
    ? await verifySettlementReceipt({input, payment: existingPayment, service, memo: selectedMemo})
    : null;

  const result = await updatePaymentById(
    (entry) => entry.authorizationId === input.authorizationId || entry.id === input.authorizationId,
    (item, store) => {
    if (item.status === "settled") return {payment: item, notifications: []};
    if (item.status !== "authorized") throw new Error("payment is not authorized for settlement");
    if (input.memoIndex !== undefined && input.memoIndex !== null) {
      if (!input.txHash) throw new Error("memo-backed settlement requires a transaction hash");
      if (!input.targetContract) throw new Error("memo-backed settlement requires target contract");
      if (!input.callDataHash) throw new Error("memo-backed settlement requires callDataHash");
      if (selectedMemo?.arc.memoContract.toLowerCase() !== ARC_MEMO_CONTRACT.toLowerCase()) {
        throw new Error("unsupported memo contract");
      }
    }
    if (verifiedSettlement?.ledger) {
      item.amountUsdc = verifiedSettlement.ledger.grossAmountUsdc;
      item.grossAmountUsdc = verifiedSettlement.ledger.grossAmountUsdc;
      item.platformFeeUsdc = verifiedSettlement.ledger.platformFeeUsdc;
      item.publisherNetUsdc = verifiedSettlement.ledger.publisherNetUsdc;
    }
    item.status = "settled";
    item.txHash = input.txHash ?? null;
    item.memo = attachSettlementMemoContext({
      memo: selectedMemo,
      txHash: input.txHash ?? null,
      targetContract: verifiedSettlement?.memo?.targetContract ?? input.targetContract ?? null,
      callDataHash: verifiedSettlement?.memo?.callDataHash ?? input.callDataHash ?? null,
      memoIndex: verifiedSettlement?.memo?.memoIndex ?? input.memoIndex ?? null
    });
    item.settledAt = new Date().toISOString();
    const payerNotification = pushNotification(store, {
      operatorAddress: item.payer,
      title: "Payment settled",
      detail: `${item.amountUsdc} USDC paid for ${item.serviceName}`,
      kind: "payment",
      txHash: item.txHash,
      receiptId: item.id,
      actionHref: `/receipts/${encodeURIComponent(item.id)}`
    });
    const publisherNotification = pushNotification(store, {
      operatorAddress: item.publisherAddress,
      title: "Revenue received",
      detail: `${item.publisherNetUsdc ?? item.amountUsdc} USDC net from ${item.serviceName}`,
      kind: "payment",
      txHash: item.txHash,
      receiptId: item.id,
      actionHref: `/receipts/${encodeURIComponent(item.id)}`
    });
    return {payment: item, notifications: [payerNotification, publisherNotification]};
  });

  if (!result) {
    return {status: "missing_authorization"};
  }

  for (const notification of result.notifications) {
    await dispatchNotification({notification, event: "paymentReceipts", receiptId: result.payment.id}).catch(() => undefined);
  }
  await evaluateAutomationRecipesForOperator(result.payment.payer).catch(() => undefined);

  return {
    authorizationId: input.authorizationId,
    status: "settled",
    txHash: result.payment.txHash ?? null,
    memo: result.payment.memo ?? null,
    ledgerAction: "call X402FacilitatorLedger.settleRequest",
    facilitatorPrivateKeyConfigured: Boolean(process.env.FACILITATOR_PRIVATE_KEY)
  };
}

async function verifySettlementReceipt(input: {
  input: SettleInput;
  payment: PaymentRecord;
  service: ServiceRecord;
  memo: NexoraStructuredMemo | null;
}): Promise<VerifiedSettlement | null> {
  const context = settlementContextForChainId(input.service.settlementChainId);
  if (!input.input.txHash) {
    if (input.service.chainServiceId) throw new Error(`on-chain x402 settlement requires a ${context.label} transaction hash`);
    if (input.input.memoIndex !== undefined && input.input.memoIndex !== null) throw new Error("memo-backed settlement requires a transaction hash");
    return null;
  }
  if (!input.service.chainServiceId) throw new Error("off-chain x402 settlement cannot attach a transaction hash");

  const receipt = await settlementPublicClient(context).getTransactionReceipt({hash: input.input.txHash as `0x${string}`});
  if (receipt.status !== "success") throw new Error("x402 settlement transaction reverted");
  const ledger = verifyLedgerSettlementEvent({receipt, payment: input.payment, service: input.service, context});
  // Memo-backed settlement is Arc-only. On chains without the Memo contract we
  // skip memo verification rather than fail — the ledger split is what carries
  // the fee, and memos are an Arc-specific receipt feature.
  const memo = context.supportsMemo
    ? verifyMemoSettlementEvent({
        receipt,
        input: input.input,
        payment: input.payment,
        memo: input.memo
      })
    : null;
  return {ledger, memo};
}

function verifyMemoSettlementEvent(input: {
  receipt: Awaited<ReturnType<ReturnType<typeof settlementPublicClient>["getTransactionReceipt"]>>;
  input: SettleInput;
  payment: PaymentRecord;
  memo: NexoraStructuredMemo | null;
}) {
  if (input.input.memoIndex === undefined || input.input.memoIndex === null) return null;
  if (!input.memo || !input.input.txHash) throw new Error("memo-backed settlement requires memo and txHash");
  const logs = parseEventLogs({
    abi: arcMemoAbi,
    eventName: "Memo",
    logs: input.receipt.logs
  }).filter((log) => (
    log.address.toLowerCase() === ARC_MEMO_CONTRACT.toLowerCase()
    && log.args.memoId?.toLowerCase() === input.memo?.memoId.toLowerCase()
  ));
  const match = logs.find((log) => Number(log.args.memoIndex) === input.input.memoIndex) ?? logs[logs.length - 1];
  if (!match) throw new Error("memo-backed settlement event not found");
  if (input.input.targetContract && match.args.target.toLowerCase() !== input.input.targetContract.toLowerCase()) {
    throw new Error("memo-backed settlement target mismatch");
  }
  if (input.input.callDataHash && match.args.callDataHash.toLowerCase() !== input.input.callDataHash.toLowerCase()) {
    throw new Error("memo-backed settlement calldata mismatch");
  }
  const expectedSenders = [input.payment.payer, input.payment.agentWallet].filter((value): value is string => Boolean(value));
  if (expectedSenders.length > 0 && !expectedSenders.some((sender) => sender.toLowerCase() === match.args.sender.toLowerCase())) {
    throw new Error("memo-backed settlement sender mismatch");
  }
  return {
    targetContract: match.args.target,
    callDataHash: match.args.callDataHash,
    memoIndex: Number(match.args.memoIndex)
  };
}

function verifyLedgerSettlementEvent(input: {
  receipt: Awaited<ReturnType<ReturnType<typeof settlementPublicClient>["getTransactionReceipt"]>>;
  payment: PaymentRecord;
  service: ServiceRecord;
  context: SettlementChainContext;
}) {
  if (!input.context.ledger) throw new Error(`x402 ledger address is not configured for ${input.context.label}`);
  const expectedServiceId = BigInt(input.service.chainServiceId ?? 0);
  const expectedGrossAmount = usdcBaseUnits(input.payment.grossAmountUsdc ?? input.payment.amountUsdc);
  const expectedUnits = BigInt(input.payment.units);
  const logs = parseEventLogs({
    abi: x402LedgerSettlementAbi,
    logs: input.receipt.logs
  }).filter((log) => log.address.toLowerCase() === input.context.ledger.toLowerCase());

  const match = logs.find((log) => {
    const args = log.args as Record<string, unknown>;
    if (bigintArg(args.serviceId) !== expectedServiceId) return false;
    if (stringArg(args.requestHash).toLowerCase() !== input.payment.requestHash.toLowerCase()) return false;
    if (log.eventName === "AgentRequestSettled" && input.payment.agentWallet) {
      return stringArg(args.agentWallet).toLowerCase() === input.payment.agentWallet.toLowerCase();
    }
    if (log.eventName === "RequestSettled") {
      return stringArg(args.payer).toLowerCase() === input.payment.payer.toLowerCase();
    }
    return false;
  });

  if (!match) throw new Error("x402 ledger settlement event not found");
  const args = match.args as Record<string, unknown>;
  if (stringArg(args.publisher).toLowerCase() !== input.payment.publisherAddress.toLowerCase()) {
    throw new Error("x402 ledger settlement publisher mismatch");
  }
  if (bigintArg(args.units) !== expectedUnits) throw new Error("x402 ledger settlement units mismatch");
  if (bigintArg(args.grossAmount) !== expectedGrossAmount) throw new Error("x402 ledger settlement amount mismatch");
  const platformFee = bigintArg(args.platformFee);
  if (platformFee < 0n || platformFee > expectedGrossAmount) throw new Error("x402 ledger settlement platform fee mismatch");
  const publisherNetAmount = expectedGrossAmount - platformFee;
  const settlementSource = (input.payment.agentWallet ?? input.payment.payer).toLowerCase();
  const publisherTransfers = sumUsdcTransfers({
    receipt: input.receipt,
    from: settlementSource,
    to: input.payment.publisherAddress,
    usdc: input.context.usdc
  });
  if (publisherTransfers < publisherNetAmount) {
    throw new Error("x402 ledger settlement publisher transfer not found");
  }
  if (platformFee > 0n) {
    if (!input.context.treasury) throw new Error("treasury address is not configured");
    const treasuryTransfers = sumUsdcTransfers({
      receipt: input.receipt,
      from: settlementSource,
      to: input.context.treasury,
      usdc: input.context.usdc
    });
    if (treasuryTransfers < platformFee) {
      throw new Error("x402 ledger settlement platform fee transfer to configured treasury not found");
    }
  }
  return {
    grossAmountUsdc: baseUnitsToUsdc(expectedGrossAmount),
    platformFeeUsdc: baseUnitsToUsdc(platformFee),
    publisherNetUsdc: baseUnitsToUsdc(expectedGrossAmount - platformFee)
  };
}

async function assertLedgerTreasuryMatchesConfig(context: SettlementChainContext) {
  if (!context.ledger) throw new Error(`x402 ledger address is not configured for ${context.label}`);
  if (!context.treasury) throw new Error("treasury address is not configured");
  const treasury = await settlementPublicClient(context).readContract({
    address: context.ledger as `0x${string}`,
    abi: x402LedgerReadAbi,
    functionName: "treasury"
  });
  if (treasury.toLowerCase() !== context.treasury.toLowerCase()) {
    throw new Error(`x402 ledger treasury mismatch on ${context.label}: ledger is ${treasury}, but treasury config is ${context.treasury}`);
  }
}

function sumUsdcTransfers(input: {
  receipt: Awaited<ReturnType<ReturnType<typeof settlementPublicClient>["getTransactionReceipt"]>>;
  from: string;
  to: string;
  usdc: string;
}) {
  if (!input.usdc) throw new Error("USDC address is not configured");
  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();
  return parseEventLogs({
    abi: erc20TransferAbi,
    eventName: "Transfer",
    logs: input.receipt.logs
  }).filter((log) => (
    log.address.toLowerCase() === input.usdc.toLowerCase()
    && log.args.from.toLowerCase() === from
    && log.args.to.toLowerCase() === to
  )).reduce((sum, log) => sum + log.args.value, 0n);
}

function settlementPublicClient(context: SettlementChainContext) {
  return createPublicClient({
    transport: http(context.rpcUrl),
    chain: {
      id: context.chainId,
      name: context.label,
      nativeCurrency: context.chainId === config.arc.chainId
        ? {name: "USDC", symbol: "USDC", decimals: 18}
        : {name: "Ether", symbol: "ETH", decimals: 18},
      rpcUrls: {default: {http: [context.rpcUrl]}}
    }
  });
}

function agentWalletAddressForService(
  agent: Awaited<ReturnType<typeof readStore>>["agents"][number] | undefined,
  service: ServiceRecord
) {
  if (!agent) return null;
  const chainId = service.settlementChainId ?? config.arc.chainId;
  return agent.chainWallets?.find((wallet) => wallet.chainId === chainId)?.address
    ?? (chainId === config.arc.chainId ? agent.address : null);
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function usdcBaseUnits(value: number) {
  return BigInt(Math.round(value * 1_000_000));
}

function baseUnitsToUsdc(value: bigint) {
  return roundUsdc(Number(value) / 1_000_000);
}

function bigintArg(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return -1n;
}

function stringArg(value: unknown) {
  return typeof value === "string" ? value : "";
}
