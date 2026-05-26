import {config} from "../config.js";

type SynthraRequest = {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  recipient?: string;
  sender?: string;
  owner?: string;
  slippageBps?: number;
};

export function synthraReadiness() {
  return {
    configured: Boolean(config.integrations.synthraApiKey),
    apiUrl: config.integrations.synthraApiUrl
  };
}

export async function synthraQuote(input: SynthraRequest) {
  return synthraPost("/v1/quote", {
    chainId: input.chainId,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    tradeType: "EXACT_INPUT",
    routeQualityPolicy: "best_output"
  });
}

export async function synthraApproval(input: SynthraRequest) {
  return synthraPost("/v1/approval", {
    chainId: input.chainId,
    token: input.tokenIn,
    amount: input.amount,
    owner: input.owner ?? input.sender,
    approvalMode: "erc20"
  });
}

export async function synthraSwap(input: SynthraRequest) {
  return synthraPost("/v1/swap", {
    chainId: input.chainId,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amount: input.amount,
    recipient: input.recipient,
    sender: input.sender,
    approvalMode: "erc20",
    slippageBps: input.slippageBps ?? 100,
    deadlineSeconds: 1200
  });
}

async function synthraPost(path: string, body: Record<string, unknown>) {
  if (!config.integrations.synthraApiKey) {
    throw new Error("SYNTHRA_API_KEY is not configured");
  }

  const response = await fetch(`${config.integrations.synthraApiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": config.integrations.synthraApiKey
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  const data = raw ? tryParseJson(raw) : {};
  if (!response.ok) {
    const message = typeof data.error === "string"
      ? data.error
      : typeof data.message === "string"
        ? data.message
        : raw || `Synthra API request failed: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function tryParseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {raw};
  }
}
