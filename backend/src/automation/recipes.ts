import {dispatchNotification} from "../notifications.js";
import {isVisibleAgent, pushNotification, updateStore, visibleServicesForStore, type AgentAutomationRecipeRecord, type AgentAutomationRunRecord, type AgentWalletRecord, type NotificationRecord, type PaymentRecord, type StoreShape} from "../store.js";

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  trigger: AgentAutomationRecipeRecord["trigger"];
  action: AgentAutomationRecipeRecord["action"];
  params: AgentAutomationRecipeRecord["params"];
};

const templates: AutomationTemplate[] = [
  {
    id: "daily-spend-warning",
    name: "Daily spend guard",
    description: "Notify when an agent uses most of its daily budget.",
    trigger: "daily_spend_threshold",
    action: "notify",
    params: {thresholdPercent: 80, cooldownHours: 12}
  },
  {
    id: "daily-spend-pause",
    name: "Pause at daily limit",
    description: "Pause the agent policy if settled spend reaches the selected daily threshold.",
    trigger: "daily_spend_threshold",
    action: "pause_agent",
    params: {thresholdPercent: 100, cooldownHours: 24}
  },
  {
    id: "failed-payment-burst",
    name: "Repeated failed payments",
    description: "Notify when an agent has repeated failed or policy-blocked payments.",
    trigger: "failed_payment_burst",
    action: "notify",
    params: {failureCount: 2, windowHours: 24, cooldownHours: 6}
  },
  {
    id: "approval-expiring",
    name: "Approval window reminder",
    description: "Notify when pending manual approvals are close to expiry.",
    trigger: "pending_approval_expiring",
    action: "notify",
    params: {expiresWithinHours: 2, cooldownHours: 2}
  },
  {
    id: "policy-expiry",
    name: "Policy expiry reminder",
    description: "Notify before a policy V2 expiry timestamp is reached.",
    trigger: "policy_expiring",
    action: "notify",
    params: {expiresWithinHours: 72, cooldownHours: 24}
  },
  {
    id: "large-receipt",
    name: "Large receipt alert",
    description: "Notify when a settled x402 receipt is above the selected amount.",
    trigger: "large_receipt",
    action: "notify",
    params: {minAmountUsdc: 25, windowHours: 24, cooldownHours: 6}
  },
  {
    id: "weekly-summary",
    name: "Weekly agent summary",
    description: "Send a periodic summary of agent spend, failures, and pending approvals.",
    trigger: "weekly_summary",
    action: "notify",
    params: {cooldownHours: 168}
  }
];

export function automationRecipeTemplates() {
  return templates;
}

export async function createAutomationRecipe(input: {
  operatorAddress: string;
  agentId?: string | null;
  templateId?: string | null;
  name?: string | null;
  description?: string | null;
  trigger?: AgentAutomationRecipeRecord["trigger"] | null;
  action?: AgentAutomationRecipeRecord["action"] | null;
  params?: Partial<AgentAutomationRecipeRecord["params"]>;
}) {
  const template = templates.find((item) => item.id === input.templateId) ?? templates[0];
  if (!template && (!input.trigger || !input.action)) throw new Error("automation template not found");
  const action = input.action ?? template?.action ?? "notify";
  if (action === "pause_agent" && !input.agentId) {
    throw new Error("pause-agent automation recipes must be scoped to one agent");
  }

  const result = await updateStore((store) => {
    const agent = input.agentId ? ownedAgent(store.agents, input.operatorAddress, input.agentId) : null;
    const now = new Date().toISOString();
    const record: AgentAutomationRecipeRecord = normalizeAutomationRecipe({
      id: crypto.randomUUID(),
      operatorAddress: input.operatorAddress,
      agentId: agent?.id ?? null,
      name: input.name ?? template?.name ?? "Automation recipe",
      description: input.description ?? template?.description ?? "Custom agent automation recipe.",
      trigger: input.trigger ?? template?.trigger ?? "daily_spend_threshold",
      action,
      params: normalizeRecipeParams({...template?.params, ...(input.params ?? {})}),
      active: true,
      runCount: 0,
      lastTriggeredAt: null,
      lastRunAt: null,
      lastRunReason: null,
      createdAt: now,
      updatedAt: now
    });
    store.automationRecipes.unshift(record);
    store.automationRecipes = store.automationRecipes.slice(0, 200);
    const notification = pushNotification(store, {
      operatorAddress: input.operatorAddress,
      title: "Automation recipe created",
      detail: `${record.name}${agent ? ` · ${agent.arcName ?? agent.address ?? agent.id}` : " · all agents"}`,
      kind: "agent",
      actionHref: "/automation"
    });
    return {record, notification};
  });

  await dispatchNotification({notification: result.notification, event: "agentActions"}).catch(() => undefined);
  return result.record;
}

export async function updateAutomationRecipe(input: {
  id: string;
  operatorAddress: string;
  active?: boolean;
  name?: string | null;
  agentId?: string | null;
  params?: Partial<AgentAutomationRecipeRecord["params"]>;
}) {
  return updateStore((store) => {
    const recipe = store.automationRecipes.find((item) => item.id === input.id);
    if (!recipe) throw new Error("automation recipe not found");
    if (recipe.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) throw new Error("automation recipe operator wallet required");
    if (input.agentId !== undefined) {
      recipe.agentId = input.agentId ? ownedAgent(store.agents, input.operatorAddress, input.agentId).id : null;
    }
    if (input.active !== undefined) recipe.active = input.active;
    if (input.name) recipe.name = input.name;
    if (input.params) recipe.params = normalizeRecipeParams({...recipe.params, ...input.params});
    recipe.updatedAt = new Date().toISOString();
    return normalizeAutomationRecipe(recipe);
  });
}

export async function evaluateAutomationRecipes(operatorAddress: string) {
  const result = await updateStore((store) => {
    const now = new Date();
    const recipes = store.automationRecipes
      .filter((recipe) => recipe.operatorAddress.toLowerCase() === operatorAddress.toLowerCase())
      .map(normalizeAutomationRecipe);
    const agents = store.agents.filter((agent) => isVisibleAgent(agent) && agent.operatorAddress.toLowerCase() === operatorAddress.toLowerCase());
    const visibleServiceIds = new Set(visibleServicesForStore(store.services).map((service) => service.id));
    const payments = store.payments.filter((payment) => (
      (payment.payer.toLowerCase() === operatorAddress.toLowerCase() || Boolean(payment.agentId && agents.some((agent) => agent.id === payment.agentId)))
      && (payment.external || visibleServiceIds.has(payment.serviceId))
    ));
    const runs: AgentAutomationRunRecord[] = [];
    const notifications: NotificationRecord[] = [];

    for (const recipe of recipes) {
      const evaluation = evaluateRecipe({recipe, agents, payments, approvals: store.approvalRequests, now});
      recipe.lastRunAt = now.toISOString();
      recipe.lastRunReason = evaluation.summary;
      recipe.updatedAt = now.toISOString();
      const stored = store.automationRecipes.find((item) => item.id === recipe.id);
      if (stored) Object.assign(stored, recipe);

      if (!evaluation.matched) continue;
      if (withinCooldown(recipe, now)) {
        runs.push(automationRun(recipe, "skipped", `Cooldown active: ${evaluation.summary}`, now));
        continue;
      }

      const actionResult = applyRecipeAction({store, recipe, agents, summary: evaluation.summary});
      recipe.runCount += 1;
      recipe.lastTriggeredAt = now.toISOString();
      recipe.lastRunReason = evaluation.summary;
      if (stored) Object.assign(stored, recipe);
      runs.push(automationRun(recipe, actionResult.status, actionResult.summary, now));
      if (actionResult.notification) notifications.push(actionResult.notification);
    }

    if (runs.length > 0) {
      store.automationRuns.unshift(...runs);
      store.automationRuns = store.automationRuns.slice(0, 500);
    }
    return {runs, notifications};
  });

  for (const notification of result.notifications) {
    await dispatchNotification({notification, event: notification.kind === "policy" ? "policyAlerts" : "agentActions"}).catch(() => undefined);
  }

  return {
    evaluatedAt: new Date().toISOString(),
    runs: result.runs
  };
}

export async function evaluateAutomationRecipesForOperator(operatorAddress?: string | null) {
  if (!operatorAddress) return {runs: []};
  return evaluateAutomationRecipes(operatorAddress);
}

function evaluateRecipe(input: {
  recipe: AgentAutomationRecipeRecord;
  agents: AgentWalletRecord[];
  payments: PaymentRecord[];
  approvals: Array<{operatorAddress: string; agentId: string; serviceName: string; amountUsdc: number; status: string; expiresAt?: string | null}>;
  now: Date;
}) {
  if (!input.recipe.active) return {matched: false, summary: "Recipe is inactive"};
  const scopedAgents = input.recipe.agentId ? input.agents.filter((agent) => agent.id === input.recipe.agentId) : input.agents;
  if (scopedAgents.length === 0) return {matched: false, summary: "No matching agent wallet"};

  if (input.recipe.trigger === "daily_spend_threshold") {
    const thresholdPercent = input.recipe.params.thresholdPercent ?? 80;
    const thresholdUsdc = input.recipe.params.thresholdUsdc ?? 0;
    for (const agent of scopedAgents) {
      const spent = settledSpendSince(input.payments, agent, startOfUtcDay(input.now.getTime()));
      const percent = agent.policy.dailyLimitUsdc > 0 ? (spent / agent.policy.dailyLimitUsdc) * 100 : 0;
      if ((thresholdUsdc > 0 && spent >= thresholdUsdc) || (thresholdPercent > 0 && percent >= thresholdPercent)) {
        return {matched: true, summary: `${agentLabel(agent)} spent ${formatUsdc(spent)} today (${Math.round(percent)}% of daily limit).`};
      }
    }
    return {matched: false, summary: `Daily spend is below ${thresholdPercent}% threshold`};
  }

  if (input.recipe.trigger === "failed_payment_burst") {
    const windowHours = input.recipe.params.windowHours ?? 24;
    const failureCount = input.recipe.params.failureCount ?? 2;
    const cutoff = input.now.getTime() - windowHours * 60 * 60 * 1000;
    for (const agent of scopedAgents) {
      const failures = input.payments.filter((payment) => (
        paymentBelongsToAgent(payment, agent)
        && (payment.status === "failed" || payment.status === "policy_blocked")
        && Date.parse(payment.createdAt) >= cutoff
      ));
      if (failures.length >= failureCount) {
        return {matched: true, summary: `${agentLabel(agent)} had ${failures.length} failed or blocked payment attempts in ${windowHours}h.`};
      }
    }
    return {matched: false, summary: "No repeated failed payments"};
  }

  if (input.recipe.trigger === "pending_approval_expiring") {
    const expiresWithinHours = input.recipe.params.expiresWithinHours ?? 2;
    const deadline = input.now.getTime() + expiresWithinHours * 60 * 60 * 1000;
    const scopedAgentIds = new Set(scopedAgents.map((agent) => agent.id));
    const approval = input.approvals.find((request) => (
      request.operatorAddress.toLowerCase() === input.recipe.operatorAddress.toLowerCase()
      && scopedAgentIds.has(request.agentId)
      && request.status === "pending"
      && request.expiresAt
      && Date.parse(request.expiresAt) <= deadline
    ));
    if (approval) return {matched: true, summary: `${approval.serviceName} approval for ${formatUsdc(approval.amountUsdc)} expires soon.`};
    return {matched: false, summary: "No approval requests expiring soon"};
  }

  if (input.recipe.trigger === "policy_expiring") {
    const expiresWithinHours = input.recipe.params.expiresWithinHours ?? 72;
    const deadline = input.now.getTime() + expiresWithinHours * 60 * 60 * 1000;
    const agent = scopedAgents.find((item) => item.policy.v2?.expiresAt && Date.parse(item.policy.v2.expiresAt) <= deadline);
    if (agent?.policy.v2?.expiresAt) return {matched: true, summary: `${agentLabel(agent)} policy expires ${new Date(agent.policy.v2.expiresAt).toLocaleString()}.`};
    return {matched: false, summary: "No policy expiry inside threshold"};
  }

  if (input.recipe.trigger === "large_receipt") {
    const minAmountUsdc = input.recipe.params.minAmountUsdc ?? 25;
    const windowHours = input.recipe.params.windowHours ?? 24;
    const cutoff = input.now.getTime() - windowHours * 60 * 60 * 1000;
    const scopedAgentIds = new Set(scopedAgents.map((agent) => agent.id));
    const payment = input.payments.find((item) => (
      item.status === "settled"
      && Number(item.amountUsdc || 0) >= minAmountUsdc
      && Date.parse(item.settledAt ?? item.createdAt) >= cutoff
      && (!item.agentId || scopedAgentIds.has(item.agentId))
    ));
    if (payment) return {matched: true, summary: `${payment.serviceName} settled for ${formatUsdc(payment.amountUsdc)}.`};
    return {matched: false, summary: `No receipt above ${formatUsdc(minAmountUsdc)} in window`};
  }

  const settled = input.payments.filter((payment) => payment.status === "settled");
  const failed = input.payments.filter((payment) => payment.status === "failed" || payment.status === "policy_blocked");
  return {
    matched: true,
    summary: `Weekly summary: ${settled.length} settled payments, ${formatUsdc(settled.reduce((sum, payment) => sum + payment.amountUsdc, 0))} spent, ${failed.length} failed or blocked attempts.`
  };
}

function applyRecipeAction(input: {
  store: StoreShape;
  recipe: AgentAutomationRecipeRecord;
  agents: AgentWalletRecord[];
  summary: string;
}): {status: AgentAutomationRunRecord["status"]; summary: string; notification?: NotificationRecord} {
  const agent = input.recipe.agentId ? input.agents.find((item) => item.id === input.recipe.agentId) : null;
  if (input.recipe.action === "pause_agent") {
    if (!agent) return {status: "failed", summary: "Pause action requires a specific agent."};
    agent.policy.active = false;
    const notification = pushNotification(input.store, {
      operatorAddress: input.recipe.operatorAddress,
      title: "Automation paused agent policy",
      detail: `${input.recipe.name}: ${input.summary}`,
      kind: "policy",
      actionHref: "/settings/policies"
    });
    return {status: "matched", summary: `Paused ${agentLabel(agent)}. ${input.summary}`, notification};
  }
  const notification = pushNotification(input.store, {
    operatorAddress: input.recipe.operatorAddress,
    title: `Automation: ${input.recipe.name}`,
    detail: input.summary,
    kind: input.recipe.trigger.includes("policy") || input.recipe.trigger.includes("approval") ? "policy" : "agent",
    actionHref: input.recipe.trigger.includes("policy") ? "/settings/policies" : "/automation"
  });
  return {status: "matched", summary: input.summary, notification};
}

function normalizeAutomationRecipe(recipe: AgentAutomationRecipeRecord): AgentAutomationRecipeRecord {
  return {
    id: String(recipe.id ?? crypto.randomUUID()),
    operatorAddress: String(recipe.operatorAddress ?? ""),
    agentId: recipe.agentId ?? null,
    name: String(recipe.name ?? "Automation recipe"),
    description: String(recipe.description ?? ""),
    trigger: normalizeTrigger(recipe.trigger),
    action: normalizeAction(recipe.action),
    params: normalizeRecipeParams(recipe.params),
    active: recipe.active !== false,
    runCount: Number.isFinite(Number(recipe.runCount)) ? Number(recipe.runCount) : 0,
    lastTriggeredAt: recipe.lastTriggeredAt ?? null,
    lastRunAt: recipe.lastRunAt ?? null,
    lastRunReason: recipe.lastRunReason ?? null,
    createdAt: recipe.createdAt ?? new Date().toISOString(),
    updatedAt: recipe.updatedAt ?? recipe.createdAt ?? new Date().toISOString()
  };
}

function normalizeTrigger(value: unknown): AgentAutomationRecipeRecord["trigger"] {
  if (
    value === "daily_spend_threshold"
    || value === "failed_payment_burst"
    || value === "pending_approval_expiring"
    || value === "policy_expiring"
    || value === "large_receipt"
    || value === "weekly_summary"
  ) return value;
  return "daily_spend_threshold";
}

function normalizeAction(value: unknown): AgentAutomationRecipeRecord["action"] {
  if (value === "pause_agent" || value === "notify") return value;
  return "notify";
}

function normalizeRecipeParams(value: unknown): AgentAutomationRecipeRecord["params"] {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    thresholdUsdc: positiveNumber(record.thresholdUsdc),
    thresholdPercent: boundedNumber(record.thresholdPercent, 0, 1000),
    failureCount: positiveInteger(record.failureCount, 100),
    windowHours: positiveInteger(record.windowHours, 24 * 30),
    expiresWithinHours: positiveInteger(record.expiresWithinHours, 24 * 90),
    minAmountUsdc: positiveNumber(record.minAmountUsdc),
    cooldownHours: positiveInteger(record.cooldownHours, 24 * 30)
  };
}

function ownedAgent(agents: AgentWalletRecord[], operatorAddress: string, agentId: string) {
  const agent = agents.find((item) => isVisibleAgent(item) && item.operatorAddress.toLowerCase() === operatorAddress.toLowerCase() && item.id === agentId);
  if (!agent) throw new Error("agent wallet not found for automation recipe");
  return agent;
}

function withinCooldown(recipe: AgentAutomationRecipeRecord, now: Date) {
  if (!recipe.lastTriggeredAt) return false;
  const cooldownHours = recipe.params.cooldownHours ?? 0;
  if (cooldownHours <= 0) return false;
  return now.getTime() - Date.parse(recipe.lastTriggeredAt) < cooldownHours * 60 * 60 * 1000;
}

function automationRun(recipe: AgentAutomationRecipeRecord, status: AgentAutomationRunRecord["status"], summary: string, now: Date): AgentAutomationRunRecord {
  return {
    id: crypto.randomUUID(),
    recipeId: recipe.id,
    operatorAddress: recipe.operatorAddress,
    agentId: recipe.agentId ?? null,
    trigger: recipe.trigger,
    action: recipe.action,
    status,
    summary,
    createdAt: now.toISOString()
  };
}

function settledSpendSince(payments: PaymentRecord[], agent: AgentWalletRecord, cutoff: number) {
  return roundUsdc(payments.reduce((sum, payment) => {
    if (payment.status !== "settled") return sum;
    if (!paymentBelongsToAgent(payment, agent)) return sum;
    if (Date.parse(payment.settledAt ?? payment.createdAt) < cutoff) return sum;
    return sum + Number(payment.amountUsdc || 0);
  }, 0));
}

function paymentBelongsToAgent(payment: PaymentRecord, agent: AgentWalletRecord) {
  return payment.agentId === agent.id || Boolean(agent.address && payment.agentWallet?.toLowerCase() === agent.address.toLowerCase());
}

function startOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function positiveNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return roundUsdc(parsed);
}

function boundedNumber(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, parsed));
}

function positiveInteger(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return Math.min(parsed, max);
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatUsdc(value: number) {
  return `${roundUsdc(value).toFixed(2)} USDC`;
}

function agentLabel(agent: AgentWalletRecord) {
  return agent.arcName || agent.address || agent.id;
}
