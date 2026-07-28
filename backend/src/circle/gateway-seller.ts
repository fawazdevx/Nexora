import {BatchFacilitatorClient, createGatewayMiddleware, GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS, type GatewayMiddleware} from "@circle-fin/x402-batching/server";
import {isAddress} from "viem";
import {config} from "../config.js";
import {buildServiceManifest, executeBuiltInService} from "../marketplace/services.js";
import {CANONICAL_MARKETPLACE_SERVICES, canonicalMarketplaceService} from "../marketplace/canonical-catalog.js";

type GatewaySellerMode = "testnet" | "mainnet";

type GatewayNetwork = {
  network: string;
  chainId: number;
  label: string;
};

type GatewaySellerMiddlewareFactory = (input: {
  sellerAddress: string;
  networks: string[];
  facilitatorUrl: string;
  description: string;
}) => GatewayMiddleware;

type GatewaySellerDependencies = {
  middlewareFactory?: GatewaySellerMiddlewareFactory;
};

type GatewayRuntimeOverrides = {
  mode?: GatewaySellerMode;
  enabled?: boolean;
  agentMainnetsEnabled?: boolean;
  networks?: string;
  facilitatorUrl?: string;
};

let middlewareCache = new Map<string, GatewayMiddleware>();
let supportedKindsCache = new Map<string, {expiresAt: number; kinds: GatewaySupportedKind[]}>();

type GatewaySupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: {
    verifyingContract?: unknown;
    assets?: Array<{symbol?: unknown; address?: unknown}>;
  };
};

export function resolveCircleGatewaySellerRuntime(overrides: GatewayRuntimeOverrides = {}) {
  const mode = overrides.mode ?? config.circle.gatewaySeller.mode;
  const requestedEnabled = overrides.enabled ?? config.circle.gatewaySeller.enabled;
  const mainnetAllowed = overrides.agentMainnetsEnabled ?? config.circle.agentMainnetsEnabled;
  const availableNetworks = gatewayNetworksForMode(mode);
  const configuredNetworks = parseConfiguredNetworks(overrides.networks ?? config.circle.gatewaySeller.networks, availableNetworks);
  const mainnetLocked = mode === "mainnet" && !mainnetAllowed;
  const configurationError = configuredNetworks.error;
  const enabled = requestedEnabled && !mainnetLocked && configurationError === null;

  return {
    mode,
    requestedEnabled,
    enabled,
    mainnetAllowed,
    mainnetLocked,
    facilitatorUrl: overrides.facilitatorUrl ?? config.circle.gatewaySeller.facilitatorUrl,
    networks: configuredNetworks.networks,
    configurationError
  };
}

export function circleGatewaySellerCatalog(baseUrl?: string) {
  const sellerAddress = configuredSellerAddress();
  const runtime = resolveCircleGatewaySellerRuntime();
  const configured = sellerAddress !== null;
  const ready = runtime.enabled && configured;
  return {
    enabled: runtime.enabled,
    requestedEnabled: runtime.requestedEnabled,
    configured,
    ready,
    status: gatewaySellerStatus({runtime, configured}),
    mode: runtime.mode,
    sellerAddress,
    facilitatorUrl: runtime.facilitatorUrl,
    networks: runtime.networks.map((network) => network.network),
    networkDetails: runtime.networks,
    mainnetActivation: {
      allowed: runtime.mainnetAllowed,
      locked: runtime.mainnetLocked,
      requiredEnvironment: runtime.mode === "mainnet" && runtime.mainnetLocked
        ? ["NEXORA_CIRCLE_GATEWAY_SELLER_MODE=mainnet", "NEXORA_ENABLE_AGENT_MAINNETS=true"]
        : []
    },
    configurationError: runtime.configurationError,
    services: CANONICAL_MARKETPLACE_SERVICES.map((service) => {
      const path = `/api/circle/nanopayments/services/${service.endpointHash}`;
      return {
        ...service,
        manifest: buildServiceManifest(service),
        path,
        resource: absoluteResourceUrl(path, baseUrl),
        method: "POST" as const,
        x402Version: 2 as const,
        scheme: "exact" as const,
        settlement: "circle_gateway_nanopayments" as const
      };
    })
  };
}

export async function circleGatewayDiscoveryDocument(baseUrl?: string, query?: string) {
  const catalog = circleGatewaySellerCatalog(baseUrl);
  const runtime = resolveCircleGatewaySellerRuntime();
  const term = query?.trim().toLowerCase();
  const services = term
    ? catalog.services.filter((service) => (
      service.name.toLowerCase().includes(term)
      || service.manifest.description.toLowerCase().includes(term)
      || service.endpointHash.includes(term)
    ))
    : catalog.services;
  const supportedKinds = catalog.ready ? await gatewaySupportedKinds(runtime).catch(() => []) : [];
  const supportedByNetwork = new Map(supportedKinds.map((kind) => [kind.network, kind]));

  return {
    x402Version: 2 as const,
    supportedVersions: [1, 2] as const,
    facilitator: "Circle Gateway",
    environment: catalog.mode,
    status: catalog.status,
    updatedAt: new Date().toISOString(),
    resources: services.map((service) => ({
      resource: service.resource,
      type: "http" as const,
      x402Version: 2 as const,
      name: service.name,
      description: service.manifest.description,
      accepts: catalog.networks.flatMap((network) => {
        const kind = supportedByNetwork.get(network);
        const verifyingContract = stringValue(kind?.extra?.verifyingContract);
        const asset = kind?.extra?.assets?.find((item) => item.symbol === "USDC");
        const assetAddress = stringValue(asset?.address);
        if (!verifyingContract || !assetAddress || !catalog.sellerAddress) return [];
        return [{
          scheme: "exact" as const,
          network,
          asset: assetAddress,
          amount: Math.round(service.pricePerUnitUsdc * 1_000_000).toString(),
          payTo: catalog.sellerAddress,
          maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
          extra: {name: "GatewayWalletBatched", version: "1", verifyingContract}
        }];
      }),
      metadata: {
        endpointHash: service.endpointHash,
        kind: service.manifest.kind,
        version: service.manifest.version,
        pricePerUnitUsdc: service.pricePerUnitUsdc,
        inputSchema: service.manifest.inputSchema,
        outputSchema: service.manifest.outputSchema,
        requirementsSource: "Send an unpaid request to the resource for current payment requirements."
      }
    }))
  };
}

export async function executeCircleGatewaySellerRequest(input: {
  endpointHash: string;
  args: Record<string, unknown>;
  paymentSignature?: string | null;
  resourceUrl: string;
}, dependencies: GatewaySellerDependencies = {}) {
  const runtime = resolveCircleGatewaySellerRuntime();
  if (!runtime.requestedEnabled) {
    return unavailable("Circle Gateway seller routes are disabled.");
  }
  if (runtime.mainnetLocked) {
    return unavailable("Circle Gateway mainnet seller routes require explicit mainnet activation.");
  }
  if (runtime.configurationError) {
    return unavailable(runtime.configurationError);
  }
  const sellerAddress = configuredSellerAddress();
  if (!sellerAddress) {
    return unavailable("Circle Gateway seller wallet is not configured.");
  }
  const definition = canonicalMarketplaceService(input.endpointHash);
  if (!definition) return {status: 404, headers: {"content-type": "application/json"}, body: {error: "service_not_found"}};
  const inputError = validateSellerInput(definition, input.args);
  if (inputError) return {status: 400, headers: {"content-type": "application/json"}, body: {error: inputError}};

  const networks = runtime.networks.map((network) => network.network);
  const middleware = dependencies.middlewareFactory?.({
    sellerAddress,
    networks,
    facilitatorUrl: runtime.facilitatorUrl,
    description: definition.name
  }) ?? gatewayMiddleware(definition.endpointHash, sellerAddress, definition.name, runtime);

  const headers: Record<string, string> = {};
  if (input.paymentSignature?.trim()) headers["payment-signature"] = input.paymentSignature.trim();
  const request = {
    method: "POST",
    url: input.resourceUrl,
    headers,
    body: input.args,
    payment: undefined as unknown
  };
  let statusCode = 200;
  const responseHeaders: Record<string, string> = {};
  let responseBody: unknown = null;
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    },
    end(value?: string | Uint8Array) {
      responseBody = decodeResponseBody(value);
    }
  };

  await middleware.require(String(definition.pricePerUnitUsdc))(request as never, response as never, async () => {
    const result = await executeBuiltInService(definition.manifestKind, input.args);
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      service: {
        name: definition.name,
        endpointHash: definition.endpointHash,
        pricePerUnitUsdc: definition.pricePerUnitUsdc
      },
      payment: request.payment ?? null,
      result
    }));
  });

  return {
    status: statusCode,
    headers: responseHeaders,
    body: safeGatewaySellerBody(statusCode, responseBody)
  };
}

export function resetCircleGatewaySellerCacheForTests() {
  middlewareCache = new Map();
  supportedKindsCache = new Map();
}

function gatewayMiddleware(
  endpointHash: string,
  sellerAddress: string,
  description: string,
  runtime: ReturnType<typeof resolveCircleGatewaySellerRuntime>
) {
  const networks = runtime.networks.map((network) => network.network);
  const key = [
    runtime.mode,
    runtime.facilitatorUrl,
    sellerAddress.toLowerCase(),
    endpointHash,
    ...networks
  ].join(":");
  const cached = middlewareCache.get(key);
  if (cached) return cached;
  const middleware = createGatewayMiddleware({
    sellerAddress,
    networks,
    facilitatorUrl: runtime.facilitatorUrl,
    description
  });
  middlewareCache.set(key, middleware);
  return middleware;
}

function gatewayNetworksForMode(mode: GatewaySellerMode): GatewayNetwork[] {
  if (mode === "mainnet") {
    return [
      {network: `eip155:${config.base.mainnetChainId}`, chainId: config.base.mainnetChainId, label: "Base"},
      {network: `eip155:${config.arbitrum.oneChainId}`, chainId: config.arbitrum.oneChainId, label: "Arbitrum One"}
    ];
  }
  return [
    {network: `eip155:${config.arc.chainId}`, chainId: config.arc.chainId, label: "Arc Testnet"},
    {network: `eip155:${config.base.sepoliaChainId}`, chainId: config.base.sepoliaChainId, label: "Base Sepolia"},
    {network: `eip155:${config.arbitrum.sepoliaChainId}`, chainId: config.arbitrum.sepoliaChainId, label: "Arbitrum Sepolia"}
  ];
}

function parseConfiguredNetworks(value: string, available: GatewayNetwork[]) {
  const requested = value.split(/[\s,]+/).map((network) => network.trim().toLowerCase()).filter(Boolean);
  if (requested.length === 0) return {networks: available, error: null as string | null};
  const allowed = new Map(available.map((network) => [network.network.toLowerCase(), network]));
  const unsupported = requested.filter((network) => !allowed.has(network));
  if (unsupported.length > 0) {
    return {
      networks: [] as GatewayNetwork[],
      error: `NEXORA_CIRCLE_GATEWAY_SELLER_NETWORKS contains networks that are not allowed in this mode: ${unsupported.join(", ")}`
    };
  }
  return {
    networks: [...new Set(requested)].map((network) => allowed.get(network) as GatewayNetwork),
    error: null as string | null
  };
}

function gatewaySellerStatus(input: {runtime: ReturnType<typeof resolveCircleGatewaySellerRuntime>; configured: boolean}) {
  if (!input.runtime.requestedEnabled) return "disabled";
  if (input.runtime.mainnetLocked) return "mainnet_locked";
  if (input.runtime.configurationError) return "invalid_configuration";
  if (!input.configured) return "seller_wallet_required";
  return "ready";
}

function configuredSellerAddress() {
  return isAddress(config.contracts.marketplacePublisher) ? config.contracts.marketplacePublisher : null;
}

async function gatewaySupportedKinds(runtime: ReturnType<typeof resolveCircleGatewaySellerRuntime>) {
  const cached = supportedKindsCache.get(runtime.facilitatorUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.kinds;
  const client = new BatchFacilitatorClient({url: runtime.facilitatorUrl});
  const supported = await client.getSupported();
  const kinds = (supported.kinds as GatewaySupportedKind[]).filter((kind) => (
    kind.x402Version === 2
    && kind.scheme === "exact"
    && runtime.networks.some((network) => network.network === kind.network)
  ));
  supportedKindsCache.set(runtime.facilitatorUrl, {expiresAt: Date.now() + 5 * 60_000, kinds});
  return kinds;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function absoluteResourceUrl(path: string, baseUrl?: string) {
  if (!baseUrl?.trim()) return path;
  return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function unavailable(message: string) {
  return {status: 503, headers: {"content-type": "application/json"}, body: {error: message}};
}

function decodeResponseBody(value?: string | Uint8Array) {
  if (value === undefined) return null;
  const text = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function safeGatewaySellerBody(status: number, body: unknown) {
  if (status < 500) return body;
  return {error: "Circle Gateway payment processing is temporarily unavailable."};
}

function validateSellerInput(definition: (typeof CANONICAL_MARKETPLACE_SERVICES)[number], args: Record<string, unknown>) {
  const manifest = buildServiceManifest(definition);
  for (const field of manifest.inputSchema) {
    const value = args[field.name];
    if (field.required && (typeof value !== "string" || value.trim() === "")) return `${field.label} is required.`;
    if (typeof value === "string" && value.length > 4_000) return `${field.label} is too long.`;
  }
  return null;
}
