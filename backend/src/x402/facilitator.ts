import {getService} from "../marketplace/services.js";
import {pushNotification, readStore, updateStore} from "../store.js";
import {evaluateAgentPolicy} from "../policies/engine.js";

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
  if (store.payments.some((payment) => payment.requestHash === input.requestHash)) {
    throw new Error("request hash has already been used");
  }
  const agent = input.agentId ? store.agents.find((item) => item.id === input.agentId) : store.agents.find((item) => item.operatorAddress.toLowerCase() === input.payer.toLowerCase());
  const policyCheck = evaluateAgentPolicy({
    agent,
    service,
    units: input.units,
    payments: store.payments
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
    if (item.status === "settled") return item;
    if (item.status !== "authorized") throw new Error("payment is not authorized for settlement");
    item.status = "settled";
    item.txHash = input.txHash ?? null;
    item.settledAt = new Date().toISOString();
    pushNotification(store, {
      operatorAddress: item.payer,
      title: "Payment settled",
      detail: `${item.amountUsdc} USDC paid for ${item.serviceName}`,
      kind: "payment",
      txHash: item.txHash
    });
    pushNotification(store, {
      operatorAddress: item.publisherAddress,
      title: "Revenue received",
      detail: `${item.publisherNetUsdc ?? item.amountUsdc} USDC net from ${item.serviceName}`,
      kind: "payment",
      txHash: item.txHash
    });
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

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
