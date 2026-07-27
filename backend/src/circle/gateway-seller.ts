import {createGatewayMiddleware, type GatewayMiddleware} from "@circle-fin/x402-batching/server";
import {isAddress} from "viem";
import {config} from "../config.js";
import {buildServiceManifest, executeBuiltInService} from "../marketplace/services.js";
import {CANONICAL_MARKETPLACE_SERVICES, canonicalMarketplaceService} from "../marketplace/canonical-catalog.js";

const TESTNET_NETWORKS = [
  `eip155:${config.arc.chainId}`,
  `eip155:${config.base.sepoliaChainId}`,
  `eip155:${config.arbitrum.sepoliaChainId}`
];

type GatewaySellerMiddlewareFactory = (input: {
  sellerAddress: string;
  networks: string[];
  facilitatorUrl: string;
  description: string;
}) => GatewayMiddleware;

type GatewaySellerDependencies = {
  middlewareFactory?: GatewaySellerMiddlewareFactory;
};

let middlewareCache = new Map<string, GatewayMiddleware>();

export function circleGatewaySellerCatalog() {
  const sellerAddress = configuredSellerAddress();
  return {
    enabled: config.circle.gatewaySeller.enabled,
    configured: sellerAddress !== null,
    sellerAddress,
    facilitatorUrl: config.circle.gatewaySeller.facilitatorUrl,
    networks: TESTNET_NETWORKS,
    services: CANONICAL_MARKETPLACE_SERVICES.map((service) => ({
      ...service,
      manifest: buildServiceManifest(service),
      path: `/api/circle/nanopayments/services/${service.endpointHash}`,
      x402Version: 2,
      scheme: "exact"
    }))
  };
}

export async function executeCircleGatewaySellerRequest(input: {
  endpointHash: string;
  args: Record<string, unknown>;
  paymentSignature?: string | null;
  resourceUrl: string;
}, dependencies: GatewaySellerDependencies = {}) {
  if (!config.circle.gatewaySeller.enabled) {
    return {status: 503, headers: {"content-type": "application/json"}, body: {error: "Circle Gateway seller routes are disabled."}};
  }
  const sellerAddress = configuredSellerAddress();
  if (!sellerAddress) {
    return {status: 503, headers: {"content-type": "application/json"}, body: {error: "Circle Gateway seller wallet is not configured."}};
  }
  const definition = canonicalMarketplaceService(input.endpointHash);
  if (!definition) return {status: 404, headers: {"content-type": "application/json"}, body: {error: "service_not_found"}};
  const inputError = validateSellerInput(definition, input.args);
  if (inputError) return {status: 400, headers: {"content-type": "application/json"}, body: {error: inputError}};

  const middleware = dependencies.middlewareFactory?.({
    sellerAddress,
    networks: TESTNET_NETWORKS,
    facilitatorUrl: config.circle.gatewaySeller.facilitatorUrl,
    description: definition.name
  }) ?? gatewayMiddleware(definition.endpointHash, sellerAddress, definition.name);

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
}

function gatewayMiddleware(endpointHash: string, sellerAddress: string, description: string) {
  const key = `${sellerAddress.toLowerCase()}:${endpointHash}`;
  const cached = middlewareCache.get(key);
  if (cached) return cached;
  const middleware = createGatewayMiddleware({
    sellerAddress,
    networks: TESTNET_NETWORKS,
    facilitatorUrl: config.circle.gatewaySeller.facilitatorUrl,
    description
  });
  middlewareCache.set(key, middleware);
  return middleware;
}

function configuredSellerAddress() {
  return isAddress(config.contracts.marketplacePublisher) ? config.contracts.marketplacePublisher : null;
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
