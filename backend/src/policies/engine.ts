import {config} from "../config.js";
import {chainContext} from "../chains.js";
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

export type PolicyRemediationCode =
  | "no_agent"
  | "policy_inactive"
  | "invalid_amount"
  | "transaction_cap_exceeded"
  | "onchain_policy_required"
  | "policy_expired"
  | "max_units_exceeded"
  | "service_not_allowlisted"
  | "recipient_not_allowlisted"
  | "contract_not_allowlisted"
  | "daily_limit_exceeded"
  | "weekly_limit_exceeded"
  | "monthly_limit_exceeded"
  | "cooldown_active";

export type PolicyRemediation = {
  code: PolicyRemediationCode;
  // Human label of the constraint that actually binds the suggested amount.
  limitingFactor: string;
  // Whether adjusting amount/units or waiting can make an otherwise identical request pass.
  retryable: boolean;
  // Largest whole-unit amount that would satisfy every amount cap, or null when no amount would help.
  suggestedMaxAmountUsdc: number | null;
  suggestedMaxUnits: number | null;
  // ISO timestamp the agent can retry after (cooldown), or null when time does not unblock it.
  retryAfter: string | null;
};

export type PolicyEvaluation = {
  allowed: boolean;
  reason?: string;
  remediation?: PolicyRemediation;
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
  if (!input.agent) {
    return blocked("Create and select an agent wallet before purchasing an API.", {
      code: "no_agent",
      limitingFactor: "No agent wallet selected",
      retryable: false
    });
  }
  const policy = normalizedPolicy(input.agent.policy);
  if (!policy.active) {
    return blocked("Agent policy is inactive.", {
      code: "policy_inactive",
      limitingFactor: "Agent policy inactive",
      retryable: false
    });
  }

  const now = input.now ?? new Date();
  const pricePerUnit = input.service.pricePerUnitUsdc;
  const amount = roundUsdc(pricePerUnit * input.units);
  if (!Number.isFinite(amount) || amount <= 0) {
    return blocked("Payment amount is invalid.", {
      code: "invalid_amount",
      limitingFactor: "Invalid payment amount",
      retryable: false
    });
  }

  // Spend windows are needed both for the limit checks and for computing a
  // compliant suggested amount, so they are derived before any early return.
  const agentPayments = input.payments.filter((payment) => payment.agentId === input.agent?.id && payment.status === "settled");
  const dailySpentUsdc = sumSince(agentPayments, now, startOfUtcDay);
  const weeklySpentUsdc = sumSince(agentPayments, now, startOfUtcWeek);
  const monthlySpentUsdc = sumSince(agentPayments, now, startOfUtcMonth);

  // The most restrictive amount cap that applies to this request. Each entry is
  // the maximum spend the corresponding rule would still allow right now.
  const amountCaps: Array<{code: PolicyRemediationCode; label: string; max: number}> = [
    {code: "transaction_cap_exceeded", label: "Agent transaction cap", max: policy.transactionCapUsdc},
    {code: "daily_limit_exceeded", label: "Agent daily limit", max: roundUsdc(policy.dailyLimitUsdc - dailySpentUsdc)}
  ];
  if ((policy.v2?.weeklyLimitUsdc ?? 0) > 0) {
    amountCaps.push({code: "weekly_limit_exceeded", label: "Agent weekly limit", max: roundUsdc((policy.v2?.weeklyLimitUsdc ?? 0) - weeklySpentUsdc)});
  }
  if ((policy.v2?.monthlyLimitUsdc ?? 0) > 0) {
    amountCaps.push({code: "monthly_limit_exceeded", label: "Agent monthly limit", max: roundUsdc((policy.v2?.monthlyLimitUsdc ?? 0) - monthlySpentUsdc)});
  }

  const spend = {amountUsdc: amount, dailySpentUsdc, weeklySpentUsdc, monthlySpentUsdc};

  if (amount > policy.transactionCapUsdc) {
    return blocked("This purchase exceeds the agent transaction cap.", amountRemediation("transaction_cap_exceeded", amountCaps, pricePerUnit), spend);
  }

  const settlementChainId = input.service.settlementChainId ?? config.arc.chainId;
  if (policy.v2?.requireOnchainPolicy && !hasPolicyDeployment(policy, settlementChainId)) {
    return blocked("This agent requires an on-chain policy save before spending.", {
      code: "onchain_policy_required",
      limitingFactor: "On-chain policy save required",
      retryable: false
    }, spend);
  }

  if (policy.v2?.expiresAt && Date.parse(policy.v2.expiresAt) <= now.getTime()) {
    return blocked("This agent policy has expired.", {
      code: "policy_expired",
      limitingFactor: "Agent policy expired",
      retryable: false
    }, spend);
  }

  if ((policy.v2?.maxUnitsPerRequest ?? 0) > 0 && input.units > (policy.v2?.maxUnitsPerRequest ?? 0)) {
    const maxUnits = policy.v2?.maxUnitsPerRequest ?? 0;
    return blocked("This request exceeds the agent max units per purchase.", {
      code: "max_units_exceeded",
      limitingFactor: "Agent max units per purchase",
      retryable: true,
      suggestedMaxUnits: maxUnits,
      suggestedMaxAmountUsdc: roundUsdc(pricePerUnit * maxUnits),
      retryAfter: null
    }, spend);
  }

  if (policy.v2?.serviceAllowlist?.length && !serviceAllowed(policy.v2.serviceAllowlist, input.service)) {
    return blocked("This service is not in the agent service allowlist.", {
      code: "service_not_allowlisted",
      limitingFactor: "Agent service allowlist",
      retryable: false
    }, spend);
  }

  if (policy.recipientAllowlist.length > 0 && !containsAddress(policy.recipientAllowlist, input.service.publisherAddress)) {
    return blocked("The service publisher is not in the agent recipient allowlist.", {
      code: "recipient_not_allowlisted",
      limitingFactor: "Agent recipient allowlist",
      retryable: false
    }, spend);
  }

  if (policy.contractAllowlist.length > 0) {
    const ledgerAddress = chainContext(settlementChainId).x402Ledger;
    if (!ledgerAddress || !containsAddress(policy.contractAllowlist, ledgerAddress)) {
      return blocked("The x402 ledger contract is not in the agent contract allowlist.", {
        code: "contract_not_allowlisted",
        limitingFactor: "Agent contract allowlist",
        retryable: false
      }, spend);
    }
  }

  if (dailySpentUsdc + amount > policy.dailyLimitUsdc) {
    return blocked("This purchase exceeds the agent daily limit.", amountRemediation("daily_limit_exceeded", amountCaps, pricePerUnit), spend);
  }
  if ((policy.v2?.weeklyLimitUsdc ?? 0) > 0 && weeklySpentUsdc + amount > (policy.v2?.weeklyLimitUsdc ?? 0)) {
    return blocked("This purchase exceeds the agent weekly limit.", amountRemediation("weekly_limit_exceeded", amountCaps, pricePerUnit), spend);
  }
  if ((policy.v2?.monthlyLimitUsdc ?? 0) > 0 && monthlySpentUsdc + amount > (policy.v2?.monthlyLimitUsdc ?? 0)) {
    return blocked("This purchase exceeds the agent monthly limit.", amountRemediation("monthly_limit_exceeded", amountCaps, pricePerUnit), spend);
  }

  const cooldownSeconds = policy.v2?.cooldownSeconds ?? 0;
  if (cooldownSeconds > 0) {
    const latest = latestSettledAt(agentPayments);
    if (latest && now.getTime() - latest.getTime() < cooldownSeconds * 1000) {
      const retryAfter = new Date(latest.getTime() + cooldownSeconds * 1000).toISOString();
      return blocked("This agent is still in its payment cooldown window.", {
        code: "cooldown_active",
        limitingFactor: "Agent payment cooldown",
        retryable: true,
        suggestedMaxAmountUsdc: null,
        suggestedMaxUnits: null,
        retryAfter
      }, spend);
    }
  }

  return {
    allowed: true,
    v2: spend
  };
}

function blocked(
  reason: string,
  remediation: PartialRemediation,
  spend?: PolicyEvaluation["v2"]
): PolicyEvaluation {
  return {
    allowed: false,
    reason,
    remediation: {
      suggestedMaxAmountUsdc: null,
      suggestedMaxUnits: null,
      retryAfter: null,
      ...remediation
    },
    v2: spend
  };
}

type PartialRemediation =
  Pick<PolicyRemediation, "code" | "limitingFactor" | "retryable">
  & Partial<Pick<PolicyRemediation, "suggestedMaxAmountUsdc" | "suggestedMaxUnits" | "retryAfter">>;

// Builds remediation for an amount-capped block: finds the tightest binding cap,
// clamps to whole units of the service price, and reports what would pass.
function amountRemediation(
  code: PolicyRemediationCode,
  amountCaps: Array<{code: PolicyRemediationCode; label: string; max: number}>,
  pricePerUnit: number
): PartialRemediation {
  const tightest = amountCaps.reduce((min, cap) => (cap.max < min.max ? cap : min), amountCaps[0]);
  const headroom = Math.max(0, tightest.max);
  // A single unit is the smallest indivisible purchase; if even that exceeds the
  // cap, no smaller amount can pass and the block is not retryable by resizing.
  const maxUnits = pricePerUnit > 0 ? Math.floor(headroom / pricePerUnit) : 0;
  const suggestedMaxAmountUsdc = roundUsdc(maxUnits * pricePerUnit);
  const retryable = maxUnits >= 1;
  return {
    code,
    limitingFactor: tightest.label,
    retryable,
    suggestedMaxUnits: retryable ? maxUnits : null,
    suggestedMaxAmountUsdc: retryable ? suggestedMaxAmountUsdc : null,
    retryAfter: null
  };
}

function normalizedPolicy(policy: AgentPolicy): AgentPolicy {
  return {...policy, v2: normalizePolicyV2(policy.v2)};
}

export function hasPolicyDeployment(policy: AgentPolicy, chainId: number) {
  if (policy.deployments?.some((deployment) => deployment.chainId === chainId && Boolean(deployment.txHash))) return true;
  return chainId === config.arc.chainId && Boolean(policy.txHash);
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
