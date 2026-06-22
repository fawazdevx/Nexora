import {keccak256, stringToHex} from "viem";
import type {AgentWalletRecord, PaymentRecord, ServiceRecord} from "./store.js";

export type NexoraMemoScope = "public" | "selective" | "private";

export type NexoraStructuredMemo = {
  protocol: "nexora.memo";
  version: "1.0";
  type: "nexora.x402.purchase";
  memoId: string;
  memoData: {
    agentId: string | null;
    agentWallet: string | null;
    operatorAddress: string;
    serviceId: string;
    serviceName: string;
    publisherAddress: string;
    requestHash: string;
    authorizationId: string;
    units: number;
    amountUsdc: number;
    budgetBucket: string;
    policy: {
      mode: "auto" | "manual" | "blocked";
      dailyLimitUsdc: number | null;
      transactionCapUsdc: number | null;
      requireOnchainPolicy: boolean;
    };
    privacy: {
      scope: NexoraMemoScope;
      publicFields: string[];
      privateFields: string[];
    };
    intent: string;
    createdAt: string;
  };
  encoding: "json";
  arc: {
    memoContract: string;
    targetContract?: string | null;
    callDataHash?: string | null;
    memoIndex?: number | null;
  };
};

export const ARC_MEMO_CONTRACT = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";

export const arcMemoAbi = [
  {
    type: "event",
    name: "Memo",
    anonymous: false,
    inputs: [
      {name: "sender", type: "address", indexed: true},
      {name: "target", type: "address", indexed: true},
      {name: "callDataHash", type: "bytes32", indexed: false},
      {name: "memoId", type: "bytes32", indexed: true},
      {name: "memo", type: "bytes", indexed: false},
      {name: "memoIndex", type: "uint256", indexed: false}
    ]
  }
] as const;

export function buildX402PaymentMemo(input: {
  authorizationId: string;
  payer: string;
  service: ServiceRecord;
  agent?: AgentWalletRecord | null;
  requestHash: string;
  units: number;
  amountUsdc: number;
  policyMode?: "auto" | "manual" | "blocked";
  privacyScope?: NexoraMemoScope;
  createdAt?: string;
}): NexoraStructuredMemo {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const memoId = memoIdFor("nexora.x402.purchase", input.authorizationId, input.requestHash);
  const budgetBucket = budgetBucketForService(input.service);
  const agent = input.agent ?? null;
  return {
    protocol: "nexora.memo",
    version: "1.0",
    type: "nexora.x402.purchase",
    memoId,
    memoData: {
      agentId: agent?.id ?? null,
      agentWallet: agent?.address ?? null,
      operatorAddress: agent?.operatorAddress ?? input.payer,
      serviceId: input.service.id,
      serviceName: input.service.name,
      publisherAddress: input.service.publisherAddress,
      requestHash: input.requestHash,
      authorizationId: input.authorizationId,
      units: input.units,
      amountUsdc: roundUsdc(input.amountUsdc),
      budgetBucket,
      policy: {
        mode: input.policyMode ?? "auto",
        dailyLimitUsdc: agent ? Number(agent.policy.dailyLimitUsdc || 0) : null,
        transactionCapUsdc: agent ? Number(agent.policy.transactionCapUsdc || 0) : null,
        requireOnchainPolicy: Boolean(agent?.policy.v2?.requireOnchainPolicy)
      },
      privacy: {
        scope: input.privacyScope ?? "public",
        publicFields: ["type", "serviceId", "requestHash", "budgetBucket", "policy.mode"],
        privateFields: ["serviceName", "publisherAddress", "amountUsdc", "agentWallet"]
      },
      intent: intentForService(input.service),
      createdAt
    },
    encoding: "json",
    arc: {
      memoContract: ARC_MEMO_CONTRACT,
      targetContract: null,
      callDataHash: null,
      memoIndex: null
    }
  };
}

export function attachSettlementMemoContext(input: {
  memo?: NexoraStructuredMemo | null;
  txHash?: string | null;
  targetContract?: string | null;
  callDataHash?: string | null;
  memoIndex?: number | null;
}) {
  if (!input.memo) return null;
  return {
    ...input.memo,
    arc: {
      ...input.memo.arc,
      targetContract: input.targetContract ?? input.memo.arc.targetContract ?? null,
      callDataHash: input.callDataHash ?? input.memo.arc.callDataHash ?? null,
      memoIndex: input.memoIndex ?? input.memo.arc.memoIndex ?? null
    }
  };
}

export function normalizeMemo(value: unknown): NexoraStructuredMemo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<NexoraStructuredMemo>;
  if (record.protocol !== "nexora.memo" || record.type !== "nexora.x402.purchase") return null;
  if (!record.memoId || !record.memoData || typeof record.memoData !== "object") return null;
  return {
    protocol: "nexora.memo",
    version: "1.0",
    type: "nexora.x402.purchase",
    memoId: String(record.memoId),
    memoData: {
      agentId: record.memoData.agentId ?? null,
      agentWallet: record.memoData.agentWallet ?? null,
      operatorAddress: String(record.memoData.operatorAddress ?? ""),
      serviceId: String(record.memoData.serviceId ?? ""),
      serviceName: String(record.memoData.serviceName ?? ""),
      publisherAddress: String(record.memoData.publisherAddress ?? ""),
      requestHash: String(record.memoData.requestHash ?? ""),
      authorizationId: String(record.memoData.authorizationId ?? ""),
      units: Number(record.memoData.units || 0),
      amountUsdc: Number(record.memoData.amountUsdc || 0),
      budgetBucket: String(record.memoData.budgetBucket ?? "general"),
      policy: {
        mode: record.memoData.policy?.mode === "manual" || record.memoData.policy?.mode === "blocked" ? record.memoData.policy.mode : "auto",
        dailyLimitUsdc: nullableNumber(record.memoData.policy?.dailyLimitUsdc),
        transactionCapUsdc: nullableNumber(record.memoData.policy?.transactionCapUsdc),
        requireOnchainPolicy: Boolean(record.memoData.policy?.requireOnchainPolicy)
      },
      privacy: {
        scope: normalizePrivacyScope(record.memoData.privacy?.scope),
        publicFields: Array.isArray(record.memoData.privacy?.publicFields) ? record.memoData.privacy.publicFields.map(String) : [],
        privateFields: Array.isArray(record.memoData.privacy?.privateFields) ? record.memoData.privacy.privateFields.map(String) : []
      },
      intent: String(record.memoData.intent ?? ""),
      createdAt: String(record.memoData.createdAt ?? new Date().toISOString())
    },
    encoding: "json",
    arc: {
      memoContract: String(record.arc?.memoContract ?? ARC_MEMO_CONTRACT),
      targetContract: record.arc?.targetContract ?? null,
      callDataHash: record.arc?.callDataHash ?? null,
      memoIndex: nullableNumber(record.arc?.memoIndex)
    }
  };
}

export function publicMemoView(value: unknown) {
  const memo = normalizeMemo(value);
  if (!memo) return null;
  return {
    protocol: memo.protocol,
    version: memo.version,
    type: memo.type,
    memoId: memo.memoId,
    memoData: publicMemoData(memo),
    encoding: memo.encoding,
    arc: memo.arc
  };
}

export function publicMemoData(value: unknown) {
  const memo = normalizeMemo(value);
  if (!memo) return {};
  const privacy = {scope: memo.memoData.privacy.scope};
  if (memo.memoData.privacy.scope === "private") {
    return {
      type: memo.type,
      privacy,
      createdAt: memo.memoData.createdAt
    };
  }
  if (memo.memoData.privacy.scope === "public") {
    return {
      type: memo.type,
      serviceId: memo.memoData.serviceId,
      serviceName: memo.memoData.serviceName,
      publisherAddress: memo.memoData.publisherAddress,
      requestHash: memo.memoData.requestHash,
      authorizationId: memo.memoData.authorizationId,
      units: memo.memoData.units,
      amountUsdc: memo.memoData.amountUsdc,
      budgetBucket: memo.memoData.budgetBucket,
      policy: memo.memoData.policy,
      privacy,
      intent: memo.memoData.intent,
      createdAt: memo.memoData.createdAt
    };
  }
  return {
    type: memo.type,
    serviceId: memo.memoData.serviceId,
    requestHash: memo.memoData.requestHash,
    budgetBucket: memo.memoData.budgetBucket,
    policy: {mode: memo.memoData.policy.mode},
    privacy,
    intent: memo.memoData.intent,
    createdAt: memo.memoData.createdAt
  };
}

export function memoIdFor(...parts: string[]) {
  return keccak256(stringToHex(parts.join(":")));
}

export function budgetBucketForService(service: Pick<ServiceRecord, "manifest" | "name" | "endpointHash">) {
  const marker = `${service.manifest?.kind ?? ""} ${service.name} ${service.endpointHash}`.toLowerCase();
  if (/contract|wallet|policy|risk|security|audit/.test(marker)) return "security";
  if (/github|repo|developer|x402|integration|arc builder|stablecoin/.test(marker)) return "developer_tools";
  if (/social|landing|growth|domain|x account|website/.test(marker)) return "marketing";
  if (/grant|meeting|brief|research/.test(marker)) return "research";
  return "general";
}

export function intentForService(service: Pick<ServiceRecord, "manifest" | "name">) {
  const kind = service.manifest?.kind ?? "generic";
  if (kind === "github_repo_analyzer") return "Analyze a public repository before the agent or operator relies on it.";
  if (kind === "contract_safety_check") return "Review a contract before adding it to agent payment policy.";
  if (kind === "wallet_activity_summary") return "Review a wallet recipient before policy-controlled spend.";
  if (kind === "policy_risk_review") return "Review agent spending controls before execution.";
  if (kind === "x402_integration_planner") return "Plan a paid API integration and settlement path.";
  if (kind === "stablecoin_route_report") return "Compare stablecoin movement or routing before execution.";
  return `Purchase ${service.name} through a policy-controlled x402 flow.`;
}

export function paymentMemoSummary(payment: Pick<PaymentRecord, "memo" | "serviceName" | "amountUsdc" | "status">) {
  const memo = normalizeMemo(payment.memo);
  return {
    memoId: memo?.memoId ?? null,
    budgetBucket: memo?.memoData.budgetBucket ?? "general",
    intent: memo?.memoData.intent ?? `Purchase ${payment.serviceName}`,
    privacyScope: memo?.memoData.privacy.scope ?? "public",
    amountUsdc: Number(payment.amountUsdc || 0),
    status: payment.status
  };
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePrivacyScope(value: unknown): NexoraMemoScope {
  if (value === "private" || value === "selective") return value;
  return "public";
}

function roundUsdc(value: number) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}
