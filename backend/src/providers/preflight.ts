import {createPublicClient, http, type Address, type Hex} from "viem";
import {simulateWithTenderly, tenderlyReadiness, tenderlySimulationFromArgs, type TenderlyConfig, type TenderlySimulationRequest} from "./tenderly.js";

export type PreflightDecision = "allow" | "block" | "manual_review";
export type PreflightProvider = "tenderly" | "rpc";

export type AgentTransactionPreflightOptions = {
  tenderly: TenderlyConfig;
  rpcUrls: Record<number, string | undefined>;
};

export type AgentTransactionPreflightResult = {
  status: "ok" | "failed" | "provider_error" | "provider_unavailable";
  decision: PreflightDecision;
  provider: PreflightProvider | null;
  live: boolean;
  request: TenderlySimulationRequest;
  gasUsed: number | null;
  errorMessage: string | null;
  checks: string[];
  summary: string;
  providerStatus?: unknown;
  raw?: unknown;
};

export function prepareTransactionPreflightArgs(args: Record<string, unknown>): TenderlySimulationRequest {
  const source = transactionSource(args);
  return tenderlySimulationFromArgs(source);
}

export async function runAgentTransactionPreflight(args: Record<string, unknown>, options: AgentTransactionPreflightOptions): Promise<AgentTransactionPreflightResult> {
  const request = prepareTransactionPreflightArgs(args);
  const provider = optionalProvider(args.provider);
  const readiness = tenderlyReadiness(options.tenderly);

  if (provider !== "rpc" && readiness.configured) {
    const tenderly = await simulateWithTenderly(request, options.tenderly).catch((error) => ({
      status: "provider_error",
      message: error instanceof Error ? error.message : "Tenderly request failed",
      providerStatus: readiness
    }));
    if (tenderly.status === "ok" || tenderly.status === "failed") return coercePreflightResult(tenderly);
    if (provider === "tenderly") return providerErrorResult(request, "tenderly", providerMessage(tenderly), tenderly);
  }

  if (provider !== "tenderly") {
    const rpcUrl = options.rpcUrls[request.chainId];
    if (rpcUrl) return simulateWithRpc(request, rpcUrl);
  }

  return {
    status: "provider_unavailable",
    decision: "manual_review",
    provider: null,
    live: false,
    request,
    gasUsed: null,
    errorMessage: null,
    providerStatus: {
      tenderly: readiness,
      rpc: options.rpcUrls[request.chainId] ? "configured" : "not_configured"
    },
    checks: [
      "No live preflight provider is available for this chain.",
      "Nexora did not run a simulation and will not mark this transaction as safe.",
      "Configure Tenderly or a chain RPC URL before allowing autonomous execution."
    ],
    summary: "No live transaction preflight provider is configured for this chain."
  };
}

export function normalizePreflightResult(input: {
  provider: PreflightProvider;
  request: TenderlySimulationRequest;
  callSucceeded: boolean;
  gasEstimate?: bigint | number | null;
  errorMessage?: string | null;
  raw?: unknown;
}): AgentTransactionPreflightResult {
  const gasUsed = gasNumber(input.gasEstimate ?? null);
  const status = input.callSucceeded ? "ok" : "failed";
  return {
    status,
    decision: input.callSucceeded ? "allow" : "block",
    provider: input.provider,
    live: true,
    request: input.request,
    gasUsed,
    errorMessage: input.errorMessage ?? null,
    raw: input.raw,
    checks: [
      input.provider === "rpc" ? "Live RPC eth_call completed against the selected chain." : "Live provider simulation completed.",
      input.callSucceeded ? "The call did not revert at the current chain state." : "The call reverted or could not be executed.",
      gasUsed === null ? "Gas estimate was not returned." : `Gas estimate: ${gasUsed}.`
    ],
    summary: input.callSucceeded
      ? "Live transaction preflight completed successfully."
      : "Live transaction preflight indicates the transaction may fail."
  };
}

async function simulateWithRpc(request: TenderlySimulationRequest, rpcUrl: string): Promise<AgentTransactionPreflightResult> {
  const client = createPublicClient({transport: http(rpcUrl, {timeout: 20_000})});
  const transaction = {
    account: request.from as Address,
    to: request.to as Address,
    data: request.input as Hex,
    value: BigInt(request.value),
    gas: BigInt(request.gas)
  };

  try {
    const blockSelector = request.blockNumber === "latest"
      ? {blockTag: "latest" as const}
      : {blockNumber: BigInt(request.blockNumber)};
    const callResult = await client.call({...transaction, ...blockSelector});
    const gasEstimate = await estimateGasOrNull(client, transaction);
    return normalizePreflightResult({
      provider: "rpc",
      request,
      callSucceeded: true,
      gasEstimate,
      raw: {callData: callResult.data ?? "0x"}
    });
  } catch (error) {
    return normalizePreflightResult({
      provider: "rpc",
      request,
      callSucceeded: false,
      errorMessage: error instanceof Error ? error.message : "RPC preflight failed"
    });
  }
}

async function estimateGasOrNull(client: ReturnType<typeof createPublicClient>, transaction: {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
  gas: bigint;
}) {
  try {
    return await client.estimateGas(transaction);
  } catch {
    return null;
  }
}

function transactionSource(args: Record<string, unknown>) {
  const transaction = args.transaction ?? args.tx;
  if (typeof transaction === "string") {
    const parsed = parseTransactionJson(transaction);
    if (parsed) return parsed;
  }
  if (isRecord(transaction)) return transaction;
  return args;
}

function parseTransactionJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    throw new Error("transaction must be valid JSON when provided as text");
  }
  throw new Error("transaction must be a JSON object");
}

function optionalProvider(value: unknown): PreflightProvider | "auto" {
  if (value === "tenderly" || value === "rpc") return value;
  return "auto";
}

function coercePreflightResult(value: Record<string, unknown>): AgentTransactionPreflightResult {
  return {
    status: value.status === "failed" ? "failed" : "ok",
    decision: value.decision === "block" ? "block" : "allow",
    provider: "tenderly",
    live: true,
    request: value.request as TenderlySimulationRequest,
    gasUsed: typeof value.gasUsed === "number" ? value.gasUsed : null,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    providerStatus: value.providerStatus,
    raw: value.raw,
    checks: Array.isArray(value.checks) ? value.checks.filter((item): item is string => typeof item === "string") : ["Tenderly returned a live simulation response."],
    summary: typeof value.summary === "string" ? value.summary : "Tenderly simulation completed."
  };
}

function providerErrorResult(request: TenderlySimulationRequest, provider: PreflightProvider, message: string, raw: unknown): AgentTransactionPreflightResult {
  return {
    status: "provider_error",
    decision: "manual_review",
    provider,
    live: false,
    request,
    gasUsed: null,
    errorMessage: message,
    raw,
    checks: [
      "A live provider was configured but did not return a successful simulation.",
      "Nexora did not mark this transaction as safe.",
      "Retry after checking provider credentials, chain support, and request payload."
    ],
    summary: message
  };
}

function providerMessage(value: unknown) {
  if (isRecord(value) && typeof value.message === "string" && value.message.trim()) return value.message;
  return "Tenderly did not return a simulation result.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function gasNumber(value: bigint | number | null) {
  if (typeof value === "bigint") return Number(value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : BigInt(Number.MAX_SAFE_INTEGER));
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
