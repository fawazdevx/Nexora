import {timingSafeEqual} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {Pool, type PoolClient} from "pg";
import {config} from "./config.js";
import {CANONICAL_MARKETPLACE_SERVICES} from "./marketplace/canonical-catalog.js";
import {normalizeMemo, type NexoraStructuredMemo} from "./memos.js";
import {normalizePolicyV2, type PolicyRemediation} from "./policies/engine.js";

export type AgentPolicy = {
  dailyLimitUsdc: number;
  transactionCapUsdc: number;
  contractAllowlist: string[];
  recipientAllowlist: string[];
  active: boolean;
  txHash?: string | null;
  deployments?: AgentPolicyDeployment[];
  v2?: {
    weeklyLimitUsdc: number;
    monthlyLimitUsdc: number;
    maxUnitsPerRequest: number;
    cooldownSeconds: number;
    expiresAt: string | null;
    serviceAllowlist: string[];
    requireOnchainPolicy: boolean;
  };
};

export type AgentPolicyDeployment = {
  chainId: number;
  txHash: string;
  policyRegistry?: string | null;
  updatedAt: string;
};

export type AgentChainWalletRecord = {
  chainId: number;
  chain: string;
  circleBlockchain: string;
  address: string | null;
  circleWalletId: string | null;
  status: string;
  updatedAt: string;
};

export type AgentWalletRecord = {
  id: string;
  walletKind?: "circle_developer" | "external_eoa";
  operatorAddress: string;
  arcName: string | null;
  address: string | null;
  circleWalletStatus: string;
  circleWalletSetId?: string | null;
  circleWalletId?: string | null;
  circleAccountType?: "EOA" | "SCA" | null;
  settlementMode?: "eoa_memo" | "sca_direct" | null;
  chainWallets?: AgentChainWalletRecord[];
  createdAt: string;
  archivedAt?: string | null;
  archiveReason?: string | null;
  policy: AgentPolicy;
};

export type ServiceRecord = {
  id: string;
  chainServiceId: number | null;
  // EVM chain id of the ledger this service was published on. Each chain's
  // X402FacilitatorLedger has its own nextServiceId counter, so chainServiceId
  // alone is ambiguous across chains — this disambiguates which RPC/ledger the
  // settlement must be verified against. Null/undefined = Arc (legacy default).
  settlementChainId?: number | null;
  publisherAddress: string;
  name: string;
  endpointHash: string;
  pricePerUnitUsdc: number;
  manifest: ServiceManifest;
  active: boolean;
  featured: boolean;
  txHash?: string | null;
  createdAt: string;
  archivedAt?: string | null;
  archiveReason?: string | null;
  trust?: ServiceTrustScore | null;
};

export type ServiceTrustScore = {
  score: number;
  tier: "new" | "emerging" | "trusted" | "verified";
  settledPayments: number;
  failedPayments: number;
  totalVolumeUsdc: number;
  uniqueBuyers: number;
  publisherSales: number;
  publisherServices: number;
  onchainReady: boolean;
  receiptCoverage: number;
  reasons: string[];
  updatedAt: string;
};

export type ServiceManifest = {
  kind:
    | "website_analyzer"
    | "github_repo_analyzer"
    | "x_account_analyzer"
    | "contract_safety_check"
    | "wallet_activity_summary"
    | "landing_page_copy_reviewer"
    | "grant_application_reviewer"
    | "meeting_brief"
    | "arc_builder_research"
    | "domain_name_research"
    | "social_content_audit"
    | "stablecoin_route_report"
    | "policy_risk_review"
    | "launch_readiness_check"
    | "x402_integration_planner"
    | "wallet_risk_approval_scan"
    | "agent_transaction_preflight"
    | "contract_interaction_risk_scan"
    | "invoice_collection_agent"
    | "escrow_milestone_monitor"
    | "counterparty_compliance_screen"
    | "liquidation_risk_monitor"
    | "vault_apy_monitor"
    | "subscription_payment_agent"
    | "publisher_revenue_intelligence"
    | "dao_grant_payout_agent"
    | "swap_route_quote_agent"
    | "generic";
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
  remediation?: PolicyRemediation | null;
  memo?: NexoraStructuredMemo | null;
  txHash?: string | null;
  external?: {
    provider: "circle_agent_marketplace" | "meridian";
    serviceUrl: string;
    chain: string;
    chainId?: number | null;
    network?: string | null;
    paymentScheme?: string | null;
    resultSummary?: string | null;
    accountingStatus?: "recorded" | "pending" | null;
    accountingTxHashes?: string[] | null;
    accountingAttempts?: number | null;
    lastAccountingError?: string | null;
    settlementId?: string | null;
    reservationStatus?: "reserved" | "finalized" | "cancelled" | "legacy" | null;
    assetSymbol?: string | null;
  } | null;
  createdAt: string;
  settledAt?: string | null;
};

export type PaymentIntentRecord = {
  id: string;
  operatorAddress: string;
  agentId?: string | null;
  agentWallet?: string | null;
  requestHash: string;
  status: "pending_approval" | "approved" | "rejected" | "executing" | "settled" | "failed" | "policy_blocked" | "expired";
  source: {
    provider: "circle_agent_marketplace";
    serviceUrl: string;
    inspectedAt: string;
  };
  normalized: {
    serviceId: string;
    serviceName: string;
    description: string;
    amountUsdc: number;
    payTo: string;
    chain: string;
    chainId?: number | null;
    network?: string | null;
    paymentScheme?: string | null;
    assetAddress?: string | null;
    inputSchema?: unknown;
  };
  data: Record<string, unknown>;
  policy: {
    allowed: boolean;
    reason?: string | null;
    remediation?: PolicyRemediation | null;
    dailySpentUsdc: number;
    weeklySpentUsdc: number;
    monthlySpentUsdc: number;
    checks: Array<{status: "pass" | "fail"; label: string; detail: string}>;
    riskFlags: Array<{severity: "info" | "warning" | "critical"; label: string; detail: string}>;
  };
  approval: {
    required: boolean;
    decidedBy?: string | null;
    decidedAt?: string | null;
    note?: string | null;
    expiresAt?: string | null;
  };
  execution: {
    paymentId?: string | null;
    txHash?: string | null;
    resultSummary?: string | null;
    error?: string | null;
    executedAt?: string | null;
  };
  receiptId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentApprovalRequestRecord = {
  id: string;
  operatorAddress: string;
  agentId: string;
  agentWallet?: string | null;
  serviceId: string;
  serviceName: string;
  publisherAddress: string;
  amountUsdc: number;
  units: number;
  requestHash: string;
  simulation: {
    allowed: boolean;
    reason?: string | null;
    dailySpentUsdc: number;
    weeklySpentUsdc: number;
    monthlySpentUsdc: number;
  };
  status: "pending" | "approved" | "rejected" | "expired";
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string | null;
  expiresAt?: string | null;
};

export type AgentAutomationTrigger =
  | "daily_spend_threshold"
  | "failed_payment_burst"
  | "pending_approval_expiring"
  | "policy_expiring"
  | "large_receipt"
  | "weekly_summary";

export type AgentAutomationAction = "notify" | "pause_agent";

export type AgentAutomationRecipeRecord = {
  id: string;
  operatorAddress: string;
  agentId?: string | null;
  name: string;
  description: string;
  trigger: AgentAutomationTrigger;
  action: AgentAutomationAction;
  params: {
    thresholdUsdc?: number;
    thresholdPercent?: number;
    failureCount?: number;
    windowHours?: number;
    expiresWithinHours?: number;
    minAmountUsdc?: number;
    cooldownHours?: number;
  };
  active: boolean;
  runCount: number;
  lastTriggeredAt?: string | null;
  lastRunAt?: string | null;
  lastRunReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentAutomationRunRecord = {
  id: string;
  recipeId: string;
  operatorAddress: string;
  agentId?: string | null;
  trigger: AgentAutomationTrigger;
  action: AgentAutomationAction;
  status: "matched" | "skipped" | "failed";
  summary: string;
  createdAt: string;
};

export type EarnActivationRecord = {
  id: string;
  opportunityId: string;
  operatorAddress: string;
  status: "queued" | "requires_configuration";
  createdAt: string;
};

export type EarnOptimizerRunRecord = {
  id: string;
  profile: "conservative" | "balanced" | "growth";
  chainId: number;
  status: "stay" | "rebalance_recommended" | "rebalanced" | "skipped" | "failed";
  activeStrategyId: number | null;
  selectedStrategyId: number | null;
  activeProtocol: string | null;
  selectedProtocol: string | null;
  reason: string;
  strategyCount: number;
  activeApyBps: number | null;
  selectedApyBps: number | null;
  strategyTelemetry: Array<{
    strategyId: number;
    assetsPerShare: number | null;
    observedAt: string;
  }>;
  txHash: string | null;
  createdAt: string;
};

export type SubscriptionRecord = {
  id: string;
  operatorAddress: string;
  plan: string;
  planName?: string;
  amountUsdc: number;
  interval?: "month" | "one_time";
  status: "active" | "pending_payment";
  txHash?: string | null;
  chainId?: number | null;
  activatedAt?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
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
  reminder?: EscrowReminderSettingsRecord | null;
};

export type EscrowReminderSettingsRecord = {
  enabled: boolean;
  deadlineAt: string | null;
  offsetsHours: number[];
  channels: {
    inApp: boolean;
    email: boolean;
    telegram: boolean;
    whatsapp: boolean;
  };
  muted: boolean;
  snoozedUntil: string | null;
  lastReminderAt?: string | null;
  nextReminderAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EscrowReminderRunRecord = {
  id: string;
  escrowId: string;
  operatorAddress: string;
  role: "creator" | "counterparty";
  dueAt: string;
  offsetHours: number;
  status: "sent" | "skipped" | "failed";
  summary: string;
  createdAt: string;
};

export type NotificationRecord = {
  id: string;
  operatorAddress?: string | null;
  title: string;
  detail?: string | null;
  kind: "agent" | "payment" | "earn" | "escrow" | "policy" | "system";
  txHash?: string | null;
  receiptId?: string | null;
  actionHref?: string | null;
  createdAt: string;
};

export type NotificationPreferencesRecord = {
  operatorAddress: string;
  email: string | null;
  emailVerifiedAt: string | null;
  whatsapp: string | null;
  telegram: string | null;
  telegramLink?: {
    code: string;
    status: "pending" | "connected";
    chatId?: string | null;
    username?: string | null;
    expiresAt?: string | null;
    updatedAt: string;
  } | null;
  channels: {
    inApp: boolean;
    email: boolean;
    whatsapp: boolean;
    telegram: boolean;
  };
  events: {
    agentActions: boolean;
    paymentReceipts: boolean;
    policyAlerts: boolean;
    escrowUpdates: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

export type EmailVerificationChallengeRecord = {
  operatorAddress: string;
  email: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  lastSentAt: string;
  createdAt: string;
};

export type NotificationDeliveryRecord = {
  id: string;
  notificationId: string;
  operatorAddress: string;
  channel: "email" | "whatsapp" | "telegram";
  target: string;
  status: "sent" | "skipped" | "failed";
  provider: string;
  reason?: string | null;
  createdAt: string;
};

export type FacilitatorEventRecord = {
  id: string;
  kind: "verify" | "settle";
  status: "success" | "failed";
  payer?: string | null;
  payTo?: string | null;
  network?: string | null;
  asset?: string | null;
  amountUsdc?: number;
  requestHash?: string | null;
  txHash?: string | null;
  reason?: string | null;
  createdAt: string;
};

export type IndexedChainEventRecord = {
  id: string;
  chainId: number;
  contract: "x402Ledger" | "nexoraEscrow" | "saveEarnVault" | "yieldRouter" | "policyRegistry";
  event: string;
  address: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  args: Record<string, string | number | boolean | null>;
  amountUsdc?: number;
  feeUsdc?: number;
  actor?: string | null;
  counterparty?: string | null;
  createdAt: string;
};

export type RiskAlertRecord = {
  id: string;
  severity: "info" | "warning" | "critical";
  category: "policy" | "spend" | "approval" | "payment";
  title: string;
  detail: string;
  agentId?: string | null;
  serviceId?: string | null;
  actionHref?: string | null;
  createdAt: string;
};

export type IndexerCursorRecord = {
  id: string;
  chainId: number;
  contract: IndexedChainEventRecord["contract"];
  address: string;
  lastBlock: number;
  updatedAt: string;
};

export type StoreShape = {
  agents: AgentWalletRecord[];
  services: ServiceRecord[];
  payments: PaymentRecord[];
  paymentIntents: PaymentIntentRecord[];
  automationRecipes: AgentAutomationRecipeRecord[];
  automationRuns: AgentAutomationRunRecord[];
  earnActivations: EarnActivationRecord[];
  earnOptimizerRuns: EarnOptimizerRunRecord[];
  subscriptions: SubscriptionRecord[];
  escrows: EscrowRecord[];
  escrowReminderRuns: EscrowReminderRunRecord[];
  notifications: NotificationRecord[];
  notificationPreferences: NotificationPreferencesRecord[];
  emailVerificationChallenges: EmailVerificationChallengeRecord[];
  notificationDeliveries: NotificationDeliveryRecord[];
  facilitatorEvents: FacilitatorEventRecord[];
  indexedEvents: IndexedChainEventRecord[];
  indexerCursors: IndexerCursorRecord[];
  approvalRequests: AgentApprovalRequestRecord[];
};

const CANONICAL_MARKETPLACE_ENDPOINTS = new Set<string>(
  CANONICAL_MARKETPLACE_SERVICES.map((service) => service.endpointHash)
);

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

// ---------------------------------------------------------------------------
// Money path (task 3): dedicated helpers for payments and payment_intents.
//
// In file mode these fall back to the existing blob path (updateStore), so the
// in-process cache + write queue keep serializing writes exactly as before. In
// DB mode they operate on the relational tables so Postgres enforces the money
// invariants directly (partial unique index for replay; row/advisory locks for
// the daily-limit check) instead of relying on the global app_store row lock.
// ---------------------------------------------------------------------------

// Thrown when a payment insert collides with an already-active (authorized or
// settled) payment for the same request hash. Callers translate this into the
// existing "request hash has already been used" response.
export class RequestHashConflictError extends Error {
  constructor(message = "request hash has already been used") {
    super(message);
    this.name = "RequestHashConflictError";
  }
}

function paymentIntentNotFound() {
  // Mirrors the httpError shape used by the Circle marketplace so callers keep
  // returning HTTP 404 regardless of storage mode.
  return Object.assign(new Error("payment intent not found"), {status: 404});
}

const ACTIVE_PAYMENT_STATUSES = new Set<PaymentRecord["status"]>(["authorized", "settled"]);

function isActivePaymentStatus(status: PaymentRecord["status"]) {
  return ACTIVE_PAYMENT_STATUSES.has(status);
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as {code?: string}).code === "23505");
}

// Insert a payment. When the payment is active (authorized/settled), the
// active-only replay guard rejects a second live payment for the same request
// hash — enforced by the partial unique index in DB mode and by an explicit
// check under the blob lock in file mode. `blobMutate` runs additional
// non-money-path mutations (e.g. notifications) atomically with the insert.
export async function insertPayment<T>(
  payment: PaymentRecord,
  blobMutate?: (store: StoreShape) => T
): Promise<T | undefined> {
  const normalized = normalizePaymentRecord(payment);

  if (!config.databaseUrl) {
    return updateStore((store) => {
      if (
        isActivePaymentStatus(normalized.status)
        && store.payments.some((existing) => existing.requestHash === normalized.requestHash && isActivePaymentStatus(existing.status))
      ) {
        throw new RequestHashConflictError();
      }
      store.payments.push(normalized);
      return blobMutate ? blobMutate(store) : undefined;
    });
  }

  await ensureDatabase();
  const client = await database().connect();
  try {
    await client.query("begin");
    try {
      await insertPaymentRow(client, normalized);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (isUniqueViolation(error)) throw new RequestHashConflictError();
      throw error;
    }
    let result: T | undefined;
    if (blobMutate) {
      result = await runBlobMutation(client, blobMutate);
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Update a payment by id via a mutator that receives the current record. The
// mutator returns the mutated record (or null to signal "not found / no-op").
// `blobMutate` runs alongside for notifications, atomically in DB mode.
export async function updatePaymentById<T>(
  matcher: (payment: PaymentRecord) => boolean,
  mutate: (payment: PaymentRecord, store: StoreShape) => T
): Promise<T | undefined> {
  if (!config.databaseUrl) {
    return updateStore((store) => {
      const payment = store.payments.find(matcher);
      if (!payment) return undefined;
      return mutate(payment, store);
    });
  }

  await ensureDatabase();
  const client = await database().connect();
  try {
    await client.query("begin");
    const store = await hydratedBlobStore(client);
    const payment = store.payments.find(matcher);
    if (!payment) {
      await client.query("commit");
      return undefined;
    }
    const result = mutate(payment, store);
    await client.query(updatePaymentRowColumns(payment));
    await persistBlob(client, store);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Insert a payment intent. `blobMutate` runs alongside for notifications.
export async function insertPaymentIntent<T>(
  intent: PaymentIntentRecord,
  blobMutate?: (store: StoreShape) => T
): Promise<T | undefined> {
  const normalized = normalizePaymentIntent(intent);

  if (!config.databaseUrl) {
    return updateStore((store) => {
      store.paymentIntents.unshift(normalized);
      store.paymentIntents = store.paymentIntents.slice(0, 500);
      return blobMutate ? blobMutate(store) : undefined;
    });
  }

  await ensureDatabase();
  const client = await database().connect();
  try {
    await client.query("begin");
    await insertPaymentIntentRow(client, normalized);
    let result: T | undefined;
    if (blobMutate) result = await runBlobMutation(client, blobMutate);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Update a payment intent by id under a row lock (DB mode) so status
// transitions (approve, mark-executing, settle) are serialized. The mutator
// may throw to abort the transition.
export async function updatePaymentIntentById<T>(
  id: string,
  mutate: (intent: PaymentIntentRecord, store: StoreShape) => T
): Promise<T> {
  if (!config.databaseUrl) {
    return updateStore((store) => {
      const intent = store.paymentIntents.find((item) => item.id === id);
      if (!intent) throw paymentIntentNotFound();
      return mutate(intent, store);
    });
  }

  await ensureDatabase();
  const client = await database().connect();
  try {
    await client.query("begin");
    const locked = await client.query("select record from payment_intents where id = $1 for update", [id]);
    if (!locked.rows[0]) {
      await client.query("rollback").catch(() => undefined);
      throw paymentIntentNotFound();
    }
    const store = await hydratedBlobStore(client);
    const intent = store.paymentIntents.find((item) => item.id === id) ?? normalizePaymentIntent(locked.rows[0].record);
    const result = mutate(intent, store);
    await client.query(updatePaymentIntentRowColumns(intent));
    await persistBlob(client, store);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Run `fn` while holding an exclusive lock keyed to an agent, and provide the
// agent's currently settled payments so the caller can compute spend windows
// atomically with the write that follows. In DB mode this uses a Postgres
// advisory lock (agents still live in the blob, so there is no agent row to
// lock); in file mode the blob write queue already serializes everything, so
// `fn` simply runs against the current store.
//
// NOTE (Part B, task 3): the DB-mode advisory-lock path is verified by review
// only — no Postgres was reachable in the build environment. The file-mode
// path is covered by the concurrent daily-limit adversarial test.
export async function withAgentSpendLock<T>(
  agentId: string | null | undefined,
  fn: (context: {settledPayments: PaymentRecord[]}) => Promise<T> | T
): Promise<T> {
  if (!config.databaseUrl) {
    const store = await readStore();
    const settledPayments = store.payments.filter((payment) => payment.agentId === agentId && payment.status === "settled");
    return fn({settledPayments});
  }

  await ensureDatabase();
  const client = await database().connect();
  try {
    const lockKey = advisoryLockKey(agentId ?? "");
    await client.query("select pg_advisory_lock($1)", [lockKey]);
    try {
      const settled = await client.query(
        "select record from payments where agent_id = $1 and status = 'settled'",
        [agentId ?? null]
      );
      const settledPayments = settled.rows.map((row) => normalizePaymentRecord(row.record));
      return await fn({settledPayments});
    } finally {
      await client.query("select pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

// Deterministic 63-bit advisory-lock key from an arbitrary agent id.
function advisoryLockKey(seed: string) {
  let hash = 0n;
  for (const char of seed) {
    hash = (hash * 131n + BigInt(char.charCodeAt(0))) % 9223372036854775783n;
  }
  return hash.toString();
}

// Load the app_store blob plus the table-backed money records into a single
// StoreShape for a mutation that spans both (e.g. payment + notification).
async function hydratedBlobStore(client: PoolClient) {
  const selected = await client.query("select value from app_store where key = $1 for update", [STORE_KEY]);
  const store = selected.rows[0]?.value ? normalizeStore(selected.rows[0].value) : emptyStore();
  store.payments = await loadPaymentsFromTable(client);
  store.paymentIntents = await loadPaymentIntentsFromTable(client);
  return store;
}

async function runBlobMutation<T>(client: PoolClient, blobMutate: (store: StoreShape) => T): Promise<T> {
  const store = await hydratedBlobStore(client);
  const result = blobMutate(store);
  await persistBlob(client, store);
  return result;
}

async function persistBlob(client: PoolClient, store: StoreShape) {
  await client.query(
    `insert into app_store (key, value, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [STORE_KEY, JSON.stringify(blobPersistShape(store))]
  );
}

export function storageFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Expected bytes32, got bytes20|AbiEncoding|invalid.*bytes(20|32)/i.test(message)) {
    return "Nexora could not prepare this payment because an authorization value was malformed. Refresh and try again.";
  }
  if (/FeeExceedsMax|0x5ff85e3f/i.test(message)) {
    return "The settlement fee changed before submission. Refresh the payment requirements and try again.";
  }
  if (/ContractFunctionExecutionError|execution reverted|transaction reverted/i.test(message)) {
    return "The payment contract rejected the transaction. Check the selected network, balance, and approval, then try again.";
  }
  if (/ENOTFOUND|getaddrinfo/i.test(message)) {
    return "Nexora data service is temporarily unreachable. Please try again shortly.";
  }
  if (/ECONNREFUSED|timeout|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return "Nexora data service is temporarily unavailable. Please try again shortly.";
  }
  if (/password authentication failed|28P01/i.test(message)) {
    return "Nexora data service is unavailable. The team has been notified.";
  }
  return message;
}

export async function appSnapshot(operatorAddress?: string) {
  const store = await readStore();
  const operator = operatorAddress?.toLowerCase();
  const visibleServices = visibleServicesForStore(store.services);
  const servicesWithTrust = attachServiceTrust(visibleServices, store.payments);
  const visibleAgents = store.agents.filter(isVisibleAgent);
  const visibleServiceIds = new Set(servicesWithTrust.map((service) => service.id));
  const visibleAgentIds = new Set(visibleAgents.map((agent) => agent.id));
  const visibleAgentWallets = new Set(visibleAgents.flatMap(agentWalletAddresses));
  const visiblePayments = store.payments.filter((payment) => isVisiblePayment(payment, {visibleServiceIds, visibleAgentIds, visibleAgentWallets}));
  const payments = operator
    ? visiblePayments.filter((payment) => payment.payer.toLowerCase() === operator || payment.publisherAddress.toLowerCase() === operator)
    : [];
  const paymentIntents = operator
    ? store.paymentIntents.filter((intent) => intent.operatorAddress.toLowerCase() === operator)
    : [];
  const approvalRequests = operator
    ? store.approvalRequests.filter((request) => request.operatorAddress.toLowerCase() === operator)
    : [];
  const automationRecipes = operator
    ? store.automationRecipes.filter((recipe) => recipe.operatorAddress.toLowerCase() === operator)
    : [];
  const automationRuns = operator
    ? store.automationRuns.filter((run) => run.operatorAddress.toLowerCase() === operator).slice(0, 40)
    : [];
  const escrowReminderRuns = operator
    ? store.escrowReminderRuns.filter((run) => run.operatorAddress.toLowerCase() === operator).slice(0, 40)
    : [];
  const scopedAgents = operator ? visibleAgents.filter((agent) => agent.operatorAddress.toLowerCase() === operator) : [];
  const agents = scopedAgents.map(sanitizeAgent);
  const subscriptions = operator
    ? store.subscriptions.filter((subscription) => subscription.operatorAddress.toLowerCase() === operator)
    : [];
  const escrows = operator
    ? store.escrows.filter((escrow) => escrow.creatorAddress.toLowerCase() === operator || escrow.counterpartyAddress.toLowerCase() === operator)
    : [];
  const notifications = operator
    ? store.notifications.filter((item) => !item.operatorAddress || item.operatorAddress.toLowerCase() === operator)
    : [];
  const notificationPreferences = operator ? preferencesForOperator(store, operatorAddress ?? "") : null;
  const notificationDeliveries = operator
    ? store.notificationDeliveries.filter((item) => item.operatorAddress.toLowerCase() === operator).slice(0, 20)
    : [];

  const platformSettledPayments = store.payments.filter((payment) => payment.status === "settled");
  const settledPayments = payments.filter((payment) => payment.status === "settled");
  const marketplaceSales = settledPayments.length;
  const ecosystemContributions = servicesWithTrust.filter((service) => !operator || service.publisherAddress.toLowerCase() === operator).length;
  const successfulPayments = settledPayments.length;
  const indexedStats = summarizeIndexedEvents(store.indexedEvents);
  const indexedAvailable = indexedStats.indexedEvents > 0;
  const completedTasks = indexedAvailable ? indexedStats.saveEarnDeposits : 0;

  return {
    agents,
    services: servicesWithTrust,
    payments,
    paymentIntents,
    approvalRequests,
    automationRecipes,
    automationRuns,
    escrowReminderRuns,
    subscriptions,
    escrows,
    notifications: notifications.slice(0, 20),
    notificationPreferences,
    notificationDeliveries,
    riskAlerts: computeRiskAlerts({agents: scopedAgents, payments, paymentIntents, approvalRequests}),
    reputation: {
      successfulPayments,
      completedTasks,
      marketplaceSales,
      ecosystemContributions,
      verifiedBuilder: settledPayments.length >= 10 || ecosystemContributions >= 3,
      score: successfulPayments * 5 + completedTasks * 8 + marketplaceSales * 10 + ecosystemContributions * 12
    },
    stats: {
      agentWallets: operator ? agents.length : store.agents.length,
      usdcSettled: indexedAvailable ? indexedStats.marketplaceGrossUsdc : (operator ? settledPayments : platformSettledPayments).reduce((sum, payment) => sum + payment.amountUsdc, 0),
      earnRoutes: indexedAvailable ? indexedStats.saveEarnDeposits : 0,
      policySaves: indexedStats.policySaves > 0
        ? indexedStats.policySaves
        : (operator ? agents : store.agents).reduce((sum, agent) => sum + Math.max(agent.policy.deployments?.length ?? 0, agent.policy.txHash ? 1 : 0), 0),
      analyticsSource: indexedAvailable ? "indexed" : "local",
      indexedEvents: indexedStats.indexedEvents,
      saveEarnDepositVolumeUsdc: indexedStats.saveEarnDepositVolumeUsdc,
      saveEarnWithdrawalVolumeUsdc: indexedStats.saveEarnWithdrawalVolumeUsdc
    },
    access: {
      developerAnalytics: hasActivePlan(subscriptions, "developer_analytics"),
      premiumAgentAutomation: hasActivePlan(subscriptions, "premium_agent_automation"),
      enterprisePolicy: hasActivePlan(subscriptions, "enterprise_policy")
    },
    readiness: {
      apiConfigured: true,
      onchainConfigured: Boolean(config.contracts.usdc && config.contracts.x402Ledger && config.contracts.policyRegistry),
      circleConfigured: Boolean(config.circle.apiKey)
    }
  };
}

function hasActivePlan(subscriptions: SubscriptionRecord[], plan: string) {
  const now = Date.now();
  return subscriptions.some((subscription) => (
    subscription.plan === plan
    && subscription.status === "active"
    && (!subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > now)
  ));
}

function summarizeIndexedEvents(events: IndexedChainEventRecord[]) {
  const marketplaceSettlements = events.filter((event) => event.contract === "x402Ledger" && (event.event === "RequestSettled" || event.event === "AgentRequestSettled"));
  const saveDeposits = events.filter((event) => event.contract === "saveEarnVault" && event.event === "Deposited");
  const saveWithdrawals = events.filter((event) => event.contract === "saveEarnVault" && event.event === "Withdrawn");
  const policySaves = events.filter((event) => event.contract === "policyRegistry" && event.event === "PolicyUpdated");

  return {
    indexedEvents: events.length,
    marketplaceGrossUsdc: roundUsdc(marketplaceSettlements.reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0)),
    saveEarnDeposits: saveDeposits.length,
    saveEarnDepositVolumeUsdc: roundUsdc(saveDeposits.reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0)),
    saveEarnWithdrawals: saveWithdrawals.length,
    saveEarnWithdrawalVolumeUsdc: roundUsdc(saveWithdrawals.reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0)),
    policySaves: policySaves.length
  };
}

function computeRiskAlerts(input: {
  agents: AgentWalletRecord[];
  payments: PaymentRecord[];
  paymentIntents: PaymentIntentRecord[];
  approvalRequests: AgentApprovalRequestRecord[];
}): RiskAlertRecord[] {
  const now = Date.now();
  const today = startOfUtcDay(now);
  const recentCutoff = now - 24 * 60 * 60 * 1000;
  const alerts: RiskAlertRecord[] = [];

  for (const agent of input.agents) {
    const agentLabel = agent.arcName || agent.address || agent.id;
    const settledToday = input.payments.filter((payment) => (
      payment.status === "settled"
      && paymentBelongsToAgent(payment, agent)
      && Date.parse(payment.settledAt ?? payment.createdAt) >= today
    ));
    const spentToday = roundUsdc(settledToday.reduce((sum, payment) => sum + Number(payment.amountUsdc || 0), 0));
    const dailyLimit = Number(agent.policy.dailyLimitUsdc || 0);
    const transactionCap = Number(agent.policy.transactionCapUsdc || 0);
    const spentRatio = dailyLimit > 0 ? spentToday / dailyLimit : 0;

    if (!agent.policy.active) {
      alerts.push(riskAlert({
        severity: "critical",
        category: "policy",
        title: "Policy disabled",
        detail: `${agentLabel} cannot enforce spend controls until its policy is active.`,
        agentId: agent.id,
        actionHref: "/settings/policies"
      }));
    }

    if (dailyLimit > 0 && spentRatio >= 1) {
      alerts.push(riskAlert({
        severity: "critical",
        category: "spend",
        title: "Daily spend limit reached",
        detail: `${agentLabel} has spent ${spentToday} of ${dailyLimit} USDC today.`,
        agentId: agent.id,
        actionHref: "/settings/policies"
      }));
    } else if (dailyLimit > 0 && spentRatio >= 0.8) {
      alerts.push(riskAlert({
        severity: "warning",
        category: "spend",
        title: "Daily spend near limit",
        detail: `${agentLabel} has used ${Math.round(spentRatio * 100)}% of today's policy limit.`,
        agentId: agent.id,
        actionHref: "/settings/policies"
      }));
    }

    if (dailyLimit > 0 && transactionCap > dailyLimit) {
      alerts.push(riskAlert({
        severity: "warning",
        category: "policy",
        title: "Transaction cap above daily limit",
        detail: `${agentLabel} has a ${transactionCap} USDC transaction cap but only ${dailyLimit} USDC daily spend limit.`,
        agentId: agent.id,
        actionHref: "/settings/policies"
      }));
    }

    if (agent.policy.active && agent.policy.contractAllowlist.length === 0 && agent.policy.recipientAllowlist.length === 0) {
      alerts.push(riskAlert({
        severity: "warning",
        category: "policy",
        title: "No allowlists configured",
        detail: `${agentLabel} has spend limits, but no contract or recipient allowlist.`,
        agentId: agent.id,
        actionHref: "/settings/policies"
      }));
    }

    if (agent.policy.v2?.requireOnchainPolicy && !(agent.policy.deployments?.length || agent.policy.txHash)) {
      alerts.push(riskAlert({
        severity: "critical",
        category: "policy",
        title: "On-chain policy required",
        detail: `${agentLabel} requires on-chain enforcement, but no policy save transaction is recorded.`,
        agentId: agent.id,
        actionHref: "/settings/policies"
      }));
    }

    if (agent.policy.v2?.expiresAt) {
      const expiresAt = Date.parse(agent.policy.v2.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        alerts.push(riskAlert({
          severity: "critical",
          category: "policy",
          title: "Policy expired",
          detail: `${agentLabel} policy expired and should be renewed before more agent payments.`,
          agentId: agent.id,
          actionHref: "/settings/policies"
        }));
      } else if (Number.isFinite(expiresAt) && expiresAt - now <= 3 * 24 * 60 * 60 * 1000) {
        alerts.push(riskAlert({
          severity: "warning",
          category: "policy",
          title: "Policy expires soon",
          detail: `${agentLabel} policy expires in ${Math.max(1, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)))} day(s).`,
          agentId: agent.id,
          actionHref: "/settings/policies"
        }));
      }
    }

    const recentBlocked = input.payments.filter((payment) => (
      paymentBelongsToAgent(payment, agent)
      && (payment.status === "failed" || payment.status === "policy_blocked")
      && Date.parse(payment.createdAt) >= recentCutoff
    ));
    if (recentBlocked.length >= 3) {
      alerts.push(riskAlert({
        severity: "warning",
        category: "payment",
        title: "Repeated payment blocks",
        detail: `${agentLabel} has ${recentBlocked.length} failed or policy-blocked payment attempts in the last 24 hours.`,
        agentId: agent.id,
        actionHref: "/payments"
      }));
    }
  }

  for (const request of input.approvalRequests.filter((item) => item.status === "pending")) {
    const expiresAt = request.expiresAt ? Date.parse(request.expiresAt) : null;
    if (expiresAt && Number.isFinite(expiresAt) && expiresAt <= now) {
      alerts.push(riskAlert({
        severity: "critical",
        category: "approval",
        title: "Approval request expired",
        detail: `${request.serviceName} request for ${request.amountUsdc} USDC is past its approval window.`,
        agentId: request.agentId,
        serviceId: request.serviceId,
        actionHref: "/settings/policies"
      }));
    } else if (expiresAt && Number.isFinite(expiresAt) && expiresAt - now <= 2 * 60 * 60 * 1000) {
      alerts.push(riskAlert({
        severity: "warning",
        category: "approval",
        title: "Approval expires soon",
        detail: `${request.serviceName} request for ${request.amountUsdc} USDC expires within 2 hours.`,
        agentId: request.agentId,
        serviceId: request.serviceId,
        actionHref: "/settings/policies"
      }));
    }
  }

  for (const intent of input.paymentIntents.filter((item) => item.status === "pending_approval" || item.status === "failed" || item.status === "policy_blocked")) {
    if (intent.status === "pending_approval") {
      alerts.push(riskAlert({
        severity: intent.policy.allowed ? "info" : "warning",
        category: "approval",
        title: "Circle payment awaiting approval",
        detail: `${intent.normalized.serviceName} request for ${intent.normalized.amountUsdc} USDC is waiting in the payments queue.`,
        agentId: intent.agentId ?? null,
        serviceId: intent.normalized.serviceId,
        actionHref: "/payments"
      }));
    } else {
      alerts.push(riskAlert({
        severity: intent.status === "policy_blocked" ? "critical" : "warning",
        category: "payment",
        title: "Circle payment did not execute",
        detail: `${intent.normalized.serviceName}: ${intent.execution.error ?? intent.policy.reason ?? "execution failed"}`,
        agentId: intent.agentId ?? null,
        serviceId: intent.normalized.serviceId,
        actionHref: "/payments"
      }));
    }
  }

  return alerts
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 20);
}

function riskAlert(input: Omit<RiskAlertRecord, "id" | "createdAt">): RiskAlertRecord {
  return {
    id: stableAlertId(input),
    createdAt: new Date().toISOString(),
    ...input
  };
}

function stableAlertId(input: Omit<RiskAlertRecord, "id" | "createdAt">) {
  return [
    input.category,
    input.severity,
    input.agentId ?? "global",
    input.serviceId ?? "service",
    input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  ].join(":");
}

function severityRank(severity: RiskAlertRecord["severity"]) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function paymentBelongsToAgent(payment: PaymentRecord, agent: AgentWalletRecord) {
  return payment.agentId === agent.id || Boolean(payment.agentWallet && agentWalletAddresses(agent).includes(payment.agentWallet.toLowerCase()));
}

/** Every chain address belonging to an agent, including Arc-only legacy records. */
export function agentWalletAddresses(agent: Pick<AgentWalletRecord, "address" | "chainWallets">) {
  return [...new Set([
    agent.address,
    ...(agent.chainWallets ?? []).map((wallet) => wallet.address)
  ].filter((address): address is string => Boolean(address)).map((address) => address.toLowerCase()))];
}

function startOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function sanitizeAgent(agent: AgentWalletRecord) {
  return {
    id: agent.id,
    walletKind: agent.walletKind ?? "circle_developer",
    operatorAddress: agent.operatorAddress,
    arcName: agent.arcName,
    address: agent.address,
    circleWalletStatus: agent.circleWalletStatus,
    circleWalletSetId: agent.circleWalletSetId ?? null,
    circleWalletId: agent.circleWalletId ?? null,
    circleAccountType: agent.circleAccountType ?? null,
    settlementMode: agent.settlementMode ?? null,
    chainWallets: agent.chainWallets ?? [],
    createdAt: agent.createdAt,
    policy: agent.policy
  };
}

export function attachServiceTrust(services: ServiceRecord[], payments: PaymentRecord[]) {
  return services.map((service) => ({
    ...service,
    trust: computeServiceTrustScore(service, services, payments)
  }));
}

export function computeServiceTrustScore(service: ServiceRecord, services: ServiceRecord[], payments: PaymentRecord[]): ServiceTrustScore {
  const servicePayments = payments.filter((payment) => payment.serviceId === service.id);
  const settled = servicePayments.filter((payment) => payment.status === "settled");
  const failed = servicePayments.filter((payment) => payment.status === "failed" || payment.status === "policy_blocked");
  const totalVolumeUsdc = roundUsdc(settled.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0));
  const uniqueBuyers = new Set(settled.map((payment) => payment.payer.toLowerCase())).size;
  const publisherServices = services.filter((item) => item.publisherAddress.toLowerCase() === service.publisherAddress.toLowerCase()).length;
  const publisherSales = payments.filter((payment) => (
    payment.publisherAddress.toLowerCase() === service.publisherAddress.toLowerCase()
    && payment.status === "settled"
  )).length;
  const receiptCoverage = servicePayments.length === 0 ? 0 : settled.filter((payment) => payment.txHash || payment.memo).length / servicePayments.length;
  const failureRate = servicePayments.length === 0 ? 0 : failed.length / servicePayments.length;

  let score = 20;
  const reasons: string[] = [];
  if (service.chainServiceId !== null) {
    score += 22;
    reasons.push("Published on the x402 ledger");
  }
  if (service.txHash) {
    score += 8;
    reasons.push("Publish transaction recorded");
  }
  if (settled.length > 0) {
    score += Math.min(18, settled.length * 3);
    reasons.push(`${settled.length} settled purchase${settled.length === 1 ? "" : "s"}`);
  }
  if (uniqueBuyers > 0) {
    score += Math.min(12, uniqueBuyers * 4);
    reasons.push(`${uniqueBuyers} unique buyer${uniqueBuyers === 1 ? "" : "s"}`);
  }
  if (totalVolumeUsdc > 0) {
    score += Math.min(8, totalVolumeUsdc);
    reasons.push(`${totalVolumeUsdc.toFixed(2)} USDC settled`);
  }
  if (service.featured) {
    score += 8;
    reasons.push("Featured by Nexora");
  }
  if (publisherSales >= 3) {
    score += 6;
    reasons.push("Publisher has marketplace history");
  }
  if (publisherServices >= 2) {
    score += 4;
    reasons.push("Publisher has multiple services");
  }
  if (service.manifest.inputSchema.length > 0 && service.manifest.outputSchema.length > 0) {
    score += 6;
    reasons.push("Structured input and output schema");
  }
  if (receiptCoverage >= 0.8 && settled.length > 0) {
    score += 6;
    reasons.push("Receipt coverage is high");
  }
  if (failureRate > 0) {
    const penalty = Math.min(20, Math.ceil(failureRate * 30));
    score -= penalty;
    reasons.push(`${Math.round(failureRate * 100)}% failed or blocked attempts`);
  }

  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: bounded,
    tier: trustTier(bounded, settled.length, Boolean(service.chainServiceId)),
    settledPayments: settled.length,
    failedPayments: failed.length,
    totalVolumeUsdc,
    uniqueBuyers,
    publisherSales,
    publisherServices,
    onchainReady: service.chainServiceId !== null,
    receiptCoverage: roundUsdc(receiptCoverage),
    reasons: reasons.slice(0, 6),
    updatedAt: new Date().toISOString()
  };
}

function trustTier(score: number, settledPayments: number, onchainReady: boolean): ServiceTrustScore["tier"] {
  if (score >= 78 && settledPayments >= 3 && onchainReady) return "verified";
  if (score >= 60 && onchainReady) return "trusted";
  if (score >= 40) return "emerging";
  return "new";
}

export function isArchivedAgent(agent: Pick<AgentWalletRecord, "archivedAt">) {
  return Boolean(agent.archivedAt);
}

export function isVisibleAgent(agent: AgentWalletRecord) {
  return !isArchivedAgent(agent);
}

export function isArchivedService(service: Pick<ServiceRecord, "archivedAt">) {
  return Boolean(service.archivedAt);
}

export function isCanonicalMarketplaceRoute(service: Pick<ServiceRecord, "publisherAddress" | "endpointHash" | "chainServiceId">) {
  const publisherAddress = config.contracts.marketplacePublisher.trim().toLowerCase();
  return Boolean(
    publisherAddress
    && service.chainServiceId !== null
    && service.publisherAddress.trim().toLowerCase() === publisherAddress
    && CANONICAL_MARKETPLACE_ENDPOINTS.has(service.endpointHash.trim().toLowerCase())
  );
}

export function isVisibleService(service: ServiceRecord) {
  return !isArchivedService(service) && service.active !== false && service.chainServiceId !== null;
}

export function visibleServicesForStore(services: ServiceRecord[]) {
  const canonicalByRoute = new Map<string, ServiceRecord>();

  for (const service of services) {
    if (!isVisibleService(service)) continue;
    const key = serviceRouteKey(service);
    const current = canonicalByRoute.get(key);
    if (!current || shouldPreferVisibleService(service, current)) {
      canonicalByRoute.set(key, service);
    }
  }

  return services.filter((service) => isVisibleService(service) && canonicalByRoute.get(serviceRouteKey(service)) === service);
}

function serviceRouteKey(service: Pick<ServiceRecord, "id" | "endpointHash" | "publisherAddress" | "settlementChainId">) {
  const endpointHash = service.endpointHash.trim().toLowerCase();
  const endpoint = endpointHash || service.id;
  const publisher = service.publisherAddress.trim().toLowerCase();
  const settlementChainId = service.settlementChainId ?? config.arc.chainId;
  return `${publisher}:${endpoint}:${settlementChainId}`;
}

function shouldPreferVisibleService(candidate: ServiceRecord, current: ServiceRecord) {
  const candidateChainId = candidate.chainServiceId ?? -1;
  const currentChainId = current.chainServiceId ?? -1;
  if (candidateChainId !== currentChainId) return candidateChainId > currentChainId;

  const candidateCreatedAt = Date.parse(candidate.createdAt) || 0;
  const currentCreatedAt = Date.parse(current.createdAt) || 0;
  if (candidateCreatedAt !== currentCreatedAt) return candidateCreatedAt > currentCreatedAt;

  return candidate.id > current.id;
}

function isVisiblePayment(payment: PaymentRecord, scope: {
  visibleServiceIds: Set<string>;
  visibleAgentIds: Set<string>;
  visibleAgentWallets: Set<string>;
}) {
  if (!payment.external && !scope.visibleServiceIds.has(payment.serviceId)) return false;
  if (payment.agentId && !scope.visibleAgentIds.has(payment.agentId)) return false;
  if (payment.agentWallet && !scope.visibleAgentWallets.has(payment.agentWallet.toLowerCase())) return false;
  return true;
}

export async function archiveWorkspaceTestData(input: {reason?: string; archiveAgents?: boolean; archiveServices?: boolean} = {}) {
  const archivedAt = new Date().toISOString();
  const archiveAgents = input.archiveAgents !== false;
  const archiveServices = input.archiveServices !== false;
  const reason = input.reason ?? "Archived pre-demo test data";

  return updateStore((store) => {
    let agentsArchived = 0;
    let servicesArchived = 0;

    if (archiveAgents) {
      for (const agent of store.agents) {
        if (isArchivedAgent(agent)) continue;
        agent.archivedAt = archivedAt;
        agent.archiveReason = reason;
        agentsArchived += 1;
      }
    }

    if (archiveServices) {
      for (const service of store.services) {
        if (isArchivedService(service) || isCanonicalMarketplaceRoute(service)) continue;
        service.archivedAt = archivedAt;
        service.archiveReason = reason;
        service.active = false;
        servicesArchived += 1;
      }
    }

    return {archivedAt, agentsArchived, servicesArchived};
  });
}

export async function updateNotificationPreferences(input: {
  operatorAddress: string;
  email?: string | null;
  whatsapp?: string | null;
  telegram?: string | null;
  channels?: Partial<NotificationPreferencesRecord["channels"]>;
  events?: Partial<NotificationPreferencesRecord["events"]>;
}) {
  return updateStore((store) => {
    const lower = input.operatorAddress.toLowerCase();
    const current = preferencesForOperator(store, input.operatorAddress);
    const now = new Date().toISOString();
    const email = input.email === undefined ? current.email : normalizeNotificationEmail(input.email);
    const telegram = input.telegram === undefined ? current.telegram : normalizeTelegramChatId(input.telegram);
    if (email && email !== current.email) {
      throw notificationBindingError(
        "Email addresses must be verified with a one-time code before they can be linked.",
        400,
        "email_verification_required"
      );
    }
    if (telegram && telegram !== current.telegram) {
      throw notificationBindingError(
        "Telegram accounts must be connected through the Nexora bot link flow.",
        400,
        "telegram_verification_required"
      );
    }
    const emailVerifiedAt = email ? current.emailVerifiedAt : null;
    assertNotificationBindingAvailable(store, {
      operatorAddress: input.operatorAddress,
      channel: "telegram",
      target: telegram
    });
    const channels = {...current.channels, ...(input.channels ?? {})};
    if (!email || !emailVerifiedAt) channels.email = false;
    const next = normalizeNotificationPreferences({
      ...current,
      email,
      emailVerifiedAt,
      whatsapp: input.whatsapp === undefined ? current.whatsapp : input.whatsapp,
      telegram,
      channels,
      events: {...current.events, ...(input.events ?? {})},
      updatedAt: now
    });
    if (!email) {
      store.emailVerificationChallenges = store.emailVerificationChallenges.filter(
        (challenge) => challenge.operatorAddress.toLowerCase() !== lower
      );
    }
    const index = store.notificationPreferences.findIndex((item) => item.operatorAddress.toLowerCase() === lower);
    if (index >= 0) store.notificationPreferences[index] = next;
    else store.notificationPreferences.push(next);
    return next;
  });
}

export async function beginEmailNotificationVerification(input: {
  operatorAddress: string;
  email: string;
  codeHash: string;
  expiresAt: string;
  minResendIntervalMs?: number;
  maxAttempts?: number;
}) {
  const email = normalizeNotificationEmail(input.email);
  if (!email) {
    throw notificationBindingError("A valid email address is required.", 400, "invalid_email");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.codeHash)) {
    throw notificationBindingError("Email verification could not be prepared.", 400, "invalid_email_verification");
  }

  return updateStore((store) => {
    const operator = input.operatorAddress.toLowerCase();
    const now = new Date();
    const minResendIntervalMs = Math.max(0, input.minResendIntervalMs ?? 60_000);
    const current = store.emailVerificationChallenges.find(
      (challenge) => challenge.operatorAddress.toLowerCase() === operator
    );
    if (
      current
      && new Date(current.lastSentAt).getTime() + minResendIntervalMs > now.getTime()
    ) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((new Date(current.lastSentAt).getTime() + minResendIntervalMs - now.getTime()) / 1_000)
      );
      throw notificationBindingError(
        `Wait ${retryAfterSeconds} seconds before requesting another verification code.`,
        429,
        "email_verification_rate_limited"
      );
    }

    assertNotificationBindingAvailable(store, {
      operatorAddress: input.operatorAddress,
      channel: "email",
      target: email
    });

    const record: EmailVerificationChallengeRecord = {
      operatorAddress: input.operatorAddress,
      email,
      codeHash: input.codeHash.toLowerCase(),
      attempts: 0,
      maxAttempts: Math.max(1, input.maxAttempts ?? 5),
      expiresAt: new Date(input.expiresAt).toISOString(),
      lastSentAt: now.toISOString(),
      createdAt: now.toISOString()
    };
    store.emailVerificationChallenges = store.emailVerificationChallenges.filter(
      (challenge) => challenge.operatorAddress.toLowerCase() !== operator
    );
    store.emailVerificationChallenges.push(record);
    return {
      email: record.email,
      expiresAt: record.expiresAt,
      resendAt: new Date(now.getTime() + minResendIntervalMs).toISOString(),
      maxAttempts: record.maxAttempts
    };
  });
}

export async function cancelEmailNotificationVerification(input: {
  operatorAddress: string;
  email: string;
  codeHash: string;
}) {
  const email = normalizeNotificationEmail(input.email);
  if (!email) return;
  await updateStore((store) => {
    const operator = input.operatorAddress.toLowerCase();
    store.emailVerificationChallenges = store.emailVerificationChallenges.filter((challenge) => !(
      challenge.operatorAddress.toLowerCase() === operator
      && challenge.email === email
      && emailVerificationHashMatches(challenge.codeHash, input.codeHash)
    ));
  });
}

export async function completeEmailNotificationVerification(input: {
  operatorAddress: string;
  email: string;
  codeHash: string;
}) {
  const email = normalizeNotificationEmail(input.email);
  if (!email) {
    throw notificationBindingError("A valid email address is required.", 400, "invalid_email");
  }

  const outcome = await updateStore((store) => {
    const operator = input.operatorAddress.toLowerCase();
    const challengeIndex = store.emailVerificationChallenges.findIndex(
      (challenge) => challenge.operatorAddress.toLowerCase() === operator && challenge.email === email
    );
    if (challengeIndex === -1) {
      return {
        ok: false as const,
        status: 400,
        code: "email_verification_not_found",
        message: "Request a new email verification code."
      };
    }

    const challenge = store.emailVerificationChallenges[challengeIndex];
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      store.emailVerificationChallenges.splice(challengeIndex, 1);
      return {
        ok: false as const,
        status: 410,
        code: "email_verification_expired",
        message: "The verification code expired. Request a new code."
      };
    }

    if (!emailVerificationHashMatches(challenge.codeHash, input.codeHash)) {
      challenge.attempts += 1;
      const attemptsRemaining = Math.max(0, challenge.maxAttempts - challenge.attempts);
      if (attemptsRemaining === 0) {
        store.emailVerificationChallenges.splice(challengeIndex, 1);
        return {
          ok: false as const,
          status: 429,
          code: "email_verification_attempts_exhausted",
          message: "Too many incorrect codes. Request a new verification code."
        };
      }
      return {
        ok: false as const,
        status: 400,
        code: "email_verification_invalid",
        message: `The verification code is incorrect. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
      };
    }

    assertNotificationBindingAvailable(store, {
      operatorAddress: input.operatorAddress,
      channel: "email",
      target: email
    });

    const current = preferencesForOperator(store, input.operatorAddress);
    const now = new Date().toISOString();
    const next = normalizeNotificationPreferences({
      ...current,
      email,
      emailVerifiedAt: now,
      channels: {...current.channels, email: true},
      updatedAt: now
    });
    const preferencesIndex = store.notificationPreferences.findIndex(
      (preferences) => preferences.operatorAddress.toLowerCase() === operator
    );
    if (preferencesIndex >= 0) store.notificationPreferences[preferencesIndex] = next;
    else store.notificationPreferences.push(next);
    store.emailVerificationChallenges = store.emailVerificationChallenges.filter(
      (challengeRecord) => challengeRecord.operatorAddress.toLowerCase() !== operator
    );
    return {ok: true as const, preferences: next};
  });

  if (!outcome.ok) {
    throw notificationBindingError(outcome.message, outcome.status, outcome.code);
  }
  return outcome.preferences;
}

export async function beginTelegramNotificationLink(input: {
  operatorAddress: string;
  code: string;
  expiresAt: string;
}) {
  return updateStore((store) => {
    const lower = input.operatorAddress.toLowerCase();
    const current = preferencesForOperator(store, input.operatorAddress);
    const now = new Date().toISOString();
    const next = normalizeNotificationPreferences({
      ...current,
      telegramLink: {
        code: input.code,
        status: "pending",
        chatId: null,
        username: null,
        expiresAt: input.expiresAt,
        updatedAt: now
      },
      updatedAt: now
    });
    const index = store.notificationPreferences.findIndex((item) => item.operatorAddress.toLowerCase() === lower);
    if (index >= 0) store.notificationPreferences[index] = next;
    else store.notificationPreferences.push(next);
    return next;
  });
}

export async function completeTelegramNotificationLink(input: {
  operatorAddress?: string;
  code?: string;
  chatId: string;
  username?: string | null;
}) {
  return updateStore((store) => {
    const now = new Date().toISOString();
    const index = store.notificationPreferences.findIndex((item) => {
      const preferences = normalizeNotificationPreferences(item);
      if (input.operatorAddress && preferences.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) return false;
      if (input.code && preferences.telegramLink?.code !== input.code) return false;
      return Boolean(preferences.telegramLink?.code);
    });
    if (index === -1) throw new Error("Telegram link request was not found. Start Telegram linking again.");

    const current = normalizeNotificationPreferences(store.notificationPreferences[index]);
    if (current.telegramLink?.expiresAt && new Date(current.telegramLink.expiresAt).getTime() < Date.now()) {
      throw new Error("Telegram link request expired. Start Telegram linking again.");
    }

    assertNotificationBindingAvailable(store, {
      operatorAddress: current.operatorAddress,
      channel: "telegram",
      target: input.chatId
    });

    const next = normalizeNotificationPreferences({
      ...current,
      telegram: input.chatId,
      telegramLink: {
        code: current.telegramLink?.code ?? input.code ?? "",
        status: "connected",
        chatId: input.chatId,
        username: input.username ?? null,
        expiresAt: current.telegramLink?.expiresAt ?? null,
        updatedAt: now
      },
      channels: {...current.channels, telegram: true},
      updatedAt: now
    });
    store.notificationPreferences[index] = next;
    return next;
  });
}

export async function recordNotificationDeliveries(records: Omit<NotificationDeliveryRecord, "id" | "createdAt">[]) {
  if (records.length === 0) return [];
  return updateStore((store) => {
    const created = records.map((record) => normalizeNotificationDelivery({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...record
    }));
    store.notificationDeliveries.unshift(...created);
    store.notificationDeliveries = store.notificationDeliveries.slice(0, 500);
    return created;
  });
}

export function preferencesForOperator(store: StoreShape, operatorAddress: string): NotificationPreferencesRecord {
  const existing = store.notificationPreferences.find((item) => item.operatorAddress.toLowerCase() === operatorAddress.toLowerCase());
  if (existing) return normalizeNotificationPreferences(existing);
  const now = new Date().toISOString();
  return {
    operatorAddress,
    email: null,
    emailVerifiedAt: null,
    whatsapp: null,
    telegram: null,
    telegramLink: null,
    channels: {
      inApp: true,
      email: false,
      whatsapp: false,
      telegram: false
    },
    events: {
      agentActions: true,
      paymentReceipts: true,
      policyAlerts: true,
      escrowUpdates: true
    },
    createdAt: now,
    updatedAt: now
  };
}

function assertNotificationBindingAvailable(
  store: StoreShape,
  input: {
    operatorAddress: string;
    channel: "email" | "telegram";
    target: string | null;
  }
) {
  const target = input.channel === "email"
    ? normalizeNotificationEmail(input.target)
    : normalizeTelegramChatId(input.target);
  if (!target) return;
  const operator = input.operatorAddress.toLowerCase();
  const conflict = store.notificationPreferences
    .map(normalizeNotificationPreferences)
    .find((preferences) => {
      if (preferences.operatorAddress.toLowerCase() === operator) return false;
      if (input.channel === "email" && !preferences.emailVerifiedAt) return false;
      const existing = input.channel === "email" ? preferences.email : preferences.telegram;
      return existing === target;
    });
  if (!conflict) return;
  throw notificationBindingError(
    input.channel === "email"
      ? "This email address is already linked to another Nexora account."
      : "This Telegram account is already linked to another Nexora account.",
    409
  );
}

function notificationBindingError(
  message: string,
  status: number,
  code = "notification_binding_conflict"
) {
  return Object.assign(new Error(message), {
    name: "NotificationBindingError",
    status,
    code
  });
}

function normalizeNotificationEmail(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeTelegramChatId(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emailVerificationHashMatches(expected: string, actual: string) {
  if (!/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
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
    automationRecipes: [],
    automationRuns: [],
    earnActivations: [],
    earnOptimizerRuns: [],
    subscriptions: [],
    escrows: [],
    escrowReminderRuns: [],
    notifications: [],
    notificationPreferences: [],
    emailVerificationChallenges: [],
    notificationDeliveries: [],
    facilitatorEvents: [],
    indexedEvents: [],
    indexerCursors: [],
    paymentIntents: [],
    approvalRequests: []
  };
}

function normalizeStore(value: unknown): StoreShape {
  const store = {...emptyStore(), ...(value && typeof value === "object" ? value : {})} as StoreShape;
  store.facilitatorEvents = Array.isArray(store.facilitatorEvents) ? store.facilitatorEvents : [];
  store.indexedEvents = Array.isArray(store.indexedEvents) ? store.indexedEvents : [];
  store.indexerCursors = Array.isArray(store.indexerCursors) ? store.indexerCursors : [];
  store.paymentIntents = Array.isArray(store.paymentIntents) ? store.paymentIntents.map(normalizePaymentIntent) : [];
  store.notificationPreferences = Array.isArray(store.notificationPreferences)
    ? uniqueNotificationBindings(store.notificationPreferences.map(normalizeNotificationPreferences))
    : [];
  store.emailVerificationChallenges = Array.isArray(store.emailVerificationChallenges)
    ? store.emailVerificationChallenges.map(normalizeEmailVerificationChallenge).filter((item): item is EmailVerificationChallengeRecord => Boolean(item))
    : [];
  store.notificationDeliveries = Array.isArray(store.notificationDeliveries) ? store.notificationDeliveries.map(normalizeNotificationDelivery) : [];
  store.escrowReminderRuns = Array.isArray(store.escrowReminderRuns) ? store.escrowReminderRuns.map(normalizeEscrowReminderRun) : [];
  store.approvalRequests = Array.isArray(store.approvalRequests) ? store.approvalRequests.map(normalizeApprovalRequest) : [];
  store.automationRecipes = Array.isArray(store.automationRecipes) ? store.automationRecipes.map(normalizeAutomationRecipe) : [];
  store.automationRuns = Array.isArray(store.automationRuns) ? store.automationRuns.map(normalizeAutomationRun) : [];
  store.earnOptimizerRuns = Array.isArray(store.earnOptimizerRuns)
    ? store.earnOptimizerRuns.map(normalizeEarnOptimizerRun)
    : [];
  store.services = store.services.map((service) => ({
    ...service,
    manifest: service.manifest ?? defaultManifestForService(service.name, service.endpointHash),
    // Legacy services predating multi-chain settlement were all on Arc. Default
    // missing values to Arc's chain id so their fee verification stays correct.
    settlementChainId: service.settlementChainId ?? (service.chainServiceId !== null ? config.arc.chainId : null),
    archivedAt: service.archivedAt ?? null,
    archiveReason: service.archiveReason ?? null,
    trust: service.trust ?? null
  }));
  store.agents = store.agents.map((agent) => ({
    ...agent,
    walletKind: agent.walletKind === "external_eoa" ? "external_eoa" : "circle_developer",
    archivedAt: agent.archivedAt ?? null,
    archiveReason: agent.archiveReason ?? null,
    circleAccountType: agent.circleAccountType === "EOA" || agent.circleAccountType === "SCA" ? agent.circleAccountType : null,
    settlementMode: agent.settlementMode === "eoa_memo" || agent.settlementMode === "sca_direct" ? agent.settlementMode : null,
    chainWallets: normalizeAgentChainWallets(agent),
    policy: normalizeAgentPolicy(agent.policy)
  }));
  store.payments = store.payments.map(normalizePaymentRecord);
  store.subscriptions = store.subscriptions.map((subscription) => ({
    ...subscription,
    planName: subscription.planName ?? titleFromPlanId(subscription.plan),
    amountUsdc: Number(subscription.amountUsdc || 0),
    interval: subscription.interval ?? "month",
    txHash: subscription.txHash ?? null,
    chainId: subscription.chainId ?? null,
    activatedAt: subscription.activatedAt ?? (subscription.status === "active" ? subscription.createdAt : null),
    currentPeriodStart: subscription.currentPeriodStart ?? (subscription.status === "active" ? subscription.createdAt : null),
    currentPeriodEnd: subscription.currentPeriodEnd ?? null
  }));
  store.escrows = Array.isArray(store.escrows) ? store.escrows.map(normalizeEscrow) : [];
  return store;
}

function normalizeEarnOptimizerRun(value: EarnOptimizerRunRecord): EarnOptimizerRunRecord {
  const statuses = new Set<EarnOptimizerRunRecord["status"]>([
    "stay",
    "rebalance_recommended",
    "rebalanced",
    "skipped",
    "failed"
  ]);
  return {
    id: String(value.id ?? crypto.randomUUID()),
    profile: value.profile === "conservative" || value.profile === "growth" ? value.profile : "balanced",
    chainId: Number.isSafeInteger(Number(value.chainId)) ? Number(value.chainId) : config.arc.chainId,
    status: statuses.has(value.status) ? value.status : "failed",
    activeStrategyId: value.activeStrategyId === null ? null : Number(value.activeStrategyId),
    selectedStrategyId: value.selectedStrategyId === null ? null : Number(value.selectedStrategyId),
    activeProtocol: value.activeProtocol ?? null,
    selectedProtocol: value.selectedProtocol ?? null,
    reason: String(value.reason ?? ""),
    strategyCount: Math.max(0, Number(value.strategyCount || 0)),
    activeApyBps: value.activeApyBps === null ? null : Number(value.activeApyBps),
    selectedApyBps: value.selectedApyBps === null ? null : Number(value.selectedApyBps),
    strategyTelemetry: Array.isArray(value.strategyTelemetry)
      ? value.strategyTelemetry.map((item) => ({
          strategyId: Number(item.strategyId),
          assetsPerShare: item.assetsPerShare === null ? null : Number(item.assetsPerShare),
          observedAt: item.observedAt ?? value.createdAt ?? new Date().toISOString()
        }))
      : [],
    txHash: value.txHash ?? null,
    createdAt: value.createdAt ?? new Date().toISOString()
  };
}

function normalizePaymentRecord(payment: PaymentRecord): PaymentRecord {
  const grossAmountUsdc = payment.grossAmountUsdc ?? payment.amountUsdc;
  const facilitatorFeeBps = payment.facilitatorFeeBps ?? 0;
  const platformFeeUsdc = payment.platformFeeUsdc ?? roundUsdc(grossAmountUsdc * facilitatorFeeBps / 10_000);
  return {
    ...payment,
    grossAmountUsdc,
    platformFeeUsdc,
    publisherNetUsdc: payment.publisherNetUsdc ?? roundUsdc(grossAmountUsdc - platformFeeUsdc),
    memo: normalizeMemo(payment.memo) ?? null,
    external: payment.external ?? null
  };
}

function normalizePaymentIntent(intent: PaymentIntentRecord): PaymentIntentRecord {
  const now = new Date().toISOString();
  const status = normalizePaymentIntentStatus(intent.status);
  const amountUsdc = Number(intent.normalized?.amountUsdc || 0);
  const checks = Array.isArray(intent.policy?.checks) ? intent.policy.checks : [];
  const riskFlags = Array.isArray(intent.policy?.riskFlags) ? intent.policy.riskFlags : [];
  return {
    id: String(intent.id ?? crypto.randomUUID()),
    operatorAddress: String(intent.operatorAddress ?? ""),
    agentId: intent.agentId ?? null,
    agentWallet: intent.agentWallet ?? null,
    requestHash: typeof intent.requestHash === "string" ? intent.requestHash : "",
    status,
    source: {
      provider: "circle_agent_marketplace",
      serviceUrl: String(intent.source?.serviceUrl ?? ""),
      inspectedAt: validIsoOrNull(intent.source?.inspectedAt) ?? intent.createdAt ?? now
    },
    normalized: {
      serviceId: String(intent.normalized?.serviceId ?? ""),
      serviceName: String(intent.normalized?.serviceName ?? "Circle marketplace service"),
      description: String(intent.normalized?.description ?? "Circle x402 paid service"),
      amountUsdc: Number.isFinite(amountUsdc) ? roundUsdc(amountUsdc) : 0,
      payTo: String(intent.normalized?.payTo ?? ""),
      chain: String(intent.normalized?.chain ?? "BASE"),
      chainId: Number.isFinite(Number(intent.normalized?.chainId)) ? Number(intent.normalized?.chainId) : null,
      network: intent.normalized?.network ?? null,
      paymentScheme: intent.normalized?.paymentScheme ?? null,
      assetAddress: intent.normalized?.assetAddress ?? null,
      inputSchema: intent.normalized?.inputSchema ?? null
    },
    data: intent.data && typeof intent.data === "object" && !Array.isArray(intent.data) ? intent.data : {},
    policy: {
      allowed: Boolean(intent.policy?.allowed),
      reason: intent.policy?.reason ?? null,
      remediation: intent.policy?.remediation ?? null,
      dailySpentUsdc: Number(intent.policy?.dailySpentUsdc || 0),
      weeklySpentUsdc: Number(intent.policy?.weeklySpentUsdc || 0),
      monthlySpentUsdc: Number(intent.policy?.monthlySpentUsdc || 0),
      checks: checks.map(normalizePaymentIntentCheck),
      riskFlags: riskFlags.map(normalizePaymentIntentRiskFlag)
    },
    approval: {
      required: intent.approval?.required !== false,
      decidedBy: intent.approval?.decidedBy ?? null,
      decidedAt: validIsoOrNull(intent.approval?.decidedAt),
      note: intent.approval?.note ?? null,
      expiresAt: validIsoOrNull(intent.approval?.expiresAt)
    },
    execution: {
      paymentId: intent.execution?.paymentId ?? null,
      txHash: intent.execution?.txHash ?? null,
      resultSummary: intent.execution?.resultSummary ?? null,
      error: intent.execution?.error ?? null,
      executedAt: validIsoOrNull(intent.execution?.executedAt)
    },
    receiptId: intent.receiptId ?? intent.execution?.paymentId ?? null,
    createdAt: intent.createdAt ?? now,
    updatedAt: intent.updatedAt ?? intent.createdAt ?? now
  };
}

function normalizePaymentIntentStatus(value: unknown): PaymentIntentRecord["status"] {
  if (
    value === "pending_approval"
    || value === "approved"
    || value === "rejected"
    || value === "executing"
    || value === "settled"
    || value === "failed"
    || value === "policy_blocked"
    || value === "expired"
  ) return value;
  return "pending_approval";
}

function normalizePaymentIntentCheck(value: PaymentIntentRecord["policy"]["checks"][number]): PaymentIntentRecord["policy"]["checks"][number] {
  return {
    status: value?.status === "fail" ? "fail" : "pass",
    label: String(value?.label ?? "Payment check"),
    detail: String(value?.detail ?? "")
  };
}

function normalizePaymentIntentRiskFlag(value: PaymentIntentRecord["policy"]["riskFlags"][number]): PaymentIntentRecord["policy"]["riskFlags"][number] {
  const severity = value?.severity === "critical" || value?.severity === "warning" ? value.severity : "info";
  return {
    severity,
    label: String(value?.label ?? "Risk signal"),
    detail: String(value?.detail ?? "")
  };
}

function normalizeEscrow(escrow: EscrowRecord): EscrowRecord {
  return {
    ...escrow,
    chainEscrowId: escrow.chainEscrowId ?? null,
    performanceBondUsdc: Number(escrow.performanceBondUsdc || 0),
    platformFeeBps: Number(escrow.platformFeeBps || 0),
    platformFeeUsdc: Number(escrow.platformFeeUsdc || 0),
    counterpartyNetUsdc: Number(escrow.counterpartyNetUsdc || 0),
    deliverableUrl: escrow.deliverableUrl ?? null,
    verifierNotes: escrow.verifierNotes ?? null,
    txHash: escrow.txHash ?? null,
    fundedAt: escrow.fundedAt ?? null,
    submittedAt: escrow.submittedAt ?? null,
    verifiedAt: escrow.verifiedAt ?? null,
    releasedAt: escrow.releasedAt ?? null,
    reminder: escrow.reminder ? normalizeEscrowReminderSettings(escrow.reminder) : null
  };
}

function normalizeEscrowReminderSettings(value: EscrowReminderSettingsRecord): EscrowReminderSettingsRecord {
  const now = new Date().toISOString();
  const offsets = Array.isArray(value.offsetsHours) ? value.offsetsHours : [];
  return {
    enabled: value.enabled !== false,
    deadlineAt: validIsoOrNull(value.deadlineAt),
    offsetsHours: [...new Set(offsets.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 24 * 90))]
      .sort((a, b) => b - a)
      .slice(0, 8),
    channels: {
      inApp: value.channels?.inApp !== false,
      email: Boolean(value.channels?.email),
      telegram: Boolean(value.channels?.telegram),
      whatsapp: Boolean(value.channels?.whatsapp)
    },
    muted: Boolean(value.muted),
    snoozedUntil: validIsoOrNull(value.snoozedUntil),
    lastReminderAt: validIsoOrNull(value.lastReminderAt),
    nextReminderAt: validIsoOrNull(value.nextReminderAt),
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? value.createdAt ?? now
  };
}

function normalizeEscrowReminderRun(value: EscrowReminderRunRecord): EscrowReminderRunRecord {
  return {
    id: value.id ?? crypto.randomUUID(),
    escrowId: String(value.escrowId ?? ""),
    operatorAddress: String(value.operatorAddress ?? ""),
    role: value.role === "counterparty" ? "counterparty" : "creator",
    dueAt: validIsoOrNull(value.dueAt) ?? new Date().toISOString(),
    offsetHours: Number.isInteger(Number(value.offsetHours)) ? Number(value.offsetHours) : 0,
    status: value.status === "failed" || value.status === "skipped" ? value.status : "sent",
    summary: String(value.summary ?? ""),
    createdAt: value.createdAt ?? new Date().toISOString()
  };
}

function validIsoOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeApprovalRequest(request: AgentApprovalRequestRecord): AgentApprovalRequestRecord {
  const amountUsdc = Number(request.amountUsdc || 0);
  const units = Number(request.units || 0);
  return {
    ...request,
    agentWallet: request.agentWallet ?? null,
    amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : 0,
    units: Number.isInteger(units) && units > 0 ? units : 1,
    simulation: {
      allowed: Boolean(request.simulation?.allowed),
      reason: request.simulation?.reason ?? null,
      dailySpentUsdc: Number(request.simulation?.dailySpentUsdc || 0),
      weeklySpentUsdc: Number(request.simulation?.weeklySpentUsdc || 0),
      monthlySpentUsdc: Number(request.simulation?.monthlySpentUsdc || 0)
    },
    status: ["pending", "approved", "rejected", "expired"].includes(request.status) ? request.status : "pending",
    note: request.note ?? null,
    updatedAt: request.updatedAt ?? request.createdAt,
    decidedAt: request.decidedAt ?? null,
    expiresAt: request.expiresAt ?? null
  };
}

function normalizeAutomationRecipe(recipe: AgentAutomationRecipeRecord): AgentAutomationRecipeRecord {
  return {
    id: String(recipe.id ?? crypto.randomUUID()),
    operatorAddress: String(recipe.operatorAddress ?? ""),
    agentId: recipe.agentId ?? null,
    name: String(recipe.name ?? "Automation recipe"),
    description: String(recipe.description ?? ""),
    trigger: normalizeAutomationTrigger(recipe.trigger),
    action: recipe.action === "pause_agent" ? "pause_agent" : "notify",
    params: normalizeAutomationParams(recipe.params),
    active: recipe.active !== false,
    runCount: Number.isFinite(Number(recipe.runCount)) ? Number(recipe.runCount) : 0,
    lastTriggeredAt: recipe.lastTriggeredAt ?? null,
    lastRunAt: recipe.lastRunAt ?? null,
    lastRunReason: recipe.lastRunReason ?? null,
    createdAt: recipe.createdAt ?? new Date().toISOString(),
    updatedAt: recipe.updatedAt ?? recipe.createdAt ?? new Date().toISOString()
  };
}

function normalizeAutomationRun(run: AgentAutomationRunRecord): AgentAutomationRunRecord {
  return {
    id: String(run.id ?? crypto.randomUUID()),
    recipeId: String(run.recipeId ?? ""),
    operatorAddress: String(run.operatorAddress ?? ""),
    agentId: run.agentId ?? null,
    trigger: normalizeAutomationTrigger(run.trigger),
    action: run.action === "pause_agent" ? "pause_agent" : "notify",
    status: run.status === "matched" || run.status === "failed" || run.status === "skipped" ? run.status : "skipped",
    summary: String(run.summary ?? ""),
    createdAt: run.createdAt ?? new Date().toISOString()
  };
}

function normalizeAutomationTrigger(trigger: unknown): AgentAutomationTrigger {
  if (
    trigger === "daily_spend_threshold"
    || trigger === "failed_payment_burst"
    || trigger === "pending_approval_expiring"
    || trigger === "policy_expiring"
    || trigger === "large_receipt"
    || trigger === "weekly_summary"
  ) return trigger;
  return "daily_spend_threshold";
}

function normalizeAutomationParams(params: AgentAutomationRecipeRecord["params"]): AgentAutomationRecipeRecord["params"] {
  const record = params && typeof params === "object" ? params : {};
  return {
    thresholdUsdc: optionalNumberParam(record.thresholdUsdc),
    thresholdPercent: optionalNumberParam(record.thresholdPercent),
    failureCount: optionalIntegerParam(record.failureCount),
    windowHours: optionalIntegerParam(record.windowHours),
    expiresWithinHours: optionalIntegerParam(record.expiresWithinHours),
    minAmountUsdc: optionalNumberParam(record.minAmountUsdc),
    cooldownHours: optionalIntegerParam(record.cooldownHours)
  };
}

function optionalNumberParam(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? roundUsdc(parsed) : undefined;
}

function optionalIntegerParam(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeNotificationPreferences(value: NotificationPreferencesRecord): NotificationPreferencesRecord {
  const now = new Date().toISOString();
  const operatorAddress = typeof value.operatorAddress === "string" ? value.operatorAddress : "";
  const telegramLink = value.telegramLink && typeof value.telegramLink === "object"
    ? {
        code: typeof value.telegramLink.code === "string" ? value.telegramLink.code : "",
        status: value.telegramLink.status === "connected" ? "connected" as const : "pending" as const,
        chatId: typeof value.telegramLink.chatId === "string" && value.telegramLink.chatId.trim() ? value.telegramLink.chatId.trim() : null,
        username: typeof value.telegramLink.username === "string" && value.telegramLink.username.trim() ? value.telegramLink.username.trim() : null,
        expiresAt: typeof value.telegramLink.expiresAt === "string" && value.telegramLink.expiresAt.trim() ? value.telegramLink.expiresAt.trim() : null,
        updatedAt: value.telegramLink.updatedAt ?? value.updatedAt ?? now
      }
    : null;
  return {
    operatorAddress,
    email: normalizeNotificationEmail(value.email),
    emailVerifiedAt: normalizeIsoTimestamp(value.emailVerifiedAt),
    whatsapp: typeof value.whatsapp === "string" && value.whatsapp.trim() ? value.whatsapp.trim() : null,
    telegram: normalizeTelegramChatId(value.telegram),
    telegramLink,
    channels: {
      inApp: value.channels?.inApp !== false,
      email: Boolean(value.channels?.email),
      whatsapp: Boolean(value.channels?.whatsapp),
      telegram: Boolean(value.channels?.telegram)
    },
    events: {
      agentActions: value.events?.agentActions !== false,
      paymentReceipts: value.events?.paymentReceipts !== false,
      policyAlerts: value.events?.policyAlerts !== false,
      escrowUpdates: value.events?.escrowUpdates !== false
    },
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? value.createdAt ?? now
  };
}

function uniqueNotificationBindings(preferences: NotificationPreferencesRecord[]) {
  const emailOwners = new Map<string, string>();
  const telegramOwners = new Map<string, string>();
  return preferences.map((record) => {
    const operator = record.operatorAddress.toLowerCase();
    let email = record.email;
    let telegram = record.telegram;
    let telegramLink = record.telegramLink;
    const channels = {...record.channels};

    let emailVerifiedAt = record.emailVerifiedAt;

    if (email && emailVerifiedAt) {
      const owner = emailOwners.get(email);
      if (owner && owner !== operator) {
        email = null;
        emailVerifiedAt = null;
        channels.email = false;
      } else {
        emailOwners.set(email, operator);
      }
    } else {
      channels.email = false;
    }

    if (telegram) {
      const owner = telegramOwners.get(telegram);
      if (owner && owner !== operator) {
        telegram = null;
        telegramLink = null;
        channels.telegram = false;
      } else {
        telegramOwners.set(telegram, operator);
      }
    }

    return {...record, email, emailVerifiedAt, telegram, telegramLink, channels};
  });
}

function normalizeEmailVerificationChallenge(value: unknown): EmailVerificationChallengeRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<EmailVerificationChallengeRecord>;
  const operatorAddress = typeof record.operatorAddress === "string" ? record.operatorAddress : "";
  const email = normalizeNotificationEmail(record.email);
  const codeHash = typeof record.codeHash === "string" && /^[a-f0-9]{64}$/i.test(record.codeHash)
    ? record.codeHash.toLowerCase()
    : "";
  const expiresAt = normalizeIsoTimestamp(record.expiresAt);
  const lastSentAt = normalizeIsoTimestamp(record.lastSentAt);
  const createdAt = normalizeIsoTimestamp(record.createdAt);
  if (!operatorAddress || !email || !codeHash || !expiresAt || !lastSentAt || !createdAt) return null;
  return {
    operatorAddress,
    email,
    codeHash,
    attempts: Math.max(0, Number.isInteger(record.attempts) ? Number(record.attempts) : 0),
    maxAttempts: Math.max(1, Number.isInteger(record.maxAttempts) ? Number(record.maxAttempts) : 5),
    expiresAt,
    lastSentAt,
    createdAt
  };
}

function normalizeIsoTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function normalizeNotificationDelivery(value: NotificationDeliveryRecord): NotificationDeliveryRecord {
  return {
    id: value.id ?? crypto.randomUUID(),
    notificationId: String(value.notificationId ?? ""),
    operatorAddress: String(value.operatorAddress ?? ""),
    channel: value.channel === "whatsapp" || value.channel === "telegram" ? value.channel : "email",
    target: String(value.target ?? ""),
    status: value.status === "sent" || value.status === "failed" || value.status === "skipped" ? value.status : "skipped",
    provider: String(value.provider ?? "unknown"),
    reason: value.reason ?? null,
    createdAt: value.createdAt ?? new Date().toISOString()
  };
}

function titleFromPlanId(planId: string) {
  return planId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeAgentPolicy(policy: AgentPolicy): AgentPolicy {
  return {
    dailyLimitUsdc: Number(policy.dailyLimitUsdc || 0),
    transactionCapUsdc: Number(policy.transactionCapUsdc || 0),
    contractAllowlist: Array.isArray(policy.contractAllowlist) ? policy.contractAllowlist : [],
    recipientAllowlist: Array.isArray(policy.recipientAllowlist) ? policy.recipientAllowlist : [],
    active: policy.active !== false,
    txHash: policy.txHash ?? null,
    deployments: Array.isArray(policy.deployments)
      ? policy.deployments
        .filter((deployment) => Number.isInteger(deployment.chainId) && typeof deployment.txHash === "string" && deployment.txHash.startsWith("0x"))
        .map((deployment) => ({
          chainId: Number(deployment.chainId),
          txHash: deployment.txHash,
          policyRegistry: deployment.policyRegistry ?? null,
          updatedAt: deployment.updatedAt || new Date(0).toISOString()
        }))
      : policy.txHash
        ? [{
          chainId: config.arc.chainId,
          txHash: policy.txHash,
          policyRegistry: config.contracts.policyRegistry || null,
          updatedAt: new Date(0).toISOString()
        }]
        : [],
    v2: normalizePolicyV2(policy.v2)
  };
}

function normalizeAgentChainWallets(agent: AgentWalletRecord) {
  if (Array.isArray(agent.chainWallets) && agent.chainWallets.length > 0) {
    return agent.chainWallets
      .filter((wallet) => Number.isInteger(wallet.chainId))
      .map((wallet) => ({
        chainId: Number(wallet.chainId),
        chain: typeof wallet.chain === "string" && wallet.chain ? wallet.chain : `Chain ${wallet.chainId}`,
        circleBlockchain: typeof wallet.circleBlockchain === "string" ? wallet.circleBlockchain : "",
        address: wallet.address ?? null,
        circleWalletId: wallet.circleWalletId ?? null,
        status: wallet.status || "circle_wallet_pending_address",
        updatedAt: wallet.updatedAt || agent.createdAt
      }));
  }

  if (!agent.circleWalletId && !agent.address) return [];
  return [{
    chainId: config.arc.chainId,
    chain: "Arc Testnet",
    circleBlockchain: "ARC-TESTNET",
    address: agent.address ?? null,
    circleWalletId: agent.circleWalletId ?? null,
    status: agent.circleWalletStatus || "circle_wallet_pending_address",
    updatedAt: agent.createdAt
  }];
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
  if (marker.includes("wallet risk") || marker.includes("approval scan")) return manifestTemplateForKind("wallet_risk_approval_scan");
  if (marker.includes("wallet activity") || marker.includes("wallet summary")) {
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
    return manifestTemplateForKind("grant_application_reviewer");
  }
  if (marker.includes("meeting") || marker.includes("brief")) return manifestTemplateForKind("meeting_brief");
  if (marker.includes("arc builder") || marker.includes("builder research")) return manifestTemplateForKind("arc_builder_research");
  if (marker.includes("domain") || marker.includes("name research")) return manifestTemplateForKind("domain_name_research");
  if (marker.includes("social") || marker.includes("content audit")) return manifestTemplateForKind("social_content_audit");
  if (marker.includes("stablecoin route") || marker.includes("route report")) return manifestTemplateForKind("stablecoin_route_report");
  if (marker.includes("policy risk") || marker.includes("agent policy review")) return manifestTemplateForKind("policy_risk_review");
  if (marker.includes("launch readiness") || marker.includes("launch check")) return manifestTemplateForKind("launch_readiness_check");
  if (marker.includes("x402 integration") || marker.includes("integration planner")) return manifestTemplateForKind("x402_integration_planner");
  if (marker.includes("transaction preflight") || marker.includes("agent preflight") || marker.includes("preflight simulation")) return manifestTemplateForKind("agent_transaction_preflight");
  if (marker.includes("contract interaction") || marker.includes("interaction risk")) return manifestTemplateForKind("contract_interaction_risk_scan");
  if (marker.includes("invoice") || marker.includes("collection agent")) return manifestTemplateForKind("invoice_collection_agent");
  if (marker.includes("escrow milestone") || marker.includes("milestone monitor")) return manifestTemplateForKind("escrow_milestone_monitor");
  if (marker.includes("counterparty") || marker.includes("compliance screen")) return manifestTemplateForKind("counterparty_compliance_screen");
  if (marker.includes("liquidation") || marker.includes("margin risk")) return manifestTemplateForKind("liquidation_risk_monitor");
  if (marker.includes("vault apy") || marker.includes("apy monitor")) return manifestTemplateForKind("vault_apy_monitor");
  if (marker.includes("subscription payment") || marker.includes("recurring payment")) return manifestTemplateForKind("subscription_payment_agent");
  if (marker.includes("publisher revenue") || marker.includes("revenue intelligence")) return manifestTemplateForKind("publisher_revenue_intelligence");
  if (marker.includes("dao") || marker.includes("grant payout")) return manifestTemplateForKind("dao_grant_payout_agent");
  if (marker.includes("swap route") || marker.includes("quote agent")) return manifestTemplateForKind("swap_route_quote_agent");
  return manifestTemplateForKind("generic");
}

function manifestTemplateForKind(kind: ServiceManifest["kind"]): ServiceManifest {
  if (kind === "website_analyzer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a website URL and returns page title, metadata, links, headings, and a short readable summary.",
      inputSchema: [{name: "url", label: "Website URL", type: "url", required: true, placeholder: "https://example.com"}],
      outputSchema: ["title", "description", "summary", "headings", "links", "wordCount"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "github_repo_analyzer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a public GitHub repository and returns activity, language, license, popularity, and README signal.",
      inputSchema: [{name: "repo", label: "GitHub repository", type: "text", required: true, placeholder: "owner/repo or GitHub URL"}],
      outputSchema: ["repo", "description", "stars", "forks", "openIssues", "license", "signal"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "x_account_analyzer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a public X account when API credits are available and returns metrics, account signal, and score.",
      inputSchema: [{name: "handle", label: "X account", type: "text", required: true, placeholder: "@username"}],
      outputSchema: ["account", "metrics", "score", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "contract_safety_check") {
    return {
      kind,
      version: "1.0.0",
      description: "Checks a contract address and returns a safety checklist before it is used in agent policy.",
      inputSchema: [{name: "contract", label: "Contract address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["contract", "riskLevel", "checks", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "wallet_activity_summary") {
    return {
      kind,
      version: "1.0.0",
      description: "Summarizes wallet risk notes and recommended agent recipient policy.",
      inputSchema: [{name: "wallet", label: "Wallet address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["wallet", "riskLevel", "summary", "recommendedPolicy"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "landing_page_copy_reviewer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews landing page copy or a URL for clarity, conversion, and CTA quality.",
      inputSchema: [{name: "url", label: "URL or page copy", type: "text", required: true, placeholder: "https://example.com or paste copy"}],
      outputSchema: ["score", "issues", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "grant_application_reviewer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a grant application summary for infrastructure clarity, revenue proof, and ecosystem fit.",
      inputSchema: [{name: "application", label: "Application summary", type: "text", required: true, placeholder: "Paste your grant summary"}],
      outputSchema: ["score", "strengths", "gaps", "recommendations"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "meeting_brief") {
    return {
      kind,
      version: "1.0.0",
      description: "Turns a meeting goal into a concise prep brief with agenda, context, questions, and follow-up actions.",
      inputSchema: [{name: "brief", label: "Meeting goal", type: "text", required: true, placeholder: "Discuss Arc x402 integration with a wallet team"}],
      outputSchema: ["summary", "agenda", "questions", "followUps"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "arc_builder_research") {
    return {
      kind,
      version: "1.0.0",
      description: "Researches an Arc builder, project, or integration idea and returns fit, proof points, and collaboration angles.",
      inputSchema: [{name: "target", label: "Builder or project", type: "text", required: true, placeholder: "Project name, URL, or wallet"}],
      outputSchema: ["summary", "arcFit", "questions", "integrationIdeas"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "domain_name_research") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a domain or product name for positioning, trust, and launch-readiness signals.",
      inputSchema: [{name: "domain", label: "Domain or name", type: "text", required: true, placeholder: "nexora.finance"}],
      outputSchema: ["domain", "score", "risks", "suggestions", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "social_content_audit") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a post, thread draft, or announcement and returns clarity, audience fit, and CTA improvements.",
      inputSchema: [{name: "content", label: "Post or thread draft", type: "text", required: true, placeholder: "Paste post copy or announcement"}],
      outputSchema: ["score", "issues", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "stablecoin_route_report") {
    return {
      kind,
      version: "1.0.0",
      description: "Summarizes a stablecoin route, swap, bridge, or Save/Earn flow for cost, risk, and integration readiness.",
      inputSchema: [{name: "route", label: "Route or flow", type: "text", required: true, placeholder: "USDC on Arc to EURC using Synthra"}],
      outputSchema: ["route", "riskLevel", "checks", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "policy_risk_review") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews agent policy settings and returns risk notes, suggested caps, and approval recommendations.",
      inputSchema: [{name: "policy", label: "Policy details", type: "text", required: true, placeholder: "Daily 100 USDC, tx cap 20, allow x402 ledger"}],
      outputSchema: ["riskLevel", "checks", "recommendedPolicy", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "launch_readiness_check") {
    return {
      kind,
      version: "1.0.0",
      description: "Checks a product launch plan for docs, demo, contracts, receipts, security notes, and community-readiness.",
      inputSchema: [{name: "launch", label: "Launch plan", type: "text", required: true, placeholder: "Paste launch plan, website, or demo checklist"}],
      outputSchema: ["score", "strengths", "gaps", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "x402_integration_planner") {
    return {
      kind,
      version: "1.0.0",
      description: "Creates a practical x402 integration checklist for a paid API, including requirements, SDK wiring, and settlement flow.",
      inputSchema: [{name: "api", label: "API description", type: "text", required: true, placeholder: "Paid repo analyzer endpoint in Next.js"}],
      outputSchema: ["summary", "steps", "requirements", "securityNotes"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "wallet_risk_approval_scan") {
    return {
      kind,
      version: "1.0.0",
      description: "Scans full historical USDC Approval logs through configured RPCs, then checks current allowance exposure before an agent pays or interacts.",
      inputSchema: [{name: "wallet", label: "Wallet address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["wallet", "riskLevel", "live", "providerStatus", "metrics", "exposure", "chains", "approvals", "recommendedPolicy", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "agent_transaction_preflight") {
    return {
      kind,
      version: "1.0.0",
      description: "Runs a live transaction preflight before an agent signs or submits a contract call, using Tenderly when configured or chain RPC simulation for supported networks.",
      inputSchema: [{
        name: "transaction",
        label: "Transaction JSON",
        type: "text",
        required: true,
        placeholder: "{\"chainId\":5042002,\"from\":\"0x...\",\"to\":\"0x...\",\"data\":\"0x\",\"value\":\"0\",\"gas\":\"180000\"}"
      }],
      outputSchema: ["status", "decision", "provider", "live", "gasUsed", "checks", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "contract_interaction_risk_scan") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a target contract and intended action before an agent signs, approves, swaps, pays, or adds it to allowlists.",
      inputSchema: [{name: "interaction", label: "Contract and action", type: "text", required: true, placeholder: "0x... approve 25 USDC for x402 settlement"}],
      outputSchema: ["contract", "action", "riskLevel", "checks", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "invoice_collection_agent") {
    return {
      kind,
      version: "1.0.0",
      description: "Turns invoice details into a USDC collection workflow with reminders, receipt checks, and follow-up actions.",
      inputSchema: [{name: "invoice", label: "Invoice details", type: "text", required: true, placeholder: "Client, amount, due date, wallet, and deliverable"}],
      outputSchema: ["invoice", "amountUsdc", "dueDate", "actions", "reminders", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "escrow_milestone_monitor") {
    return {
      kind,
      version: "1.0.0",
      description: "Monitors escrow milestones, evidence, deadline risk, and release/refund recommendations while keeping final approval with users.",
      inputSchema: [{name: "escrow", label: "Escrow terms", type: "text", required: true, placeholder: "Milestones, due dates, amount, parties, and evidence links"}],
      outputSchema: ["milestones", "riskLevel", "reminders", "recommendedActions", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "counterparty_compliance_screen") {
    return {
      kind,
      version: "1.0.0",
      description: "Screens a wallet or counterparty with live chain telemetry, local Nexora activity, and explicit KYT provider readiness.",
      inputSchema: [{name: "counterparty", label: "Wallet or counterparty", type: "text", required: true, placeholder: "0x... or company/payment context"}],
      outputSchema: ["counterparty", "wallet", "decision", "live", "riskLevel", "metrics", "localActivity", "providerStatus", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "liquidation_risk_monitor") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews DeFi position details and produces liquidation-risk triggers, alert thresholds, and agent-safe recommendations.",
      inputSchema: [{name: "position", label: "Position details", type: "text", required: true, placeholder: "Protocol, wallet, collateral, debt, health factor, chain"}],
      outputSchema: ["riskLevel", "healthFactor", "thresholds", "alerts", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "vault_apy_monitor") {
    return {
      kind,
      version: "1.0.0",
      description: "Monitors USDC yield opportunities from live DeFiLlama market data and returns risk notes without enabling execution.",
      inputSchema: [{name: "vault", label: "Vault or strategy details", type: "text", required: true, placeholder: "USDC yield opportunity on Base, Arbitrum, or Arc"}],
      outputSchema: ["vault", "apy", "riskLevel", "providerStatus", "monitoring", "candidates", "risks", "checks", "rebalanceTriggers", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "subscription_payment_agent") {
    return {
      kind,
      version: "1.0.0",
      description: "Creates a policy-controlled recurring USDC payment plan with spend caps, approval rules, and receipt expectations.",
      inputSchema: [{name: "subscription", label: "Subscription terms", type: "text", required: true, placeholder: "Vendor, amount, interval, payee wallet, approval threshold"}],
      outputSchema: ["payee", "amountUsdc", "interval", "policy", "approvalRules", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "publisher_revenue_intelligence") {
    return {
      kind,
      version: "1.0.0",
      description: "Analyzes publisher service revenue, conversion, failed payments, fees, and pricing opportunities for x402 APIs.",
      inputSchema: [{name: "publisher", label: "Publisher or service details", type: "text", required: true, placeholder: "Publisher wallet, service id, or revenue notes"}],
      outputSchema: ["publisher", "metrics", "pricingSignals", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "dao_grant_payout_agent") {
    return {
      kind,
      version: "1.0.0",
      description: "Builds a DAO or grant payout plan with milestone checks, recipient policy, approval requirements, and receipt tracking.",
      inputSchema: [{name: "payout", label: "Payout plan", type: "text", required: true, placeholder: "Recipients, amounts, milestones, due dates, approval rules"}],
      outputSchema: ["recipients", "totalUsdc", "milestones", "approvalRules", "risks", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "swap_route_quote_agent") {
    return {
      kind,
      version: "1.0.0",
      description: "Prepares a same-chain swap or route quote review with slippage, quote freshness, asset decimals, and execution checks.",
      inputSchema: [{name: "quote", label: "Swap or route request", type: "text", required: true, placeholder: "Swap 100 USDC to EURC on Arc with 1% slippage"}],
      outputSchema: ["route", "amount", "slippageBps", "riskLevel", "checks", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  return {
    kind,
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
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };
  store.notifications.unshift(record);
  store.notifications = store.notifications.slice(0, 200);
  return record;
}

async function readDatabaseStore() {
  await ensureDatabase();
  const result = await database().query("select value from app_store where key = $1", [STORE_KEY]);
  const rawBlob = result.rows[0]?.value ?? null;
  const store = rawBlob ? normalizeStore(rawBlob) : emptyStore();

  if (!result.rows[0]) {
    await database().query("insert into app_store (key, value) values ($1, $2::jsonb) on conflict (key) do nothing", [
      STORE_KEY,
      JSON.stringify(blobPersistShape(store))
    ]);
  }

  // Money path (task 3): payments and payment_intents are table-managed, not
  // blob-managed. If a legacy blob still carries them, migrate once into the
  // tables and strip them from the blob so the tables are the sole source of
  // truth. Then hydrate the in-memory store arrays from the tables so every
  // existing read caller (appSnapshot, policy engine, router) is unchanged.
  await migrateBlobMoneyRecords(rawBlob);
  store.payments = await loadPaymentsFromTable();
  store.paymentIntents = await loadPaymentIntentsFromTable();

  return store;
}

async function updateDatabaseStore<T>(mutate: (store: StoreShape) => T | Promise<T>) {
  await ensureDatabase();
  const client = await database().connect();

  try {
    await client.query("begin");
    const selected = await client.query("select value from app_store where key = $1 for update", [STORE_KEY]);
    const store = selected.rows[0]?.value ? normalizeStore(selected.rows[0].value) : emptyStore();
    // Payments/intents are hydrated from their tables so read-after-write inside
    // the callback sees current money-path state. Writes to these arrays inside
    // a plain updateStore callback are NOT persisted in DB mode — the money path
    // must use the dedicated helpers below. The blob write strips them.
    store.payments = await loadPaymentsFromTable(client);
    store.paymentIntents = await loadPaymentIntentsFromTable(client);
    const result = await mutate(store);
    await syncNotificationBindingRows(client, store.notificationPreferences);
    await client.query(
      `insert into app_store (key, value, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [STORE_KEY, JSON.stringify(blobPersistShape(store))]
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

// Strip table-managed collections before persisting the app_store blob so the
// tables remain the single source of truth for the money path.
function blobPersistShape(store: StoreShape): StoreShape {
  return {...store, payments: [], paymentIntents: []};
}

let blobMoneyMigrated = false;

async function migrateBlobMoneyRecords(rawBlob: unknown) {
  if (blobMoneyMigrated) return;
  const blob = rawBlob && typeof rawBlob === "object" ? (rawBlob as Partial<StoreShape>) : null;
  const legacyPayments = Array.isArray(blob?.payments) ? blob!.payments : [];
  const legacyIntents = Array.isArray(blob?.paymentIntents) ? blob!.paymentIntents : [];
  if (legacyPayments.length === 0 && legacyIntents.length === 0) {
    blobMoneyMigrated = true;
    return;
  }
  const client = await database().connect();
  try {
    await client.query("begin");
    for (const payment of legacyPayments.map(normalizePaymentRecord)) {
      await insertPaymentRow(client, payment, {onConflictDoNothing: true});
    }
    for (const intent of legacyIntents.map(normalizePaymentIntent)) {
      await insertPaymentIntentRow(client, intent, {onConflictDoNothing: true});
    }
    // Strip the migrated arrays from the blob so they are not re-migrated and
    // the tables are authoritative.
    const selected = await client.query("select value from app_store where key = $1 for update", [STORE_KEY]);
    if (selected.rows[0]?.value) {
      const stripped = {...selected.rows[0].value, payments: [], paymentIntents: []};
      await client.query("update app_store set value = $2::jsonb, updated_at = now() where key = $1", [
        STORE_KEY,
        JSON.stringify(stripped)
      ]);
    }
    await client.query("commit");
    blobMoneyMigrated = true;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function loadPaymentsFromTable(client?: Pool | PoolClient): Promise<PaymentRecord[]> {
  const db = client ?? database();
  const result = await db.query("select record from payments order by created_at asc");
  return result.rows.map((row) => normalizePaymentRecord(row.record));
}

async function loadPaymentIntentsFromTable(client?: Pool | PoolClient): Promise<PaymentIntentRecord[]> {
  const db = client ?? database();
  const result = await db.query("select record from payment_intents order by created_at desc");
  return result.rows.map((row) => normalizePaymentIntent(row.record));
}

async function insertPaymentRow(
  client: Pool | PoolClient,
  payment: PaymentRecord,
  options?: {onConflictDoNothing?: boolean}
) {
  const conflict = options?.onConflictDoNothing ? "on conflict (id) do nothing" : "";
  await client.query(
    `insert into payments
       (id, request_hash, status, agent_id, payer, publisher_address, service_id, amount_usdc, units, settled_at, created_at, record)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ${conflict}`,
    [
      payment.id,
      payment.requestHash,
      payment.status,
      payment.agentId ?? null,
      payment.payer,
      payment.publisherAddress,
      payment.serviceId,
      payment.amountUsdc,
      payment.units,
      payment.settledAt ?? null,
      payment.createdAt,
      JSON.stringify(payment)
    ]
  );
}

async function insertPaymentIntentRow(
  client: Pool | PoolClient,
  intent: PaymentIntentRecord,
  options?: {onConflictDoNothing?: boolean}
) {
  const conflict = options?.onConflictDoNothing ? "on conflict (id) do nothing" : "";
  await client.query(
    `insert into payment_intents
       (id, operator_address, agent_id, request_hash, status, created_at, updated_at, record)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ${conflict}`,
    [
      intent.id,
      intent.operatorAddress,
      intent.agentId ?? null,
      intent.requestHash,
      intent.status,
      intent.createdAt,
      intent.updatedAt,
      JSON.stringify(intent)
    ]
  );
}

function updatePaymentRowColumns(payment: PaymentRecord) {
  return {
    text: `update payments set
       status = $2, settled_at = $3, amount_usdc = $4, record = $5::jsonb
     where id = $1`,
    values: [payment.id, payment.status, payment.settledAt ?? null, payment.amountUsdc, JSON.stringify(payment)]
  };
}

function updatePaymentIntentRowColumns(intent: PaymentIntentRecord) {
  return {
    text: `update payment_intents set
       status = $2, updated_at = $3, record = $4::jsonb
     where id = $1`,
    values: [intent.id, intent.status, intent.updatedAt, JSON.stringify(intent)]
  };
}

async function ensureDatabase() {
  if (databaseReady) return;
  await ensureStoreTable(database());
  await ensureMoneyPathTables(database());
  await ensureNotificationBindingTable(database());
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

// Money path (task 3): relational tables for payments and payment_intents.
// Kept in sync with src/db/schema.sql. Created idempotently on first DB use.
async function ensureMoneyPathTables(client: Pool | PoolClient) {
  await client.query(`
    create table if not exists payments (
      id text primary key,
      request_hash text not null,
      status text not null,
      agent_id text,
      payer text not null,
      publisher_address text not null,
      service_id text not null,
      amount_usdc numeric not null,
      units numeric not null,
      settled_at timestamptz,
      created_at timestamptz not null default now(),
      record jsonb not null
    )
  `);
  await client.query(`
    create unique index if not exists payments_request_hash_active
      on payments (request_hash)
      where status in ('authorized', 'settled')
  `);
  await client.query(`
    create index if not exists payments_agent_settled
      on payments (agent_id, status, settled_at)
  `);
  await client.query(`
    create table if not exists payment_intents (
      id text primary key,
      operator_address text not null,
      agent_id text,
      request_hash text not null,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      record jsonb not null
    )
  `);
  await client.query(`
    create index if not exists payment_intents_operator
      on payment_intents (operator_address, created_at desc)
  `);
}

async function ensureNotificationBindingTable(client: Pool | PoolClient) {
  await client.query(`
    create table if not exists notification_channel_bindings (
      store_key text not null,
      channel text not null check (channel in ('email', 'telegram')),
      normalized_target text not null,
      operator_address text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (store_key, channel, normalized_target),
      unique (store_key, operator_address, channel)
    )
  `);
}

async function syncNotificationBindingRows(
  client: PoolClient,
  preferences: NotificationPreferencesRecord[]
) {
  const normalized = uniqueNotificationBindings(preferences.map(normalizeNotificationPreferences));
  await client.query("delete from notification_channel_bindings where store_key = $1", [STORE_KEY]);
  for (const record of normalized) {
    const bindings = [
      ["email", record.emailVerifiedAt ? record.email : null],
      ["telegram", record.telegram]
    ] as const;
    for (const [channel, target] of bindings) {
      if (!target) continue;
      await client.query(
        `insert into notification_channel_bindings
           (store_key, channel, normalized_target, operator_address, updated_at)
         values ($1, $2, $3, $4, now())`,
        [STORE_KEY, channel, target, record.operatorAddress.toLowerCase()]
      );
    }
  }
}

function database() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: isLocalDatabase(config.databaseUrl) ? undefined : {rejectUnauthorized: config.databaseSslRejectUnauthorized}
    });
  }
  return pool;
}

function isLocalDatabase(databaseUrl: string) {
  return /localhost|127\.0\.0\.1/.test(databaseUrl);
}
