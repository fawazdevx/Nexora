import {getService} from "../marketplace/services.js";
import {updateStore} from "../store.js";

type AuthorizeInput = {
  serviceId: string;
  payer: string;
  requestHash: string;
  units: number;
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

  const authorizationId = crypto.randomUUID();
  const payment = {
    id: authorizationId,
    authorizationId,
    serviceId: service.id,
    serviceName: service.name,
    payer: input.payer,
    publisherAddress: service.publisherAddress,
    amountUsdc: service.pricePerUnitUsdc * input.units,
    units: input.units,
    requestHash: input.requestHash,
    status: "authorized" as const,
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
