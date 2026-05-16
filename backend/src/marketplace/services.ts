import {readStore, updateStore} from "../store.js";

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
