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

export async function apiGetWithHeaders<T>(path: string, headers: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {headers});
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

export async function apiPostWithHeaders<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: {"content-type": "application/json", ...headers},
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
    walletKind?: "circle_developer" | "external_eoa";
    operatorAddress: string;
    arcName: string | null;
    address: string | null;
    circleWalletSetId?: string | null;
    circleWalletId?: string | null;
    circleAccountType?: "EOA" | "SCA" | null;
    settlementMode?: "eoa_memo" | "sca_direct" | null;
    chainWallets?: Array<{
      chainId: number;
      chain: string;
      circleBlockchain: string;
      address: string | null;
      circleWalletId: string | null;
      status: string;
      updatedAt: string;
    }>;
    circleWalletStatus: string;
    createdAt: string;
    policy: {
      dailyLimitUsdc: number;
      transactionCapUsdc: number;
      contractAllowlist: string[];
      recipientAllowlist: string[];
      active: boolean;
      txHash?: string | null;
      deployments?: Array<{
        chainId: number;
        txHash: string;
        policyRegistry?: string | null;
        updatedAt: string;
      }>;
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
    settlementChainId?: number | null;
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
    trust?: {
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
    } | null;
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
    memo?: {
      protocol: "nexora.memo";
      version: "1.0";
      type: "nexora.x402.purchase";
      memoId: `0x${string}`;
      memoData: Record<string, unknown>;
      encoding: "json";
      arc: {
        memoContract: string;
        targetContract?: string | null;
        callDataHash?: string | null;
        memoIndex?: number | null;
      };
    } | null;
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
      assetSymbol?: string | null;
    } | null;
    createdAt: string;
    settledAt?: string | null;
  }>;
  paymentIntents: Array<{
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
  automationRecipes: Array<{
    id: string;
    operatorAddress: string;
    agentId?: string | null;
    name: string;
    description: string;
    trigger: "daily_spend_threshold" | "failed_payment_burst" | "pending_approval_expiring" | "policy_expiring" | "large_receipt" | "weekly_summary";
    action: "notify" | "pause_agent";
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
  }>;
  automationRuns: Array<{
    id: string;
    recipeId: string;
    operatorAddress: string;
    agentId?: string | null;
    trigger: "daily_spend_threshold" | "failed_payment_burst" | "pending_approval_expiring" | "policy_expiring" | "large_receipt" | "weekly_summary";
    action: "notify" | "pause_agent";
    status: "matched" | "skipped" | "failed";
    summary: string;
    createdAt: string;
  }>;
  escrowReminderRuns: Array<{
    id: string;
    escrowId: string;
    operatorAddress: string;
    role: "creator" | "counterparty";
    dueAt: string;
    offsetHours: number;
    status: "sent" | "skipped" | "failed";
    summary: string;
    createdAt: string;
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
    reminder?: {
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
    } | null;
  }>;
  notifications: Array<{
    id: string;
    operatorAddress?: string | null;
    title: string;
    detail?: string | null;
    kind: string;
    txHash?: string | null;
    receiptId?: string | null;
    actionHref?: string | null;
    createdAt: string;
  }>;
  notificationPreferences: {
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
  } | null;
  notificationDeliveries: Array<{
    id: string;
    notificationId: string;
    operatorAddress: string;
    channel: "email" | "whatsapp" | "telegram";
    target: string;
    status: "sent" | "skipped" | "failed";
    provider: string;
    reason?: string | null;
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
