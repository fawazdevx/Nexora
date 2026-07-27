import {BatchEvmScheme, CompositeEvmScheme, registerBatchScheme} from "@circle-fin/x402-batching/client";
import {initiateDeveloperControlledWalletsClient} from "@circle-fin/developer-controlled-wallets";
import {decodePaymentResponseHeader, wrapFetchWithPayment, x402Client} from "@x402/fetch";
import {ExactEvmScheme} from "@x402/evm";
import {isAddress, type Address, type Hex} from "viem";
import {config} from "../config.js";

export type CircleDeveloperWalletX402Input = {
  walletId: string;
  walletAddress: string;
  chain: string;
  serviceUrl: string;
  method: string;
  data: Record<string, unknown>;
  maxAmountUsdc: number;
};

export type CircleDeveloperWalletX402Result = {
  result: unknown;
  txHash: string | null;
  paymentResponse: unknown;
  paymentScheme: string;
};

type CircleSigningClient = {
  signTypedData(input: {walletId: string; data: string; memo?: string}): Promise<{data?: {signature?: string} | null}>;
};

type ManagedX402Dependencies = {
  circleClient?: CircleSigningClient;
  fetchImpl?: typeof globalThis.fetch;
};

/**
 * Pays an external x402 resource from a specific Circle developer-controlled
 * wallet. The wallet key never enters Nexora: Circle signs the exact EIP-712
 * authorization requested by the standard x402 client.
 */
export async function executeCircleDeveloperWalletX402(
  input: CircleDeveloperWalletX402Input,
  dependencies: ManagedX402Dependencies = {}
): Promise<CircleDeveloperWalletX402Result> {
  if (!input.walletId.trim()) throw publicExecutionError("The selected agent wallet is not ready for Circle payments.");
  if (!isAddress(input.walletAddress)) throw publicExecutionError("The selected agent wallet address is invalid.");
  if (!Number.isFinite(input.maxAmountUsdc) || input.maxAmountUsdc <= 0) throw publicExecutionError("The payment amount is invalid.");

  const network = networkForCircleChain(input.chain);
  const circle = dependencies.circleClient ?? managedCircleClient();
  const signer = {
    address: input.walletAddress as Address,
    async signTypedData(params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) {
      const response = await circle.signTypedData({
        walletId: input.walletId,
        data: stringifyTypedData(params),
        memo: `Nexora x402 payment to ${new URL(input.serviceUrl).hostname}`
      });
      const signature = response.data?.signature;
      if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) {
        throw publicExecutionError("Circle did not return a valid payment authorization signature.");
      }
      return signature as Hex;
    }
  };

  const exact = new ExactEvmScheme(signer);
  const client = new x402Client((version, requirements) => {
    const compatible = requirements.filter((requirement) => networkMatches(requirement.network, network));
    if (compatible.length === 0) throw publicExecutionError("This service does not accept the selected agent wallet network.");
    const withinCap = compatible.filter((requirement) => paymentAmount(requirement) <= usdcAtomic(input.maxAmountUsdc));
    if (withinCap.length === 0) throw publicExecutionError("The service price exceeds the approved Nexora payment amount.");
    return withinCap.find((requirement) => objectValue(requirement.extra).name === "GatewayWalletBatched") ?? withinCap[0];
  });
  const registered = registerBatchScheme(client, {signer, fallbackScheme: exact});
  registerLegacyNetwork(client, network, registered);

  const fetchWithPayment = wrapFetchWithPayment(dependencies.fetchImpl ?? globalThis.fetch, client);
  const request = buildServiceRequest(input);
  let response: Response;
  try {
    response = await fetchWithPayment(request.url, request.init);
  } catch (error) {
    throw publicExecutionError(circleX402Error(error));
  }

  const raw = await response.text().catch(() => "");
  const result = parseResponseBody(raw, response.headers.get("content-type"));
  if (!response.ok) {
    throw publicExecutionError(response.status === 402
      ? "The service rejected the payment authorization. Refresh its payment details and try again."
      : `The paid service returned HTTP ${response.status}. No successful Nexora receipt was recorded.`);
  }

  const encodedPaymentResponse = response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
  const paymentResponse = decodePaymentResponse(encodedPaymentResponse);
  return {
    result,
    txHash: transactionHash(paymentResponse),
    paymentResponse,
    paymentScheme: objectValue(paymentResponse).network ? "x402-exact" : "x402"
  };
}

function managedCircleClient(): CircleSigningClient {
  if (!config.circle.apiKey || !config.circle.entitySecret) {
    throw publicExecutionError("Managed Circle wallet execution is not configured for this deployment.");
  }
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret
  }) as unknown as CircleSigningClient;
}

function registerLegacyNetwork(client: x402Client, network: ReturnType<typeof networkForCircleChain>, scheme: BatchEvmScheme | CompositeEvmScheme) {
  // @circle-fin/x402-batching intentionally exposes a minimal payload type so
  // it can support several @x402/core minor versions. The runtime shape is the
  // same, but @x402/fetch 2.19 narrows `payload` to Record<string, unknown>.
  // Keep the compatibility assertion at this package boundary instead of
  // weakening types throughout the managed-wallet executor.
  client.registerV1(network.legacy, scheme as unknown as Parameters<x402Client["registerV1"]>[1]);
}

function buildServiceRequest(input: CircleDeveloperWalletX402Input) {
  const method = normalizedMethod(input.method);
  const url = new URL(input.serviceUrl);
  const headers: Record<string, string> = {accept: "application/json"};
  let body: string | undefined;
  if (method === "GET" || method === "HEAD") {
    for (const [key, value] of Object.entries(input.data)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(input.data);
  }
  return {
    url,
    init: {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(90_000)
    } satisfies RequestInit
  };
}

function normalizedMethod(value: string) {
  const method = value.trim().toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method) ? method : "POST";
}

function networkForCircleChain(chain: string) {
  const normalized = chain.trim().toUpperCase().replace(/-/g, "_");
  if (normalized === "ARC" || normalized === "ARC_TESTNET") return {caip2: `eip155:${config.arc.chainId}`, legacy: "arc-testnet"};
  if (normalized === "BASE_SEPOLIA") return {caip2: `eip155:${config.base.sepoliaChainId}`, legacy: "base-sepolia"};
  if (normalized === "ARB_SEPOLIA" || normalized === "ARBITRUM_SEPOLIA") return {caip2: `eip155:${config.arbitrum.sepoliaChainId}`, legacy: "arbitrum-sepolia"};
  if (normalized === "BASE") return {caip2: `eip155:${config.base.mainnetChainId}`, legacy: "base"};
  if (normalized === "ARB" || normalized === "ARBITRUM") return {caip2: `eip155:${config.arbitrum.oneChainId}`, legacy: "arbitrum"};
  throw publicExecutionError("The selected Circle payment network is not supported by Nexora.");
}

function networkMatches(candidate: string, expected: ReturnType<typeof networkForCircleChain>) {
  const normalized = candidate.trim().toLowerCase().replace(/_/g, "-");
  return normalized === expected.caip2.toLowerCase() || normalized === expected.legacy;
}

function paymentAmount(requirement: {amount?: string; maxAmountRequired?: string}) {
  const value = requirement.amount ?? requirement.maxAmountRequired ?? "0";
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function usdcAtomic(value: number) {
  return BigInt(Math.round(value * 1_000_000));
}

function stringifyTypedData(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

function decodePaymentResponse(value: string | null) {
  if (!value) return null;
  try {
    return decodePaymentResponseHeader(value);
  } catch {
    return null;
  }
}

function transactionHash(value: unknown) {
  const record = objectValue(value);
  const candidates = [record.transaction, record.txHash, record.transactionHash, objectValue(record.receipt).transaction];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]{64}$/.test(candidate)) return candidate;
  }
  return null;
}

function parseResponseBody(raw: string, contentType: string | null) {
  if (!raw) return null;
  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return {message: raw.slice(0, 2_000)};
    }
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw.slice(0, 10_000);
  }
}

function circleX402Error(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/does not accept|exceeds the approved/i.test(message)) return message;
  if (/insufficient|balance|funds/i.test(message)) return "The selected Circle wallet does not have enough USDC for this service.";
  if (/denied|screening|compliance/i.test(message)) return "Circle denied this payment during wallet screening.";
  if (/timeout|abort/i.test(message)) return "The Circle service payment timed out before completion. No successful receipt was recorded.";
  return "Circle could not complete the service payment. Review the selected network and wallet balance, then try again.";
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function publicExecutionError(message: string) {
  return Object.assign(new Error(message), {status: 502});
}
