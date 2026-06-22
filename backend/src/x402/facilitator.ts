import {getService} from "../marketplace/services.js";
import {createPublicClient, http, parseAbi, parseEventLogs} from "viem";
import {config} from "../config.js";
import {ARC_MEMO_CONTRACT, arcMemoAbi, attachSettlementMemoContext, buildX402PaymentMemo, normalizeMemo, type NexoraMemoScope, type NexoraStructuredMemo} from "../memos.js";
import {dispatchNotification} from "../notifications.js";
import {isVisibleAgent, pushNotification, readStore, updateStore, type PaymentRecord, type ServiceRecord} from "../store.js";
import {evaluateAgentPolicy} from "../policies/engine.js";

type AuthorizeInput = {
  serviceId: string;
  payer: string;
  requestHash: string;
  units: number;
  agentId?: string | null;
  privacyScope?: NexoraMemoScope;
};

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
  await assertLedgerTreasuryMatchesConfig();
  const store = await readStore();
  if (store.payments.some((payment) => payment.requestHash === input.requestHash)) {
    throw new Error("request hash has already been used");
  }
  const agent = input.agentId
    ? store.agents.find((item) => isVisibleAgent(item) && item.id === input.agentId)
    : store.agents.find((item) => isVisibleAgent(item) && item.operatorAddress.toLowerCase() === input.payer.toLowerCase());
  const policyCheck = evaluateAgentPolicy({
    agent,
    service,
    units: input.units,
    payments: store.payments
  });
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
      agentWallet: agent?.address ?? null,
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
      memo: failedMemo,
      txHash: null,
      createdAt: new Date().toISOString(),
      settledAt: null
    };
    await updateStore((store) => {
      store.payments.push(failedPayment);
    });
    throw new Error(policyCheck.reason);
  }

  const authorizationId = crypto.randomUUID();
  const grossAmountUsdc = service.pricePerUnitUsdc * input.units;
  const platformFeeUsdc = roundUsdc((grossAmountUsdc * service.manifest.platformFeeBps) / 10_000);
  const createdAt = new Date().toISOString();
  const memo = buildX402PaymentMemo({
    authorizationId,
    payer: input.payer,
    service,
    agent,
    requestHash: input.requestHash,
    units: input.units,
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
    agentWallet: agent?.address ?? null,
    publisherAddress: service.publisherAddress,
    amountUsdc: grossAmountUsdc,
    grossAmountUsdc,
    platformFeeUsdc,
    publisherNetUsdc: roundUsdc(grossAmountUsdc - platformFeeUsdc),
    facilitatorFeeBps: service.manifest.platformFeeBps,
    units: input.units,
    requestHash: input.requestHash,
    status: "authorized" as const,
    policyReason: null,
    memo,
    txHash: null,
    createdAt
  };

  await updateStore((store) => {
    store.payments.push(payment);
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

  return {
    authorizationId,
    paymentRequired: false,
    status: "authorized",
    settlement: {
      asset: "USDC",
      network: "Arc Testnet",
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

  const result = await updateStore((store) => {
    const item = store.payments.find((entry) => entry.authorizationId === input.authorizationId || entry.id === input.authorizationId);
    if (!item) return null;
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
  if (!input.input.txHash) {
    if (input.service.chainServiceId) throw new Error("on-chain x402 settlement requires an Arc transaction hash");
    if (input.input.memoIndex !== undefined && input.input.memoIndex !== null) throw new Error("memo-backed settlement requires a transaction hash");
    return null;
  }
  if (!input.service.chainServiceId) throw new Error("off-chain x402 settlement cannot attach an Arc transaction hash");

  const receipt = await x402ArcPublicClient().getTransactionReceipt({hash: input.input.txHash as `0x${string}`});
  if (receipt.status !== "success") throw new Error("x402 settlement transaction reverted");
  const ledger = verifyLedgerSettlementEvent({receipt, payment: input.payment, service: input.service});
  const memo = verifyMemoSettlementEvent({
    receipt,
    input: input.input,
    payment: input.payment,
    memo: input.memo
  });
  return {ledger, memo};
}

function verifyMemoSettlementEvent(input: {
  receipt: Awaited<ReturnType<ReturnType<typeof x402ArcPublicClient>["getTransactionReceipt"]>>;
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
  receipt: Awaited<ReturnType<ReturnType<typeof x402ArcPublicClient>["getTransactionReceipt"]>>;
  payment: PaymentRecord;
  service: ServiceRecord;
}) {
  if (!config.contracts.x402Ledger) throw new Error("x402 ledger address is not configured");
  const expectedServiceId = BigInt(input.service.chainServiceId ?? 0);
  const expectedGrossAmount = usdcBaseUnits(input.payment.grossAmountUsdc ?? input.payment.amountUsdc);
  const expectedUnits = BigInt(input.payment.units);
  const logs = parseEventLogs({
    abi: x402LedgerSettlementAbi,
    logs: input.receipt.logs
  }).filter((log) => log.address.toLowerCase() === config.contracts.x402Ledger.toLowerCase());

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
    to: input.payment.publisherAddress
  });
  if (publisherTransfers < publisherNetAmount) {
    throw new Error("x402 ledger settlement publisher transfer not found");
  }
  if (platformFee > 0n) {
    if (!config.contracts.treasury) throw new Error("treasury address is not configured");
    const treasuryTransfers = sumUsdcTransfers({
      receipt: input.receipt,
      from: settlementSource,
      to: config.contracts.treasury
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

async function assertLedgerTreasuryMatchesConfig() {
  if (!config.contracts.x402Ledger) throw new Error("x402 ledger address is not configured");
  if (!config.contracts.treasury) throw new Error("treasury address is not configured");
  const treasury = await x402ArcPublicClient().readContract({
    address: config.contracts.x402Ledger as `0x${string}`,
    abi: x402LedgerReadAbi,
    functionName: "treasury"
  });
  if (treasury.toLowerCase() !== config.contracts.treasury.toLowerCase()) {
    throw new Error(`x402 ledger treasury mismatch: ledger is ${treasury}, but TREASURY_ADDRESS is ${config.contracts.treasury}`);
  }
}

function sumUsdcTransfers(input: {
  receipt: Awaited<ReturnType<ReturnType<typeof x402ArcPublicClient>["getTransactionReceipt"]>>;
  from: string;
  to: string;
}) {
  if (!config.contracts.usdc) throw new Error("USDC address is not configured");
  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();
  return parseEventLogs({
    abi: erc20TransferAbi,
    eventName: "Transfer",
    logs: input.receipt.logs
  }).filter((log) => (
    log.address.toLowerCase() === config.contracts.usdc.toLowerCase()
    && log.args.from.toLowerCase() === from
    && log.args.to.toLowerCase() === to
  )).reduce((sum, log) => sum + log.args.value, 0n);
}

function x402ArcPublicClient() {
  return createPublicClient({
    transport: http(config.arc.rpcUrl),
    chain: {
      id: config.arc.chainId,
      name: "Arc Testnet",
      nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
      rpcUrls: {default: {http: [config.arc.rpcUrl]}}
    }
  });
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
