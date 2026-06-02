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
  manifest: ServiceManifest;
  active: boolean;
  featured: boolean;
  txHash?: string | null;
  createdAt: string;
};

export type ServiceManifest = {
  kind: "website_analyzer" | "github_repo_analyzer" | "x_account_analyzer" | "contract_safety_check" | "wallet_activity_summary" | "landing_page_copy_reviewer" | "grant_application_reviewer" | "generic";
  version: string;
  description: string;
  inputSchema: Array<{name: string; label: string; type: "text" | "url"; required: boolean; placeholder?: string}>;
  outputSchema: string[];
  revenueMode: "per_execution";
  platformFeeBps: number;
  webhookUrl?: string | null;
};

export type PaymentRecord = {
  id: string;
  authorizationId?: string;
  serviceId: string;
  serviceName: string;
  payer: string;
  agentId?: string | null;
  agentWallet?: string | null;
  publisherAddress: string;
  amountUsdc: number;
  grossAmountUsdc?: number;
  platformFeeUsdc?: number;
  publisherNetUsdc?: number;
  facilitatorFeeBps?: number;
  units: number;
  requestHash: string;
  status: "authorized" | "settled" | "failed" | "policy_blocked";
  policyReason?: string | null;
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

export type EscrowRecord = {
  id: string;
  chainEscrowId?: number | null;
  creatorAddress: string;
  counterpartyAddress: string;
  title: string;
  description: string;
  amountUsdc: number;
  performanceBondUsdc: number;
  platformFeeBps: number;
  platformFeeUsdc: number;
  counterpartyNetUsdc: number;
  status: "draft" | "funded" | "submitted" | "verified" | "released" | "disputed" | "cancelled";
  deliverableUrl?: string | null;
  deliverableResult?: unknown;
  verifierNotes?: string | null;
  txHash?: string | null;
  createdAt: string;
  fundedAt?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  releasedAt?: string | null;
};

export type NotificationRecord = {
  id: string;
  operatorAddress?: string | null;
  title: string;
  detail?: string | null;
  kind: "agent" | "payment" | "earn" | "escrow" | "policy" | "system";
  txHash?: string | null;
  createdAt: string;
};

type StoreShape = {
  agents: AgentWalletRecord[];
  services: ServiceRecord[];
  payments: PaymentRecord[];
  earnActivations: EarnActivationRecord[];
  subscriptions: SubscriptionRecord[];
  escrows: EscrowRecord[];
  notifications: NotificationRecord[];
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
  const escrows = operator
    ? store.escrows.filter((escrow) => escrow.creatorAddress.toLowerCase() === operator || escrow.counterpartyAddress.toLowerCase() === operator)
    : store.escrows;
  const notifications = operator
    ? store.notifications.filter((item) => !item.operatorAddress || item.operatorAddress.toLowerCase() === operator)
    : store.notifications;

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
    escrows,
    notifications: notifications.slice(0, 20),
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
    subscriptions: [],
    escrows: [],
    notifications: []
  };
}

function normalizeStore(value: unknown): StoreShape {
  const store = {...emptyStore(), ...(value && typeof value === "object" ? value : {})} as StoreShape;
  store.services = store.services.map((service) => ({
    ...service,
    manifest: service.manifest ?? defaultManifestForService(service.name, service.endpointHash)
  }));
  store.payments = store.payments.map((payment) => {
    const grossAmountUsdc = payment.grossAmountUsdc ?? payment.amountUsdc;
    const facilitatorFeeBps = payment.facilitatorFeeBps ?? 0;
    const platformFeeUsdc = payment.platformFeeUsdc ?? roundUsdc(grossAmountUsdc * facilitatorFeeBps / 10_000);
    return {
      ...payment,
      grossAmountUsdc,
      platformFeeUsdc,
      publisherNetUsdc: payment.publisherNetUsdc ?? roundUsdc(grossAmountUsdc - platformFeeUsdc)
    };
  });
  return store;
}

function defaultManifestForService(name: string, endpointHash: string): ServiceManifest {
  const marker = `${name} ${endpointHash}`.toLowerCase();
  if (marker.includes("website") || marker.includes("url analyzer") || marker.includes("site analyzer")) {
    return {
      kind: "website_analyzer",
      version: "1.0.0",
      description: "Reviews a website URL and returns page title, metadata, links, headings, and a short readable summary.",
      inputSchema: [{name: "url", label: "Website URL", type: "url", required: true, placeholder: "https://example.com"}],
      outputSchema: ["title", "description", "summary", "headings", "links", "wordCount"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (marker.includes("github") || marker.includes("repo analyzer") || marker.includes("repository")) {
    return {
      kind: "github_repo_analyzer",
      version: "1.0.0",
      description: "Reviews a public GitHub repository and returns activity, language, license, popularity, and README signal.",
      inputSchema: [{name: "repo", label: "GitHub repository", type: "text", required: true, placeholder: "owner/repo or GitHub URL"}],
      outputSchema: ["repo", "description", "stars", "forks", "openIssues", "license", "signal"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (marker.includes("x account") || marker.includes("x-account") || marker.includes("twitter")) {
    return {
      kind: "x_account_analyzer",
      version: "1.0.0",
      description: "Reviews a public X account when API credits are available and returns metrics, account signal, and score.",
      inputSchema: [{name: "handle", label: "X account", type: "text", required: true, placeholder: "@username"}],
      outputSchema: ["account", "metrics", "score", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (marker.includes("contract safety") || marker.includes("contract check") || marker.includes("contract audit")) {
    return {
      kind: "contract_safety_check",
      version: "1.0.0",
      description: "Checks a contract address and returns a safety checklist before it is used in agent policy.",
      inputSchema: [{name: "contract", label: "Contract address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["contract", "riskLevel", "checks", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (marker.includes("wallet activity") || marker.includes("wallet summary") || marker.includes("wallet risk")) {
    return {
      kind: "wallet_activity_summary",
      version: "1.0.0",
      description: "Summarizes wallet risk notes and recommended agent recipient policy.",
      inputSchema: [{name: "wallet", label: "Wallet address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["wallet", "riskLevel", "summary", "recommendedPolicy"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (marker.includes("landing page") || marker.includes("copy reviewer")) {
    return {
      kind: "landing_page_copy_reviewer",
      version: "1.0.0",
      description: "Reviews landing page copy or a URL for clarity, conversion, and CTA quality.",
      inputSchema: [{name: "url", label: "URL or page copy", type: "text", required: true, placeholder: "https://example.com or paste copy"}],
      outputSchema: ["score", "issues", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (marker.includes("grant") || marker.includes("application reviewer")) {
    return {
      kind: "grant_application_reviewer",
      version: "1.0.0",
      description: "Reviews a grant application summary for infrastructure clarity, revenue proof, and ecosystem fit.",
      inputSchema: [{name: "application", label: "Application summary", type: "text", required: true, placeholder: "Paste your grant summary"}],
      outputSchema: ["score", "strengths", "gaps", "recommendations"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  return {
    kind: "generic",
    version: "1.0.0",
    description: "Hosted x402 API service. Add a backend executor or webhook to return structured results.",
    inputSchema: [],
    outputSchema: ["summary", "note"],
    revenueMode: "per_execution",
    platformFeeBps: 200
  };
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function pushNotification(store: StoreShape, input: Omit<NotificationRecord, "id" | "createdAt">) {
  store.notifications.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  });
  store.notifications = store.notifications.slice(0, 200);
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
