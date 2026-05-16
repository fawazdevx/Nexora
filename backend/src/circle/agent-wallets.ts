import {config} from "../config.js";
import {updateStore} from "../store.js";

type CreateAgentWalletInput = {
  operatorAddress: string;
  arcName?: string;
  dailyLimitUsdc: number;
  transactionCapUsdc: number;
};

type AgentPolicyInput = {
  dailyLimitUsdc: number;
  transactionCapUsdc: number;
  contractAllowlist: string[];
  recipientAllowlist: string[];
};

export async function createAgentWallet(input: CreateAgentWalletInput) {
  if (config.circle.apiKey) {
    const walletSet = await circlePost("/v1/w3s/developer/walletSets", {
      name: `nexora-${input.operatorAddress.slice(2, 10)}`
    });

    const walletSetId = pickNestedString(walletSet, ["data.walletSet.id", "data.walletSetId", "walletSet.id"]);
    const wallet = walletSetId
      ? await circlePost("/v1/w3s/developer/wallets", {
          walletSetId,
          blockchains: ["ARC-TESTNET"],
          count: 1
        })
      : null;

    return updateStore((store) => {
      const record = {
      id: crypto.randomUUID(),
      operatorAddress: input.operatorAddress,
      arcName: input.arcName ?? null,
      address: pickNestedString(wallet, ["data.wallets.0.address", "data.wallet.address", "wallet.address"]) || null,
      circleWalletStatus: "circle_request_submitted",
      circleWalletId: pickNestedString(wallet, ["data.wallets.0.id", "data.wallet.id", "wallet.id"]) || null,
      createdAt: new Date().toISOString(),
      circle: {
        walletSet,
        wallet
      },
      policy: {
        dailyLimitUsdc: input.dailyLimitUsdc,
        transactionCapUsdc: input.transactionCapUsdc,
        contractAllowlist: [],
        recipientAllowlist: [],
        active: true
      }
      };
      store.agents.push(record);
      return record;
    });
  }

  return updateStore((store) => {
    const record = {
    id: crypto.randomUUID(),
    operatorAddress: input.operatorAddress,
    arcName: input.arcName ?? null,
    address: null,
    circleWalletStatus: "requires_circle_api_key",
    createdAt: new Date().toISOString(),
    policy: {
      dailyLimitUsdc: input.dailyLimitUsdc,
      transactionCapUsdc: input.transactionCapUsdc,
      contractAllowlist: [],
      recipientAllowlist: [],
      active: true
    }
  };
    store.agents.push(record);
    return record;
  });
}

export async function updateAgentPolicy(agentId: string, input: AgentPolicyInput & {txHash?: string | null}) {
  return updateStore((store) => {
    const agent = store.agents.find((item) => item.id === agentId || item.address?.toLowerCase() === agentId.toLowerCase());
    if (!agent && agentId !== "local") throw new Error("agent wallet not found");
    if (agent) {
      agent.policy = {
        dailyLimitUsdc: input.dailyLimitUsdc,
        transactionCapUsdc: input.transactionCapUsdc,
        contractAllowlist: input.contractAllowlist,
        recipientAllowlist: input.recipientAllowlist,
        active: true,
        txHash: input.txHash ?? null
      };
    }
    return {
      agentId,
      onchainStatus: input.txHash ? "submitted" : "ready_to_submit",
      policy: input
    };
  });
}

async function circlePost(path: string, body: unknown) {
  const response = await fetch(`https://api.circle.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.circle.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data
    };
  }

  return {
    ok: true,
    status: response.status,
    data
  };
}

function pickNestedString(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, input);
    if (typeof value === "string") return value;
  }

  return "";
}
