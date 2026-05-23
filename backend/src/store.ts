import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {Pool, type PoolClient} from "pg";
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
let pool: Pool | null = null;
let databaseReady = false;

export async function readStore() {
  if (config.databaseUrl) return readDatabaseStore();
  if (cache) return cache;

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
  if (config.databaseUrl) return updateDatabaseStore(mutate);

  const store = await readStore();
  const result = await mutate(store);
  await persist();
  return result;
}

export async function assertStoreReady() {
  await readStore();
}

export function storageFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|getaddrinfo/i.test(message)) {
    return "Nexora database is unreachable. Check DATABASE_URL in the backend environment; the database host cannot be resolved.";
  }
  if (/ECONNREFUSED|timeout|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return "Nexora database connection failed. Check DATABASE_URL, database availability, and network access from the backend.";
  }
  if (/password authentication failed|28P01/i.test(message)) {
    return "Nexora database authentication failed. Check the username and password in DATABASE_URL.";
  }
  return message;
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

async function readDatabaseStore() {
  await ensureDatabase();
  const result = await database().query("select value from app_store where key = $1", [STORE_KEY]);
  const store = result.rows[0]?.value ? normalizeStore(result.rows[0].value) : emptyStore();

  if (!result.rows[0]) {
    await database().query("insert into app_store (key, value) values ($1, $2::jsonb) on conflict (key) do nothing", [
      STORE_KEY,
      JSON.stringify(store)
    ]);
  }

  return store;
}

async function updateDatabaseStore<T>(mutate: (store: StoreShape) => T | Promise<T>) {
  await ensureDatabase();
  const client = await database().connect();

  try {
    await client.query("begin");
    const selected = await client.query("select value from app_store where key = $1 for update", [STORE_KEY]);
    const store = selected.rows[0]?.value ? normalizeStore(selected.rows[0].value) : emptyStore();
    const result = await mutate(store);
    await client.query(
      `insert into app_store (key, value, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [STORE_KEY, JSON.stringify(store)]
    );
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ensureDatabase() {
  if (databaseReady) return;
  await ensureStoreTable(database());
  databaseReady = true;
}

async function ensureStoreTable(client: Pool | PoolClient) {
  await client.query(`
    create table if not exists app_store (
      key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

function database() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: isLocalDatabase(config.databaseUrl) ? undefined : {rejectUnauthorized: false}
    });
  }
  return pool;
}

function isLocalDatabase(databaseUrl: string) {
  return /localhost|127\.0\.0\.1/.test(databaseUrl);
}
