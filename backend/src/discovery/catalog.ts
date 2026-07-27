// Task 4 — Discoverability. Projects Nexora's published services into an x402
// discovery document that mirrors the shape Nexora itself consumes from Circle
// (`api.circle.com/v2/x402/discovery/resources`). Interop is symmetric: each
// resource carries an `accepts[]` array of x402 payment requirements that any
// x402 client — including Nexora's own inbound normalizer — can read.
//
// Pure projection over already-visible ServiceRecords. No storage, no secrets:
// only publicly sellable service data (name, description, price, payTo, schema).

import type {ServiceRecord} from "../store.js";
import {chainContext} from "../chains.js";
import {config} from "../config.js";

// x402 uses USDC base units (6 decimals) for amounts, as strings. Inverse of the
// inbound `usdcBaseUnitsAmount` (value / 1_000_000) in agent-marketplace.ts.
export function usdcToBaseUnits(usdc: number): string {
  if (!Number.isFinite(usdc) || usdc <= 0) return "0";
  return Math.round(usdc * 1_000_000).toString();
}

// Canonical payable resource URL — the existing marketplace execute route.
export function serviceResourceUrl(service: Pick<ServiceRecord, "id">, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/marketplace/services/${encodeURIComponent(service.id)}/execute`;
}

export type X402DiscoveryResource = {
  resource: string;
  type: "http";
  x402Version: 1 | 2;
  name: string;
  description: string;
  accepts: Array<{
    scheme: "exact";
    network: string;
    asset: string;
    payTo: string;
    maxAmountRequired?: string;
    amount?: string;
    resource?: string;
    description?: string;
    mimeType?: "application/json";
  }>;
  metadata: {
    serviceId: string;
    kind: ServiceRecord["manifest"]["kind"];
    version: string;
    publisher: string;
    trustTier: string | null;
    trustScore: number | null;
    inputSchema: ServiceRecord["manifest"]["inputSchema"];
    outputSchema: ServiceRecord["manifest"]["outputSchema"];
  };
};

export type DiscoveryOptions = {
  baseUrl: string;
  x402Version?: 1 | 2;
};

export function toX402Resource(service: ServiceRecord, opts: DiscoveryOptions): X402DiscoveryResource {
  const resource = serviceResourceUrl(service, opts.baseUrl);
  const description = service.manifest.description || service.name;
  const version = opts.x402Version ?? 1;
  const context = chainContext(service.settlementChainId ?? config.arc.chainId);
  const network = version === 2 ? `eip155:${context.chainId}` : context.key;
  const amount = usdcToBaseUnits(service.pricePerUnitUsdc);
  return {
    resource,
    type: "http",
    x402Version: version,
    name: service.name,
    description,
    accepts: [
      {
        scheme: "exact",
        network,
        asset: context.usdc,
        payTo: service.publisherAddress,
        ...(version === 2
          ? {amount}
          : {
            maxAmountRequired: amount,
            resource,
            description,
            mimeType: "application/json" as const
          })
      }
    ],
    metadata: {
      serviceId: service.id,
      kind: service.manifest.kind,
      version: service.manifest.version,
      publisher: service.publisherAddress,
      trustTier: service.trust?.tier ?? null,
      trustScore: service.trust?.score ?? null,
      inputSchema: service.manifest.inputSchema,
      outputSchema: service.manifest.outputSchema
    }
  };
}

export type X402DiscoveryDocument = {
  x402Version: 1 | 2;
  supportedVersions: [1, 2];
  facilitator: "Nexora";
  network?: string;
  asset?: string;
  updatedAt: string;
  resources: X402DiscoveryResource[];
};

// `services` should already be filtered to the publicly visible set
// (visibleServicesForStore) and have trust attached (attachServiceTrust).
export function buildDiscoveryDocument(services: ServiceRecord[], opts: DiscoveryOptions): X402DiscoveryDocument {
  return {
    x402Version: opts.x402Version ?? 1,
    supportedVersions: [1, 2],
    facilitator: "Nexora",
    ...((opts.x402Version ?? 1) === 1
      ? {network: "arc-testnet", asset: config.contracts.usdc}
      : {}),
    updatedAt: new Date().toISOString(),
    resources: services.map((service) => toX402Resource(service, opts))
  };
}
