import {AccountType, Blockchain, initiateDeveloperControlledWalletsClient} from "@circle-fin/developer-controlled-wallets";
import {config} from "../config.js";
import {readStore, updateStore} from "../store.js";

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
    const client = circleClient();
    const walletSet = await client.createWalletSet({
      idempotencyKey: crypto.randomUUID(),
      name: `nexora-${input.operatorAddress.slice(2, 10)}`
    });
    const walletSetId = walletSet.data?.walletSet?.id;
    if (!walletSetId) {
      throw new Error(circleErrorMessage("Circle wallet set creation failed", walletSet));
    }
    const wallets = await client.createWallets({
      walletSetId,
      idempotencyKey: crypto.randomUUID(),
      blockchains: [Blockchain.ArcTestnet],
      count: 1,
      accountType: AccountType.Sca,
      metadata: [
        {
          name: `nexora-agent-${input.operatorAddress.slice(2, 10)}`,
          refId: input.operatorAddress
        }
      ]
    });
    const wallet = wallets.data?.wallets?.[0] ?? null;
    const address = wallet?.address ?? null;
    const walletId = wallet?.id ?? null;
    const status = address ? "ready" : walletId ? "circle_wallet_pending_address" : "circle_request_submitted";

    return updateStore((store) => {
      const record = {
        id: crypto.randomUUID(),
        operatorAddress: input.operatorAddress,
        arcName: input.arcName ?? null,
        address,
        circleWalletStatus: status,
        circleWalletId: walletId,
        createdAt: new Date().toISOString(),
        circle: {
          walletSet,
          wallet: wallets
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

export async function refreshPendingCircleWallets(operatorAddress?: string) {
  if (!config.circle.apiKey) return;

  const store = await readStore();
  const operator = operatorAddress?.toLowerCase();
  const pendingAgents = store.agents.filter((agent) => {
    if (operator && agent.operatorAddress.toLowerCase() !== operator) return false;
    return !agent.address && Boolean(agent.circleWalletId);
  });
  if (pendingAgents.length === 0) return;

  const updates = await Promise.all(pendingAgents.map(async (agent) => {
    try {
      const wallet = await circleClient().getWallet({id: agent.circleWalletId ?? ""});
      const address = wallet.data?.wallet?.address ?? "";
      const state = wallet.data?.wallet?.state ?? "";
      return {id: agent.id, wallet, address, state};
    } catch (error) {
      return {
        id: agent.id,
        wallet: null,
        address: "",
        state: "",
        error: error instanceof Error ? error.message : "Circle wallet refresh failed"
      };
    }
  }));

  await updateStore((currentStore) => {
    for (const update of updates) {
      const agent = currentStore.agents.find((item) => item.id === update.id);
      if (!agent) continue;
      if (update.address) {
        agent.address = update.address;
        agent.circleWalletStatus = "ready";
      } else if (update.error) {
        agent.circleWalletStatus = "circle_wallet_refresh_failed";
      } else if (update.state) {
        agent.circleWalletStatus = `circle_wallet_${update.state.toLowerCase()}`;
      } else {
        agent.circleWalletStatus = "circle_wallet_pending_address";
      }
    }
  });
}

function circleErrorMessage(prefix: string, input: unknown) {
  if (!input || typeof input !== "object") return prefix;
  const record = input as {status?: number; data?: unknown};
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const message = typeof data.message === "string"
    ? data.message
    : typeof data.error === "string"
      ? data.error
      : typeof data.code === "string"
        ? data.code
        : "unknown Circle error";
  return `${prefix}: ${record.status ?? "unknown_status"} ${message}`;
}

function circleClient() {
  if (!config.circle.entitySecret) throw new Error("CIRCLE_ENTITY_SECRET is required for Circle developer-controlled wallets");
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret
  });
}
