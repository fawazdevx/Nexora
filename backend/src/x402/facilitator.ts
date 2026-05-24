import {getService} from "../marketplace/services.js";
import type {ServiceRecord} from "../store.js";
import {readStore, updateStore} from "../store.js";

type AuthorizeInput = {
  serviceId: string;
  payer: string;
  requestHash: string;
  units: number;
  agentId?: string | null;
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
  const store = await readStore();
  const agent = input.agentId ? store.agents.find((item) => item.id === input.agentId) : store.agents.find((item) => item.operatorAddress.toLowerCase() === input.payer.toLowerCase());
  const policyCheck = evaluatePolicy({
    agent,
    payer: input.payer,
    service,
    units: input.units,
    spentTodayUsdc: store.payments
      .filter((payment) => payment.agentId === agent?.id && payment.status === "settled" && isToday(payment.settledAt ?? payment.createdAt))
      .reduce((sum, payment) => sum + payment.amountUsdc, 0)
  });
  if (!policyCheck.allowed) {
    const failedPayment = {
      id: crypto.randomUUID(),
      authorizationId: undefined,
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
    txHash: null,
    createdAt: new Date().toISOString()
  };

  await updateStore((store) => {
    store.payments.push(payment);
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
      contractAction: "X402FacilitatorLedger.settleRequest"
    }
  };
}

export async function settleX402(input: SettleInput) {
  let found = false;
  const payment = await updateStore((store) => {
    const item = store.payments.find((entry) => entry.authorizationId === input.authorizationId || entry.id === input.authorizationId);
    if (!item) return null;
    found = true;
    item.status = "settled";
    item.txHash = input.txHash ?? null;
    item.settledAt = new Date().toISOString();
    return item;
  });

  if (!found || !payment) {
    return {status: "missing_authorization"};
  }

  return {
    authorizationId: input.authorizationId,
    status: "settled",
    txHash: input.txHash ?? null,
    ledgerAction: "call X402FacilitatorLedger.settleRequest",
    facilitatorPrivateKeyConfigured: Boolean(process.env.FACILITATOR_PRIVATE_KEY)
  };
}

function evaluatePolicy(input: {
  agent?: {id: string; address: string | null; policy: {dailyLimitUsdc: number; transactionCapUsdc: number; contractAllowlist: string[]; recipientAllowlist: string[]; active: boolean}} | undefined;
  payer: string;
  service: ServiceRecord;
  units: number;
  spentTodayUsdc: number;
}) {
  if (!input.agent) {
    return {allowed: false, reason: "Create and select an agent wallet before purchasing an API."};
  }
  if (!input.agent.policy.active) {
    return {allowed: false, reason: "Agent policy is inactive."};
  }
  const amount = input.service.pricePerUnitUsdc * input.units;
  if (amount > input.agent.policy.transactionCapUsdc) {
    return {allowed: false, reason: "This purchase exceeds the agent transaction cap."};
  }

  if (input.spentTodayUsdc + amount > input.agent.policy.dailyLimitUsdc) {
    return {allowed: false, reason: "This purchase exceeds the agent daily limit."};
  }

  if (input.agent.policy.recipientAllowlist.length > 0 && !input.agent.policy.recipientAllowlist.some((item) => item.toLowerCase() === input.service.publisherAddress.toLowerCase())) {
    return {allowed: false, reason: "The service publisher is not in the agent recipient allowlist."};
  }

  if (input.agent.policy.contractAllowlist.length > 0) {
    const ledgerAllowed = input.agent.policy.contractAllowlist.some((item) => item.toLowerCase() === String(process.env.X402_LEDGER_ADDRESS ?? "").toLowerCase());
    if (!ledgerAllowed) {
      return {allowed: false, reason: "The x402 ledger contract is not in the agent contract allowlist."};
    }
  }

  return {allowed: true as const};
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isToday(value: string) {
  const date = new Date(value);
  const now = new Date();
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth() && date.getUTCDate() === now.getUTCDate();
}
