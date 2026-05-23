import {readStore, updateStore} from "../store.js";
import {config} from "../config.js";

type ServiceInput = {
  publisherAddress: string;
  name: string;
  endpointHash: string;
  pricePerUnitUsdc: number;
  chainServiceId?: number | null;
  txHash?: string | null;
  featured?: boolean;
};

export async function listServices() {
  const store = await readStore();
  return store.services;
}

export async function getService(serviceId: string) {
  const store = await readStore();
  return store.services.find((service) => service.id === serviceId || String(service.chainServiceId) === serviceId);
}

export async function publishService(input: ServiceInput) {
  return updateStore((store) => {
    const service = {
      id: input.chainServiceId ? String(input.chainServiceId) : crypto.randomUUID(),
      chainServiceId: input.chainServiceId ?? null,
      publisherAddress: input.publisherAddress,
      name: input.name,
      endpointHash: input.endpointHash,
      pricePerUnitUsdc: input.pricePerUnitUsdc,
      active: true,
      featured: Boolean(input.featured),
      txHash: input.txHash ?? null,
      createdAt: new Date().toISOString()
    };

    const existingIndex = store.services.findIndex(
      (item) => item.id === service.id || (service.chainServiceId !== null && item.chainServiceId === service.chainServiceId)
    );
    if (existingIndex >= 0) store.services[existingIndex] = service;
    else store.services.push(service);

    return service;
  });
}

export async function featureService(input: {serviceId: string; operatorAddress: string}) {
  return updateStore((store) => {
    const service = store.services.find((item) => item.id === input.serviceId || String(item.chainServiceId) === input.serviceId);
    if (!service) throw new Error("service not found");
    if (service.publisherAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) throw new Error("publisher wallet required");
    service.featured = true;
    return service;
  });
}

export async function platformPlans() {
  return [
    {
      id: "developer_analytics",
      name: "Developer analytics",
      amountUsdc: 29,
      interval: "month",
      benefit: "API usage analytics and hosted service manifests"
    },
    {
      id: "premium_agent_automation",
      name: "Premium agent automation",
      amountUsdc: 49,
      interval: "month",
      benefit: "Higher automation limits and yield route monitoring"
    },
    {
      id: "enterprise_policy",
      name: "Enterprise wallet policy",
      amountUsdc: 299,
      interval: "month",
      benefit: "Multi-agent policy management and compliance export"
    },
    {
      id: "verified_builder",
      name: "Verified builder badge",
      amountUsdc: 15,
      interval: "one_time",
      benefit: "Reputation badge review and marketplace trust signal"
    }
  ];
}

export async function subscribePlan(input: {operatorAddress: string; plan: string; amountUsdc: number}) {
  return updateStore((store) => {
    const subscription = {
      id: crypto.randomUUID(),
      ...input,
      status: "pending_payment" as const,
      createdAt: new Date().toISOString()
    };
    store.subscriptions.push(subscription);
    return subscription;
  });
}

export async function executeMarketplaceService(input: {
  serviceId: string;
  payer: string;
  args?: Record<string, unknown>;
}) {
  const service = await getService(input.serviceId);
  if (!service) throw new Error("service not found");

  const args = input.args ?? {};
  const kind = normalizeServiceKind(service);

  if (kind === "x_account_analyzer") {
    const handle = requiredString(args.handle ?? args.username, "handle");
    return {
      serviceId: service.id,
      kind,
      input: {handle},
      result: await analyzeXAccount(handle)
    };
  }

  return {
    serviceId: service.id,
    kind,
    input: args,
    result: {
      summary: "Service executed",
      note: "Define a backend execution handler for this endpointHash to return structured output."
    }
  };
}

function normalizeServiceKind(service: Awaited<ReturnType<typeof getService>>) {
  const marker = `${service?.name ?? ""} ${service?.endpointHash ?? ""}`.toLowerCase();
  if (marker.includes("x account") || marker.includes("x-account") || marker.includes("twitter")) return "x_account_analyzer";
  return "generic";
}

async function analyzeXAccount(handle: string) {
  if (!config.integrations.xBearerToken) {
    return {
      status: "not_configured",
      message: "Set X_BEARER_TOKEN in the backend environment to fetch real X account data."
    };
  }

  const username = handle.replace(/^@/, "");
  const response = await fetch(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,verified,created_at,description`,
    {
      headers: {
        authorization: `Bearer ${config.integrations.xBearerToken}`
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return {
      status: "error",
      message: `X API returned ${response.status}`,
      detail: body.slice(0, 240)
    };
  }

  const data = await response.json() as {
    data?: {
      id?: string;
      name?: string;
      username?: string;
      created_at?: string;
      verified?: boolean;
      description?: string;
      public_metrics?: {
        followers_count?: number;
        following_count?: number;
        tweet_count?: number;
        listed_count?: number;
      };
    };
  };

  const user = data.data;
  if (!user) {
    return {status: "empty", message: "No X account data returned."};
  }

  const followers = user.public_metrics?.followers_count ?? 0;
  const following = user.public_metrics?.following_count ?? 0;
  const tweets = user.public_metrics?.tweet_count ?? 0;
  const listed = user.public_metrics?.listed_count ?? 0;
  const score = Math.min(100, Math.round(followers / 1000 + tweets / 100 + listed * 2 + (user.verified ? 15 : 0) - following / 1000));

  return {
    status: "ok",
    account: {
      id: user.id,
      name: user.name,
      username: user.username,
      verified: Boolean(user.verified),
      createdAt: user.created_at
    },
    metrics: {
      followers,
      following,
      tweets,
      listed
    },
    score,
    summary: score >= 70 ? "Strong account signal" : score >= 40 ? "Moderate account signal" : "Low account signal"
  };
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}
