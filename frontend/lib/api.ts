const API_URL = import.meta.env.VITE_NEXORA_API_URL ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  const raw = await response.text().catch(() => "");
  const data = raw ? tryParseJson(raw) : {};
  if (!response.ok) {
    const message =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : raw.trim().length > 0
            ? raw.trim()
            : `API request failed: ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path));
  } catch {
    throw new Error(apiConnectionHint(path));
  }

  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error(apiConnectionHint(path));
  }

  return parseResponse<T>(response);
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: "DELETE",
      headers: body === undefined ? undefined : {"content-type": "application/json"},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error(apiConnectionHint(path));
  }

  return parseResponse<T>(response);
}

export type AppSnapshot = {
  agents: Array<{
    id: string;
    operatorAddress: string;
    arcName: string | null;
    address: string | null;
    circleWalletSetId?: string | null;
    circleWalletId?: string | null;
    circleWalletStatus: string;
    createdAt: string;
    policy: {
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
  }>;
  services: Array<{
    id: string;
    chainServiceId: number | null;
    publisherAddress: string;
    name: string;
    endpointHash: string;
    pricePerUnitUsdc: number;
    manifest: {
      kind: string;
      version: string;
      description: string;
      inputSchema: Array<{name: string; label: string; type: string; required: boolean; placeholder?: string}>;
      outputSchema: string[];
      revenueMode: string;
      platformFeeBps: number;
      webhookUrl?: string | null;
    };
    active: boolean;
    featured: boolean;
    txHash?: string | null;
  }>;
  payments: Array<{
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
    status: string;
    policyReason?: string | null;
    txHash?: string | null;
    createdAt: string;
  }>;
  approvalRequests: Array<{
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
  }>;
  riskAlerts: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    category: "policy" | "spend" | "approval" | "payment";
    title: string;
    detail: string;
    agentId?: string | null;
    serviceId?: string | null;
    actionHref?: string | null;
    createdAt: string;
  }>;
  subscriptions: Array<{
    id: string;
    operatorAddress: string;
    plan: string;
    planName?: string;
    amountUsdc: number;
    interval?: "month" | "one_time";
    status: string;
    txHash?: string | null;
    chainId?: number | null;
    activatedAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    createdAt: string;
  }>;
  escrows: Array<{
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
    status: string;
    deliverableUrl?: string | null;
    deliverableResult?: unknown;
    verifierNotes?: string | null;
    txHash?: string | null;
    createdAt: string;
    fundedAt?: string | null;
    submittedAt?: string | null;
    verifiedAt?: string | null;
    releasedAt?: string | null;
  }>;
  notifications: Array<{
    id: string;
    operatorAddress?: string | null;
    title: string;
    detail?: string | null;
    kind: string;
    txHash?: string | null;
    createdAt: string;
  }>;
  reputation: {
    successfulPayments: number;
    completedTasks: number;
    marketplaceSales: number;
    ecosystemContributions: number;
    verifiedBuilder: boolean;
    score: number;
  };
  stats: {
    agentWallets: number;
    usdcSettled: number;
    earnRoutes: number;
    policySaves: number;
    analyticsSource?: "indexed" | "local";
    indexedEvents?: number;
    saveEarnDepositVolumeUsdc?: number;
    saveEarnWithdrawalVolumeUsdc?: number;
  };
  access: {
    developerAnalytics: boolean;
    premiumAgentAutomation: boolean;
    enterprisePolicy: boolean;
  };
  readiness: {
    apiConfigured: boolean;
    onchainConfigured: boolean;
    circleConfigured: boolean;
  };
};

export function appSnapshotPath(operator?: string) {
  return `/api/app${operator ? `?operator=${encodeURIComponent(operator)}` : ""}`;
}

function apiConnectionHint(path: string) {
  const target = API_URL.trim().replace(/\/+$/, "") || "the current origin";
  return `Could not reach ${target}${path.startsWith("/") ? path : `/${path}`}. Check VITE_NEXORA_API_URL or the backend server.`;
}

function buildApiUrl(path: string) {
  const base = API_URL.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function apiUrlFor(path: string) {
  return buildApiUrl(path);
}

function tryParseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
