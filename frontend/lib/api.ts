const API_URL = import.meta.env.VITE_NEXORA_API_URL ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `API request failed: ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  try {
    const response = await fetch(buildApiUrl(path));
    return parseResponse<T>(response);
  } catch {
    throw new Error(apiConnectionHint(path));
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  try {
    const response = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body)
    });

    return parseResponse<T>(response);
  } catch {
    throw new Error(apiConnectionHint(path));
  }
}

export type AppSnapshot = {
  agents: Array<{
    id: string;
    operatorAddress: string;
    arcName: string | null;
    address: string | null;
    circleWalletStatus: string;
    createdAt: string;
    policy: {
      dailyLimitUsdc: number;
      transactionCapUsdc: number;
      contractAllowlist: string[];
      recipientAllowlist: string[];
      active: boolean;
      txHash?: string | null;
    };
  }>;
  services: Array<{
    id: string;
    chainServiceId: number | null;
    publisherAddress: string;
    name: string;
    endpointHash: string;
    pricePerUnitUsdc: number;
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
    publisherAddress: string;
    amountUsdc: number;
    units: number;
    requestHash: string;
    status: string;
    txHash?: string | null;
    createdAt: string;
  }>;
  subscriptions: Array<{id: string; operatorAddress: string; plan: string; amountUsdc: number; status: string}>;
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
