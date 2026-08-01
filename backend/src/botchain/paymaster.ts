import {encodeFunctionData, type Abi, type Address, type Hex} from "viem";
import {config} from "../config.js";
import type {BotPolicyRuntime} from "../x402/meridian-facilitator.js";

type JsonRpcResponse = {
  result?: unknown;
  error?: {message?: string};
};

export async function isBotPaymasterSponsorable(input: {
  runtime: BotPolicyRuntime;
  from: Address;
  to: Address;
  data: Hex;
  value?: bigint;
}) {
  if (!config.botchain.paymasterEnabled || !input.runtime.paymasterUrl) return false;
  try {
    const response = await fetch(input.runtime.paymasterUrl, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "pm_isSponsorable",
        params: [{
          chainId: input.runtime.chainId,
          from: input.from,
          to: input.to,
          data: input.data,
          value: `0x${(input.value ?? 0n).toString(16)}`
        }]
      })
    });
    if (!response.ok) return false;
    const parsed = await response.json() as JsonRpcResponse;
    if (parsed.error) return false;
    if (typeof parsed.result === "boolean") return parsed.result;
    if (parsed.result && typeof parsed.result === "object" && "sponsorable" in parsed.result) {
      return Boolean((parsed.result as {sponsorable?: unknown}).sponsorable);
    }
    return false;
  } catch {
    return false;
  }
}

export async function encodeBotContractCall(input: {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}) {
  return encodeFunctionData({
    abi: input.abi,
    functionName: input.functionName,
    args: input.args
  }) as Hex;
}
