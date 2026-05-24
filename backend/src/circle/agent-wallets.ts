import {Blockchain, initiateDeveloperControlledWalletsClient} from "@circle-fin/developer-controlled-wallets";
import {config} from "../config.js";
import {assertStoreReady, pushNotification, readStore, updateStore} from "../store.js";

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
    await assertStoreReady();

    let walletSet;
    let wallets;
    let walletSetId: string | null = null;
    let address: string | null;
    let walletId: string | null;
    let status: string;

    try {
      const client = circleClient();
      walletSet = await client.createWalletSet({
        idempotencyKey: crypto.randomUUID(),
        name: `nexora-${input.operatorAddress.slice(2, 10)}`
      });
      walletSetId = walletSet.data?.walletSet?.id ?? null;
      if (!walletSetId) {
        throw new Error(circleErrorMessage("Circle wallet set creation failed", walletSet));
      }
      wallets = await client.createWallets({
        walletSetId,
        idempotencyKey: crypto.randomUUID(),
        blockchains: [circleBlockchain()],
        count: 1,
        accountType: "SCA",
        metadata: [
          {
            name: `nexora-agent-${input.operatorAddress.slice(2, 10)}`,
            refId: input.operatorAddress
          }
        ]
      });
      const wallet = wallets.data?.wallets?.[0] ?? null;
      address = wallet?.address ?? null;
      walletId = wallet?.id ?? null;
      status = address ? "ready" : walletId ? "circle_wallet_pending_address" : "circle_request_submitted";
    } catch (error) {
      throw new Error(circleFriendlyError(error));
    }

    return updateStore((store) => {
      const record = {
        id: crypto.randomUUID(),
        operatorAddress: input.operatorAddress,
        arcName: input.arcName ?? null,
        address,
        circleWalletStatus: status,
        circleWalletSetId: walletSetId,
        circleWalletId: walletId,
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
      pushNotification(store, {
        operatorAddress: record.operatorAddress,
        title: "Agent wallet created",
        detail: record.address ? `Wallet ready at ${record.address}` : "Wallet pending Circle confirmation",
        kind: "agent"
      });
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
      pushNotification(store, {
        operatorAddress: record.operatorAddress,
        title: "Agent wallet saved locally",
        detail: "Circle API key is required to complete wallet creation",
        kind: "agent"
      });
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
      pushNotification(store, {
        operatorAddress: agent.operatorAddress,
        title: "Policy updated",
        detail: `${input.dailyLimitUsdc} daily / ${input.transactionCapUsdc} per transaction`,
        kind: "policy",
        txHash: input.txHash ?? null
      });
    }
    return {
      agentId,
      onchainStatus: input.txHash ? "submitted" : "ready_to_submit",
      policy: input
    };
  });
}

export async function submitAgentX402Settlement(input: {
  agentId: string;
  serviceId: number;
  requestHash: string;
  amountUsdc: number;
  units: number;
}) {
  if (!config.circle.apiKey) throw new Error("Circle API key is required for agent-wallet settlement");
  if (!config.contracts.usdc || !config.contracts.x402Ledger) throw new Error("USDC and x402 ledger addresses are required for agent-wallet settlement");

  const store = await readStore();
  const agent = store.agents.find((item) => item.id === input.agentId);
  if (!agent) throw new Error("agent wallet not found");
  if (!agent.circleWalletId) throw new Error("agent Circle wallet id is missing");
  if (!agent.address) throw new Error("agent wallet address is not ready");

  const client = circleClient();
  const amountBaseUnits = String(Math.round(input.amountUsdc * 1_000_000));
  const approve = await client.createContractExecutionTransaction({
    walletId: agent.circleWalletId,
    contractAddress: config.contracts.usdc,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [config.contracts.x402Ledger, amountBaseUnits],
    idempotencyKey: crypto.randomUUID(),
    refId: `nexora-x402-approve-${input.serviceId}`,
    fee: {type: "level", config: {feeLevel: "MEDIUM"}}
  });
  const approveTransactionId = approve.data?.id;
  if (!approveTransactionId) throw new Error(circleErrorMessage("Circle approval transaction failed", approve));
  await pollCircleTransaction(approveTransactionId);

  const settle = await client.createContractExecutionTransaction({
    walletId: agent.circleWalletId,
    contractAddress: config.contracts.x402Ledger,
    abiFunctionSignature: "settleAgentRequest(uint256,bytes32,uint256)",
    abiParameters: [String(input.serviceId), input.requestHash, String(input.units)],
    idempotencyKey: crypto.randomUUID(),
    refId: `nexora-x402-settle-${input.serviceId}`,
    fee: {type: "level", config: {feeLevel: "MEDIUM"}}
  });
  const settlementTransactionId = settle.data?.id;
  if (!settlementTransactionId) throw new Error(circleErrorMessage("Circle settlement transaction failed", settle));

  const settlement = await pollCircleTransaction(settlementTransactionId);
  return {
    agentWallet: agent.address,
    approveTransactionId,
    settlementTransactionId,
    state: settlement.state,
    txHash: settlement.txHash ?? null
  };
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

function circleFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/entity secret is invalid/i.test(message)) {
    return "Circle entity secret is invalid. Use the exact 32-byte entity secret that was registered for this Circle API key, then redeploy the backend.";
  }
  if (/already been set/i.test(message)) {
    return "Circle entity secret is already registered for this Circle project. Update the backend env to use the raw secret that matches the registered Circle API key.";
  }
  return message;
}

function circleClient() {
  if (!config.circle.entitySecret) throw new Error("CIRCLE_ENTITY_SECRET is required for Circle developer-controlled wallets");
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret
  });
}

function circleBlockchain() {
  if (config.arc.chainId === 5042002) return Blockchain.ArcTestnet;
  if (config.arc.chainId === 421614) return Blockchain.ArbSepolia;
  if (config.arc.chainId === 42161) return Blockchain.Arb;
  throw new Error(`Circle agent wallets are not configured for chain ${config.arc.chainId}. Add a Circle blockchain mapping before creating agent wallets on this network.`);
}

async function pollCircleTransaction(transactionId: string) {
  const client = circleClient();
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await client.getTransaction({id: transactionId});
    const transaction = response.data?.transaction;
    const state = transaction?.state ?? "UNKNOWN";
    if (["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(state)) {
      if (state !== "COMPLETE") throw new Error(`Circle transaction ${transactionId} ended with ${state}`);
      return {state, txHash: transaction?.txHash ?? null};
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return {state: "PENDING", txHash: null};
}
