import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {createConnection, type Socket} from "node:net";
import {connect as connectTls, type TLSSocket} from "node:tls";
import {config} from "./config.js";

export type AgentWalletRecord = {
  id: string;
  operatorAddress: string;
  arcName: string | null;
  address: string | null;
  circleWalletStatus: string;
  circleWalletSetId?: string | null;
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

const STORE_KEY = process.env.NEXORA_STORE_KEY ?? "nexora:app";
const writableStorePath = process.env.VERCEL || process.env.NETLIFY ? "/tmp/nexora-store.json" : ".nexora-data/store.json";
const storePath = resolve(process.env.NEXORA_STORE_PATH ?? writableStorePath);

let cache: StoreShape | null = null;
let writeQueue = Promise.resolve();

export async function readStore() {
  if (cache) return cache;

  if (hasRedis()) {
    const loaded = await readRedisStore();
    if (loaded) {
      cache = loaded;
      return cache;
    }
  }

  try {
    const raw = await readFile(storePath, "utf8");
    cache = normalizeStore(JSON.parse(raw));
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
  const scopedAgents = operator ? store.agents.filter((agent) => agent.operatorAddress.toLowerCase() === operator) : store.agents;
  const agents = scopedAgents.map(sanitizeAgent);
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

function sanitizeAgent(agent: AgentWalletRecord) {
  return {
    id: agent.id,
    operatorAddress: agent.operatorAddress,
    arcName: agent.arcName,
    address: agent.address,
    circleWalletStatus: agent.circleWalletStatus,
    circleWalletSetId: agent.circleWalletSetId ?? null,
    circleWalletId: agent.circleWalletId ?? null,
    createdAt: agent.createdAt,
    policy: agent.policy
  };
}

async function persist() {
  if (hasRedis()) {
    await persistRedisStore();
    return;
  }

  writeQueue = writeQueue.then(async () => {
    if (!cache) return;
    await mkdir(dirname(storePath), {recursive: true});
    await writeFile(storePath, JSON.stringify(cache, null, 2));
  });
  await writeQueue;
}

function emptyStore(): StoreShape {
  return {
    agents: [],
    services: [],
    payments: [],
    earnActivations: [],
    subscriptions: []
  };
}

function normalizeStore(value: unknown): StoreShape {
  return {...emptyStore(), ...(value && typeof value === "object" ? value : {})} as StoreShape;
}

function hasRedis() {
  return Boolean(config.redisUrl) && !/localhost|127\.0\.0\.1/.test(config.redisUrl);
}

async function readRedisStore(): Promise<StoreShape | null> {
  const raw = await redisCommand<string | null>(["GET", STORE_KEY]);
  if (!raw) return null;
  return normalizeStore(JSON.parse(raw));
}

async function persistRedisStore() {
  if (!cache) return;
  await redisCommand(["SET", STORE_KEY, JSON.stringify(cache)]);
}

async function redisCommand<T = string | null>(parts: Array<string>): Promise<T> {
  const url = new URL(config.redisUrl);
  const useTls = url.protocol === "rediss:";
  const port = Number(url.port || (useTls ? 6380 : 6379));
  const host = url.hostname;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const socket = await openRedisSocket(host, port, useTls);

  try {
    if (password || username) {
      const authParts = username ? ["AUTH", username, password ?? ""] : ["AUTH", password ?? ""];
      await sendRedis(socket, authParts);
    }

    const response = await sendRedis(socket, parts);
    return response as T;
  } finally {
    socket.destroy();
  }
}

function openRedisSocket(host: string, port: number, useTls: boolean) {
  return new Promise<Socket | TLSSocket>((resolveSocket, reject) => {
    const socket = useTls
      ? connectTls({host, port, servername: host, rejectUnauthorized: false}, () => resolveSocket(socket))
      : createConnection({host, port}, () => resolveSocket(socket));

    socket.once("error", reject);
  });
}

function sendRedis(socket: Socket | TLSSocket, parts: Array<string>) {
  const payload = encodeResp(parts);
  return new Promise<string | null | number>((resolve, reject) => {
    let buffer = "";

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const parsed = parseResp(buffer);
      if (!parsed.complete) return;
      cleanup();
      if (parsed.error) reject(parsed.error);
      else resolve(parsed.value ?? null);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(payload);
  });
}

function encodeResp(parts: Array<string>) {
  const lines = [`*${parts.length}`];
  for (const part of parts) {
    const value = Buffer.from(part, "utf8");
    lines.push(`$${value.length}`);
    lines.push(part);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function parseResp(raw: string): {complete: boolean; value?: string | number | null; error?: Error} {
  const type = raw[0];
  const firstLineEnd = raw.indexOf("\r\n");
  if (firstLineEnd === -1) return {complete: false};

  const body = raw.slice(1, firstLineEnd);
  if (type === "+") return {complete: true, value: body};
  if (type === ":") return {complete: true, value: Number(body)};
  if (type === "-") return {complete: true, error: new Error(body)};
  if (type === "$") {
    if (body === "-1") return {complete: true, value: null};
    const length = Number(body);
    const valueStart = firstLineEnd + 2;
    const valueEnd = valueStart + length;
    if (raw.length < valueEnd + 2) return {complete: false};
    return {complete: true, value: raw.slice(valueStart, valueEnd)};
  }
  return {complete: false};
}
