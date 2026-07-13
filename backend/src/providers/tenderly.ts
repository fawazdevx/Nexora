export type TenderlyConfig = {
  accessKey: string;
  accountSlug: string;
  projectSlug: string;
  apiUrl: string;
};

export type TenderlySimulationRequest = {
  chainId: number;
  from: string;
  to: string;
  input: string;
  value: string;
  gas: string;
  blockNumber: string;
};

export function tenderlyReadiness(config: TenderlyConfig) {
  const configured = Boolean(config.accessKey && config.accountSlug && config.projectSlug);
  return {
    configured,
    status: configured ? "configured" : "not_configured",
    apiUrl: config.apiUrl,
    requiredEnv: ["TENDERLY_ACCESS_KEY", "TENDERLY_ACCOUNT_SLUG", "TENDERLY_PROJECT_SLUG"],
    note: configured
      ? "Tenderly simulation is configured for transaction preflight checks."
      : "Tenderly simulation is optional. Add credentials to enable live transaction preflight checks."
  };
}

export function tenderlySimulationFromArgs(args: Record<string, unknown>): TenderlySimulationRequest {
  return {
    chainId: numberArg(args.chainId ?? args.networkId, "chainId"),
    from: addressArg(args.from, "from"),
    to: addressArg(args.to ?? args.contract, "to"),
    input: hexArg(args.input ?? args.data ?? "0x", "input"),
    value: stringAmountArg(args.value ?? "0", "value"),
    gas: stringAmountArg(args.gas ?? "8000000", "gas"),
    blockNumber: blockNumberArg(args.blockNumber ?? args.block_number ?? "latest", "blockNumber")
  };
}

export async function simulateWithTenderly(args: Record<string, unknown>, config: TenderlyConfig) {
  const readiness = tenderlyReadiness(config);
  const request = tenderlySimulationFromArgs(args);
  if (!readiness.configured) {
    return {
      status: "not_configured",
      providerStatus: readiness,
      request,
      summary: "Tenderly credentials are not configured, so Nexora could not run a live preflight simulation."
    };
  }

  const endpoint = `${config.apiUrl.replace(/\/$/, "")}/account/${encodeURIComponent(config.accountSlug)}/project/${encodeURIComponent(config.projectSlug)}/simulate`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-access-key": config.accessKey,
      "user-agent": "NexoraTenderlyPreflight/1.0"
    },
    body: JSON.stringify({
      network_id: String(request.chainId),
      from: request.from,
      to: request.to,
      input: request.input,
      value: request.value,
      gas: Number(request.gas),
      block_number: request.blockNumber,
      save: false,
      save_if_fails: false,
      simulation_type: "quick"
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  const data = text ? parseJson(text) : {};
  if (!response.ok) {
    return {
      status: "provider_error",
      decision: "manual_review",
      provider: "tenderly",
      live: false,
      providerStatus: readiness,
      request,
      message: `Tenderly returned ${response.status}`,
      detail: typeof data.error === "object" ? data.error : text.slice(0, 500)
    };
  }
  return normalizeTenderlyResponse(data, request, readiness);
}

export function normalizeTenderlyResponse(data: Record<string, unknown>, request: TenderlySimulationRequest, providerStatus: ReturnType<typeof tenderlyReadiness>) {
  const simulation = data.simulation as Record<string, unknown> | undefined;
  const transaction = simulation?.transaction as Record<string, unknown> | undefined;
  const status = transaction?.status === false || simulation?.status === false ? "failed" : "ok";
  const errorMessage = stringOrNull(simulation?.error_message ?? transaction?.error_message);
  const gasUsed = numberOrNull(transaction?.gas_used ?? simulation?.gas_used);
  return {
    status,
    decision: status === "ok" ? "allow" : "block",
    provider: "tenderly",
    live: true,
    providerStatus,
    request,
    gasUsed,
    transactionStatus: transaction?.status ?? simulation?.status ?? null,
    errorMessage,
    checks: [
      "Tenderly returned a live public-network simulation response.",
      status === "ok" ? "Simulation status indicates the transaction should execute." : "Simulation status indicates the transaction may revert.",
      gasUsed === null ? "Gas usage was not returned by the provider." : `Provider gas used: ${gasUsed}.`
    ],
    raw: data,
    summary: status === "ok" ? "Tenderly simulation completed successfully." : "Tenderly simulation indicates the transaction may fail."
  };
}

function numberArg(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`${label} must be a positive chain id`);
  return numeric;
}

function addressArg(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${label} must be a valid EVM address`);
  return value;
}

function hexArg(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x([a-fA-F0-9]{2})*$/.test(value)) throw new Error(`${label} must be hex data`);
  return value;
}

function stringAmountArg(value: unknown, label: string) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value).toString();
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new Error(`${label} must be a non-negative integer string`);
}

function blockNumberArg(value: unknown, label: string) {
  if (value === "latest") return "latest";
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new Error(`${label} must be latest or a non-negative block number`);
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {raw: text};
  }
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
