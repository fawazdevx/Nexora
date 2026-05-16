import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {config} from "./config.js";

export type AgentWalletRecord = {
  id: string;
  operatorAddress: string;
  arcName: string | null;
  address: string | null;
  circleWalletStatus: string;
  circleWalletId?: string | null;
  createdAt: string;
  policy: {
    dailyLimitUsdc: number;
    transactionCapUsdc: number;
    contractAllowlist: string[];
    recipientAllowlist: string[];
    active: boolean;
    txHash?: string | null;
  };
};

export type ServiceRecord = {
  id: string;
  chainServiceId: number | null;
  publisherAddress: string;
  name: string;
  endpointHash: string;
  pricePerUnitUsdc: number;
  active: boolean;
  featured: boolean;
  txHash?: string | null;
  createdAt: string;
};

export type PaymentRecord = {
  id: string;
  authorizationId?: string;
  serviceId: string;
  serviceName: string;
  payer: string;
  publisherAddress: string;
  amountUsdc: number;
  units: number;
  requestHash: string;
  status: "authorized" | "settled" | "failed" | "policy_blocked";
  txHash?: string | null;
  createdAt: string;
  settledAt?: string | null;
};

export type EarnActivationRecord = {
  id: string;
  opportunityId: string;
  operatorAddress: string;
  status: "queued" | "requires_configuration";
  createdAt: string;
};

export type SubscriptionRecord = {
  id: string;
  operatorAddress: string;
  plan: string;
  amountUsdc: number;
  status: "active" | "pending_payment";
  createdAt: string;
};

type StoreShape = {
  agents: AgentWalletRecord[];
  services: ServiceRecord[];
  payments: PaymentRecord[];
  earnActivations: EarnActivationRecord[];
  subscriptions: SubscriptionRecord[];
};

const emptyStore = (): StoreShape => ({
  agents: [],
  services: [],
  payments: [],
  earnActivations: [],
  subscriptions: []
});

const writableStorePath = process.env.VERCEL || process.env.NETLIFY ? "/tmp/nexora-store.json" : ".nexora-data/store.json";
const storePath = resolve(process.env.NEXORA_STORE_PATH ?? writableStorePath);
let cache: StoreShape | null = null;
let writeQueue = Promise.resolve();

export async function readStore() {
  if (cache) return cache;

  try {
    const raw = await readFile(storePath, "utf8");
    cache = {...emptyStore(), ...JSON.parse(raw)} as StoreShape;
  } catch {
    cache = emptyStore();
    await persist();
  }

  return cache;
}

export async function updateStore<T>(mutate: (store: StoreShape) => T | Promise<T>) {
  const store = await readStore();
  const result = await mutate(store);
  await persist();
  return result;
}

export async function appSnapshot(operatorAddress?: string) {
  const store = await readStore();
  const operator = operatorAddress?.toLowerCase();
  const payments = operator
    ? store.payments.filter((payment) => payment.payer.toLowerCase() === operator || payment.publisherAddress.toLowerCase() === operator)
    : store.payments;
  const agents = operator ? store.agents.filter((agent) => agent.operatorAddress.toLowerCase() === operator) : store.agents;
  const subscriptions = operator
    ? store.subscriptions.filter((subscription) => subscription.operatorAddress.toLowerCase() === operator)
    : store.subscriptions;

  const settledPayments = payments.filter((payment) => payment.status === "settled");
  const marketplaceSales = settledPayments.length;
  const completedTasks = store.earnActivations.filter((activation) => !operator || activation.operatorAddress.toLowerCase() === operator).length;
  const ecosystemContributions = store.services.filter((service) => !operator || service.publisherAddress.toLowerCase() === operator).length;
  const successfulPayments = settledPayments.length;

  return {
    agents,
    services: store.services,
    payments,
    subscriptions,
    reputation: {
      successfulPayments,
      completedTasks,
      marketplaceSales,
      ecosystemContributions,
      verifiedBuilder: settledPayments.length >= 10 || ecosystemContributions >= 3,
      score: successfulPayments * 5 + completedTasks * 8 + marketplaceSales * 10 + ecosystemContributions * 12
    },
    stats: {
      agentWallets: agents.length,
      usdcSettled: settledPayments.reduce((sum, payment) => sum + payment.amountUsdc, 0),
      earnRoutes: store.earnActivations.length,
      policySaves: agents.filter((agent) => agent.policy.txHash).length
    },
    readiness: {
      apiConfigured: true,
      onchainConfigured: Boolean(config.contracts.usdc && config.contracts.x402Ledger && config.contracts.policyRegistry),
      circleConfigured: Boolean(config.circle.apiKey)
    }
  };
}

async function persist() {
  writeQueue = writeQueue.then(async () => {
    if (!cache) return;
    await mkdir(dirname(storePath), {recursive: true});
    await writeFile(storePath, JSON.stringify(cache, null, 2));
  });
  await writeQueue;
}
