import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {Pool, type PoolClient} from "pg";
import {config} from "./config.js";
import {normalizeMemo, type NexoraStructuredMemo} from "./memos.js";
import {normalizePolicyV2} from "./policies/engine.js";

export type AgentPolicy = {
  dailyLimitUsdc: number;
  transactionCapUsdc: number;
  contractAllowlist: string[];
  recipientAllowlist: string[];
  active: boolean;
  txHash?: string | null;
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

export type AgentWalletRecord = {
  id: string;
  operatorAddress: string;
  arcName: string | null;
  address: string | null;
  circleWalletStatus: string;
  circleWalletSetId?: string | null;
  circleWalletId?: string | null;
  circleAccountType?: "EOA" | "SCA" | null;
  settlementMode?: "eoa_memo" | "sca_direct" | null;
  createdAt: string;
  archivedAt?: string | null;
  archiveReason?: string | null;
  policy: AgentPolicy;
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
  memo?: NexoraStructuredMemo | null;
  txHash?: string | null;
  createdAt: string;
  settledAt?: string | null;
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
  automationRecipes: AgentAutomationRecipeRecord[];
  automationRuns: AgentAutomationRunRecord[];
  earnActivations: EarnActivationRecord[];
  subscriptions: SubscriptionRecord[];
  escrows: EscrowRecord[];
  escrowReminderRuns: EscrowReminderRunRecord[];
  notifications: NotificationRecord[];
  notificationPreferences: NotificationPreferencesRecord[];
  notificationDeliveries: NotificationDeliveryRecord[];
  facilitatorEvents: FacilitatorEventRecord[];
  indexedEvents: IndexedChainEventRecord[];
  indexerCursors: IndexerCursorRecord[];
  approvalRequests: AgentApprovalRequestRecord[];
};

const SEEDED_SERVICE_IDS = new Set([
  "nexora-website-growth-analyzer",
  "nexora-github-repo-analyzer",
  "nexora-x-account-analyzer",
  "nexora-contract-safety-check",
  "nexora-wallet-activity-summary",
  "nexora-landing-page-copy-reviewer",
  "nexora-grant-application-reviewer",
  "nexora-meeting-brief",
  "nexora-arc-builder-research",
  "nexora-domain-name-research",
  "nexora-social-content-audit",
  "nexora-stablecoin-route-report",
  "nexora-policy-risk-review",
  "nexora-launch-readiness-check",
  "nexora-x402-integration-planner"
]);

const SEEDED_ENDPOINT_HASHES = new Set([
  "website-analyzer-v1",
  "github-repo-analyzer-v1",
  "x-account-analyzer-v1",
  "contract-safety-check-v1",
  "wallet-activity-summary-v1",
  "landing-page-copy-reviewer-v1",
  "grant-application-reviewer-v1",
  "meeting-brief-v1",
  "arc-builder-research-v1",
  "domain-name-research-v1",
  "social-content-audit-v1",
  "stablecoin-route-report-v1",
  "policy-risk-review-v1",
  "launch-readiness-check-v1",
  "x402-integration-planner-v1"
]);

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
  const visibleAgentWallets = new Set(visibleAgents.map((agent) => agent.address?.toLowerCase()).filter(Boolean) as string[]);
  const visiblePayments = store.payments.filter((payment) => isVisiblePayment(payment, {visibleServiceIds, visibleAgentIds, visibleAgentWallets}));
  const payments = operator
    ? visiblePayments.filter((payment) => payment.payer.toLowerCase() === operator || payment.publisherAddress.toLowerCase() === operator)
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
  const completedTasks = store.earnActivations.filter((activation) => !operator || activation.operatorAddress.toLowerCase() === operator).length;
  const ecosystemContributions = servicesWithTrust.filter((service) => !operator || service.publisherAddress.toLowerCase() === operator).length;
  const successfulPayments = settledPayments.length;
  const indexedStats = summarizeIndexedEvents(store.indexedEvents);
  const indexedAvailable = indexedStats.indexedEvents > 0;

  return {
    agents,
    services: servicesWithTrust,
    payments,
    approvalRequests,
    automationRecipes,
    automationRuns,
    escrowReminderRuns,
    subscriptions,
    escrows,
    notifications: notifications.slice(0, 20),
    notificationPreferences,
    notificationDeliveries,
    riskAlerts: computeRiskAlerts({agents: scopedAgents, payments, approvalRequests}),
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
      earnRoutes: indexedAvailable ? indexedStats.saveEarnDeposits : store.earnActivations.length,
      policySaves: indexedStats.policySaves > 0 ? indexedStats.policySaves : (operator ? agents : store.agents).filter((agent) => agent.policy.txHash).length,
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

    if (agent.policy.v2?.requireOnchainPolicy && !agent.policy.txHash) {
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
  return payment.agentId === agent.id || Boolean(agent.address && payment.agentWallet?.toLowerCase() === agent.address.toLowerCase());
}

function startOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
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
    circleAccountType: agent.circleAccountType ?? null,
    settlementMode: agent.settlementMode ?? null,
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

export function isSeededService(service: Pick<ServiceRecord, "id" | "endpointHash">) {
  return SEEDED_SERVICE_IDS.has(service.id) || SEEDED_ENDPOINT_HASHES.has(service.endpointHash);
}

export function isVisibleService(service: ServiceRecord) {
  return !isArchivedService(service) && service.active !== false && service.chainServiceId !== null;
}

export function visibleServicesForStore(services: ServiceRecord[]) {
  const canonicalByEndpoint = new Map<string, ServiceRecord>();

  for (const service of services) {
    if (!isVisibleService(service)) continue;
    const key = serviceEndpointKey(service);
    const current = canonicalByEndpoint.get(key);
    if (!current || shouldPreferVisibleService(service, current)) {
      canonicalByEndpoint.set(key, service);
    }
  }

  return services.filter((service) => isVisibleService(service) && canonicalByEndpoint.get(serviceEndpointKey(service)) === service);
}

function serviceEndpointKey(service: Pick<ServiceRecord, "id" | "endpointHash">) {
  const endpointHash = service.endpointHash.trim().toLowerCase();
  return endpointHash || service.id;
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
  if (!scope.visibleServiceIds.has(payment.serviceId)) return false;
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
        if (isArchivedService(service) || isSeededService(service)) continue;
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
    const next = normalizeNotificationPreferences({
      ...current,
      email: input.email === undefined ? current.email : input.email,
      whatsapp: input.whatsapp === undefined ? current.whatsapp : input.whatsapp,
      telegram: input.telegram === undefined ? current.telegram : input.telegram,
      channels: {...current.channels, ...(input.channels ?? {})},
      events: {...current.events, ...(input.events ?? {})},
      updatedAt: now
    });
    const index = store.notificationPreferences.findIndex((item) => item.operatorAddress.toLowerCase() === lower);
    if (index >= 0) store.notificationPreferences[index] = next;
    else store.notificationPreferences.push(next);
    return next;
  });
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
    subscriptions: [],
    escrows: [],
    escrowReminderRuns: [],
    notifications: [],
    notificationPreferences: [],
    notificationDeliveries: [],
    facilitatorEvents: [],
    indexedEvents: [],
    indexerCursors: [],
    approvalRequests: []
  };
}

function normalizeStore(value: unknown): StoreShape {
  const store = {...emptyStore(), ...(value && typeof value === "object" ? value : {})} as StoreShape;
  store.facilitatorEvents = Array.isArray(store.facilitatorEvents) ? store.facilitatorEvents : [];
  store.indexedEvents = Array.isArray(store.indexedEvents) ? store.indexedEvents : [];
  store.indexerCursors = Array.isArray(store.indexerCursors) ? store.indexerCursors : [];
  store.notificationPreferences = Array.isArray(store.notificationPreferences) ? store.notificationPreferences.map(normalizeNotificationPreferences) : [];
  store.notificationDeliveries = Array.isArray(store.notificationDeliveries) ? store.notificationDeliveries.map(normalizeNotificationDelivery) : [];
  store.escrowReminderRuns = Array.isArray(store.escrowReminderRuns) ? store.escrowReminderRuns.map(normalizeEscrowReminderRun) : [];
  store.approvalRequests = Array.isArray(store.approvalRequests) ? store.approvalRequests.map(normalizeApprovalRequest) : [];
  store.automationRecipes = Array.isArray(store.automationRecipes) ? store.automationRecipes.map(normalizeAutomationRecipe) : [];
  store.automationRuns = Array.isArray(store.automationRuns) ? store.automationRuns.map(normalizeAutomationRun) : [];
  store.services = store.services.map((service) => ({
    ...service,
    manifest: service.manifest ?? defaultManifestForService(service.name, service.endpointHash),
    archivedAt: service.archivedAt ?? null,
    archiveReason: service.archiveReason ?? null,
    trust: service.trust ?? null
  }));
  store.services = mergeSeededServices(store.services);
  store.agents = store.agents.map((agent) => ({
    ...agent,
    archivedAt: agent.archivedAt ?? null,
    archiveReason: agent.archiveReason ?? null,
    circleAccountType: agent.circleAccountType === "EOA" || agent.circleAccountType === "SCA" ? agent.circleAccountType : null,
    settlementMode: agent.settlementMode === "eoa_memo" || agent.settlementMode === "sca_direct" ? agent.settlementMode : null,
    policy: normalizeAgentPolicy(agent.policy)
  }));
  store.payments = store.payments.map((payment) => {
    const grossAmountUsdc = payment.grossAmountUsdc ?? payment.amountUsdc;
    const facilitatorFeeBps = payment.facilitatorFeeBps ?? 0;
    const platformFeeUsdc = payment.platformFeeUsdc ?? roundUsdc(grossAmountUsdc * facilitatorFeeBps / 10_000);
    return {
      ...payment,
      grossAmountUsdc,
      platformFeeUsdc,
      publisherNetUsdc: payment.publisherNetUsdc ?? roundUsdc(grossAmountUsdc - platformFeeUsdc),
      memo: normalizeMemo(payment.memo) ?? null
    };
  });
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
    email: typeof value.email === "string" && value.email.trim() ? value.email.trim().toLowerCase() : null,
    whatsapp: typeof value.whatsapp === "string" && value.whatsapp.trim() ? value.whatsapp.trim() : null,
    telegram: typeof value.telegram === "string" && value.telegram.trim() ? value.telegram.trim() : null,
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

function mergeSeededServices(existing: ServiceRecord[]) {
  const services = [...existing];
  const seen = new Set(services.map((service) => service.endpointHash));
  for (const service of seededServices()) {
    if (!seen.has(service.endpointHash)) {
      services.push(service);
      seen.add(service.endpointHash);
    }
  }
  return services;
}

function seededServices(): ServiceRecord[] {
  const publisherAddress = process.env.NEXORA_MARKETPLACE_PUBLISHER_ADDRESS || config.contracts.treasury || "0x0000000000000000000000000000000000000000";
  const createdAt = "2026-06-01T00:00:00.000Z";
  const seeds: Array<{
    id: string;
    name: string;
    endpointHash: string;
    pricePerUnitUsdc: number;
    kind: ServiceManifest["kind"];
    featured?: boolean;
    description?: string;
  }> = [
    {id: "nexora-website-growth-analyzer", name: "Website Growth Analyzer", endpointHash: "website-analyzer-v1", pricePerUnitUsdc: 0.025, kind: "website_analyzer", featured: true},
    {id: "nexora-github-repo-analyzer", name: "GitHub Repo Analyzer", endpointHash: "github-repo-analyzer-v1", pricePerUnitUsdc: 0.05, kind: "github_repo_analyzer", featured: true},
    {id: "nexora-x-account-analyzer", name: "X Account Analyzer", endpointHash: "x-account-analyzer-v1", pricePerUnitUsdc: 0.035, kind: "x_account_analyzer"},
    {id: "nexora-contract-safety-check", name: "Contract Safety Check", endpointHash: "contract-safety-check-v1", pricePerUnitUsdc: 0.015, kind: "contract_safety_check", featured: true},
    {id: "nexora-wallet-activity-summary", name: "Wallet Activity Summary", endpointHash: "wallet-activity-summary-v1", pricePerUnitUsdc: 0.015, kind: "wallet_activity_summary"},
    {id: "nexora-landing-page-copy-reviewer", name: "Landing Page Copy Reviewer", endpointHash: "landing-page-copy-reviewer-v1", pricePerUnitUsdc: 0.02, kind: "landing_page_copy_reviewer"},
    {id: "nexora-grant-application-reviewer", name: "Grant Application Reviewer", endpointHash: "grant-application-reviewer-v1", pricePerUnitUsdc: 0.03, kind: "grant_application_reviewer"},
    {id: "nexora-meeting-brief", name: "Meeting Brief Agent", endpointHash: "meeting-brief-v1", pricePerUnitUsdc: 0.02, kind: "meeting_brief", description: "Turn a meeting goal, wallet, project, or URL into a short prep brief with questions and follow-up actions."},
    {id: "nexora-arc-builder-research", name: "Arc Builder Research", endpointHash: "arc-builder-research-v1", pricePerUnitUsdc: 0.025, kind: "arc_builder_research", featured: true},
    {id: "nexora-domain-name-research", name: "Domain Name Research", endpointHash: "domain-name-research-v1", pricePerUnitUsdc: 0.015, kind: "domain_name_research"},
    {id: "nexora-social-content-audit", name: "Social Content Audit", endpointHash: "social-content-audit-v1", pricePerUnitUsdc: 0.02, kind: "social_content_audit"},
    {id: "nexora-stablecoin-route-report", name: "Stablecoin Route Report", endpointHash: "stablecoin-route-report-v1", pricePerUnitUsdc: 0.02, kind: "stablecoin_route_report", featured: true},
    {id: "nexora-policy-risk-review", name: "Agent Policy Risk Review", endpointHash: "policy-risk-review-v1", pricePerUnitUsdc: 0.025, kind: "policy_risk_review"},
    {id: "nexora-launch-readiness-check", name: "Launch Readiness Check", endpointHash: "launch-readiness-check-v1", pricePerUnitUsdc: 0.03, kind: "launch_readiness_check"},
    {id: "nexora-x402-integration-planner", name: "x402 Integration Planner", endpointHash: "x402-integration-planner-v1", pricePerUnitUsdc: 0.025, kind: "x402_integration_planner", featured: true}
  ];

  return seeds.map((seed, index) => ({
    id: seed.id,
    chainServiceId: null,
    publisherAddress,
    name: seed.name,
    endpointHash: seed.endpointHash,
    pricePerUnitUsdc: seed.pricePerUnitUsdc,
    manifest: {
      ...manifestTemplateForKind(seed.kind),
      description: seed.description ?? manifestTemplateForKind(seed.kind).description
    },
    active: true,
    featured: Boolean(seed.featured),
    txHash: null,
    createdAt: new Date(Date.parse(createdAt) + index * 60_000).toISOString(),
    archivedAt: null,
    archiveReason: null
  }));
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
    v2: normalizePolicyV2(policy.v2)
  };
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
      ssl: isLocalDatabase(config.databaseUrl) ? undefined : {rejectUnauthorized: config.databaseSslRejectUnauthorized}
    });
  }
  return pool;
}

function isLocalDatabase(databaseUrl: string) {
  return /localhost|127\.0\.0\.1/.test(databaseUrl);
}
