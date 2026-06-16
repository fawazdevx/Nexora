import {config} from "../config.js";
import type {AgentPolicy, AgentWalletRecord, PaymentRecord, ServiceRecord} from "../store.js";

export const defaultPolicyV2: AgentPolicy["v2"] = {
  weeklyLimitUsdc: 0,
  monthlyLimitUsdc: 0,
  maxUnitsPerRequest: 0,
  cooldownSeconds: 0,
  expiresAt: null,
  serviceAllowlist: [],
  requireOnchainPolicy: false
};

export type PolicyEvaluationInput = {
  agent?: Pick<AgentWalletRecord, "id" | "address" | "policy">;
  service: ServiceRecord;
  units: number;
  payments: PaymentRecord[];
  now?: Date;
};

export type PolicyEvaluation = {
  allowed: boolean;
  reason?: string;
  v2?: {
    amountUsdc: number;
    dailySpentUsdc: number;
    weeklySpentUsdc: number;
    monthlySpentUsdc: number;
  };
};

export function normalizePolicyV2(value: unknown): AgentPolicy["v2"] {
  const input = value && typeof value === "object" ? value as Partial<NonNullable<AgentPolicy["v2"]>> : {};
  return {
    weeklyLimitUsdc: nonNegativeNumber(input.weeklyLimitUsdc),
    monthlyLimitUsdc: nonNegativeNumber(input.monthlyLimitUsdc),
    maxUnitsPerRequest: nonNegativeInteger(input.maxUnitsPerRequest),
    cooldownSeconds: nonNegativeInteger(input.cooldownSeconds),
    expiresAt: typeof input.expiresAt === "string" && input.expiresAt.trim() ? input.expiresAt : null,
    serviceAllowlist: Array.isArray(input.serviceAllowlist) ? uniqueStrings(input.serviceAllowlist) : [],
    requireOnchainPolicy: Boolean(input.requireOnchainPolicy)
  };
}

export function evaluateAgentPolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  if (!input.agent) return {allowed: false, reason: "Create and select an agent wallet before purchasing an API."};
  const policy = normalizedPolicy(input.agent.policy);
  if (!policy.active) return {allowed: false, reason: "Agent policy is inactive."};

  const now = input.now ?? new Date();
  const amount = roundUsdc(input.service.pricePerUnitUsdc * input.units);
  if (!Number.isFinite(amount) || amount <= 0) return {allowed: false, reason: "Payment amount is invalid."};

  if (amount > policy.transactionCapUsdc) {
    return {allowed: false, reason: "This purchase exceeds the agent transaction cap."};
  }

  if (policy.v2?.requireOnchainPolicy && !policy.txHash) {
    return {allowed: false, reason: "This agent requires an on-chain policy save before spending."};
  }

  if (policy.v2?.expiresAt && Date.parse(policy.v2.expiresAt) <= now.getTime()) {
    return {allowed: false, reason: "This agent policy has expired."};
  }

  if ((policy.v2?.maxUnitsPerRequest ?? 0) > 0 && input.units > (policy.v2?.maxUnitsPerRequest ?? 0)) {
    return {allowed: false, reason: "This request exceeds the agent max units per purchase."};
  }

  if (policy.v2?.serviceAllowlist?.length && !serviceAllowed(policy.v2.serviceAllowlist, input.service)) {
    return {allowed: false, reason: "This service is not in the agent service allowlist."};
  }

  if (policy.recipientAllowlist.length > 0 && !containsAddress(policy.recipientAllowlist, input.service.publisherAddress)) {
    return {allowed: false, reason: "The service publisher is not in the agent recipient allowlist."};
  }

  if (policy.contractAllowlist.length > 0) {
    const ledgerAddress = config.contracts.x402Ledger || process.env.X402_LEDGER_ADDRESS || "";
    if (!ledgerAddress || !containsAddress(policy.contractAllowlist, ledgerAddress)) {
      return {allowed: false, reason: "The x402 ledger contract is not in the agent contract allowlist."};
    }
  }

  const agentPayments = input.payments.filter((payment) => payment.agentId === input.agent?.id && payment.status === "settled");
  const dailySpentUsdc = sumSince(agentPayments, now, startOfUtcDay);
  const weeklySpentUsdc = sumSince(agentPayments, now, startOfUtcWeek);
  const monthlySpentUsdc = sumSince(agentPayments, now, startOfUtcMonth);

  if (dailySpentUsdc + amount > policy.dailyLimitUsdc) {
    return {allowed: false, reason: "This purchase exceeds the agent daily limit."};
  }
  if ((policy.v2?.weeklyLimitUsdc ?? 0) > 0 && weeklySpentUsdc + amount > (policy.v2?.weeklyLimitUsdc ?? 0)) {
    return {allowed: false, reason: "This purchase exceeds the agent weekly limit."};
  }
  if ((policy.v2?.monthlyLimitUsdc ?? 0) > 0 && monthlySpentUsdc + amount > (policy.v2?.monthlyLimitUsdc ?? 0)) {
    return {allowed: false, reason: "This purchase exceeds the agent monthly limit."};
  }

  const cooldownSeconds = policy.v2?.cooldownSeconds ?? 0;
  if (cooldownSeconds > 0) {
    const latest = latestSettledAt(agentPayments);
    if (latest && now.getTime() - latest.getTime() < cooldownSeconds * 1000) {
      return {allowed: false, reason: "This agent is still in its payment cooldown window."};
    }
  }

  return {
    allowed: true,
    v2: {amountUsdc: amount, dailySpentUsdc, weeklySpentUsdc, monthlySpentUsdc}
  };
}

function normalizedPolicy(policy: AgentPolicy): AgentPolicy {
  return {...policy, v2: normalizePolicyV2(policy.v2)};
}

function containsAddress(items: string[], address: string) {
  return items.some((item) => item.toLowerCase() === address.toLowerCase());
}

function serviceAllowed(items: string[], service: ServiceRecord) {
  const candidates = [
    service.id,
    service.endpointHash,
    service.name,
    service.chainServiceId === null ? "" : String(service.chainServiceId)
  ].map((item) => item.toLowerCase());
  return items.some((item) => candidates.includes(item.toLowerCase()));
}

function sumSince(payments: PaymentRecord[], now: Date, startFn: (date: Date) => Date) {
  const start = startFn(now).getTime();
  return roundUsdc(payments.reduce((sum, payment) => {
    const timestamp = Date.parse(payment.settledAt ?? payment.createdAt);
    return timestamp >= start ? sum + payment.amountUsdc : sum;
  }, 0));
}

function latestSettledAt(payments: PaymentRecord[]) {
  return payments.reduce<Date | null>((latest, payment) => {
    const timestamp = Date.parse(payment.settledAt ?? payment.createdAt);
    if (!Number.isFinite(timestamp)) return latest;
    const date = new Date(timestamp);
    return !latest || date > latest ? date : latest;
  }, null);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcWeek(date: Date) {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysFromMonday);
  return day;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nonNegativeNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1_000_000) / 1_000_000 : 0;
}

function nonNegativeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function uniqueStrings(items: unknown[]) {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50);
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
