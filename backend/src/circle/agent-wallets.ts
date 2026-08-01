import {Blockchain, initiateDeveloperControlledWalletsClient, type AccountType, type EvmBlockchain} from "@circle-fin/developer-controlled-wallets";
import {createHash} from "node:crypto";
import {createPublicClient, encodeFunctionData, formatUnits, http, isAddress, keccak256, parseAbi, parseEventLogs, parseUnits, stringToHex} from "viem";
import {agentChainContexts, chainContext, type NexoraChainContext} from "../chains.js";
import {config} from "../config.js";
import {ARC_MEMO_CONTRACT, arcMemoAbi, normalizeMemo, publicMemoData, type NexoraStructuredMemo} from "../memos.js";
import {dispatchNotification} from "../notifications.js";
import {normalizePolicyV2} from "../policies/engine.js";
import {assertStoreReady, isVisibleAgent, pushNotification, readStore, updateStore} from "../store.js";
import type {AgentChainWalletRecord, AgentPolicy, NotificationRecord} from "../store.js";

type CreateAgentWalletInput = {
  operatorAddress: string;
  arcName?: string;
  dailyLimitUsdc: number;
  transactionCapUsdc: number;
  policyV2?: AgentPolicy["v2"];
};

const x402LedgerAbi = parseAbi([
  "function settleAgentRequest(uint256 serviceId,bytes32 requestHash,uint256 units) returns (uint256 grossAmount)"
]);

const erc20BalanceAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)"
]);

const policyRegistryReadAbi = parseAbi([
  "function agentProfiles(address agentWallet) view returns (address operator,bytes32 arcNameHash,bool active)"
]);

type AgentPolicyInput = {
  operatorAddress: string;
  chainId?: number | null;
  policyRegistry?: string | null;
  dailyLimitUsdc: number;
  transactionCapUsdc: number;
  contractAllowlist: string[];
  recipientAllowlist: string[];
  policyV2?: AgentPolicy["v2"];
};

type CircleSettlementClient = Pick<
  ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  "createContractExecutionTransaction" | "estimateContractExecutionFee" | "getTransaction"
>;

type CircleContractExecution = {
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
};

type CircleTransactionResult = {
  state: string;
  txHash: string | null;
};

export type AgentX402SettlementDependencies = {
  circleClient?: () => CircleSettlementClient;
  publicClient?: (context: NexoraChainContext) => ReturnType<typeof chainPublicClient>;
  pollTransaction?: (transactionId: string) => Promise<CircleTransactionResult>;
  idempotencyKey?: (stage?: "approval" | "settlement") => string;
};

export type CirclePolicyRegistrationDependencies = {
  circleClient?: () => CircleSettlementClient;
  publicClient?: (context: NexoraChainContext) => ReturnType<typeof chainPublicClient>;
  pollTransaction?: (transactionId: string) => Promise<CircleTransactionResult>;
  idempotencyKey?: () => string;
};

export async function createAgentWallet(input: CreateAgentWalletInput) {
  await assertPremiumPolicyAccess(input.operatorAddress, input.policyV2);
  if (config.circle.apiKey) {
    await assertStoreReady();

    let walletSet;
    let walletSetId: string | null = null;
    let chainWallets: AgentChainWalletRecord[] = [];
    let address: string | null = null;
    let walletId: string | null = null;
    let status: string;

    try {
      const client = circleClient();
      walletSetId = config.circle.walletSetId || null;
      if (!walletSetId) {
        walletSet = await client.createWalletSet({
          idempotencyKey: crypto.randomUUID(),
          name: `nexora-${input.operatorAddress.slice(2, 10)}`
        });
        walletSetId = walletSet.data?.walletSet?.id ?? null;
        if (!walletSetId) {
          throw new Error(circleErrorMessage("Circle wallet set creation failed", walletSet));
        }
      }
      const accountType = config.circle.agentWalletAccountType;
      const contexts = agentChainContexts();
      const wallets = await client.createWallets({
        walletSetId,
        idempotencyKey: crypto.randomUUID(),
        blockchains: contexts.map((context) => circleBlockchain(context)),
        count: 1,
        accountType: circleAccountTypeForWallet(accountType),
        metadata: [
          {
            name: `nexora-agent-${accountType.toLowerCase()}-${input.operatorAddress.slice(2, 10)}`,
            refId: input.operatorAddress
          }
        ]
      });
      const createdWallets = wallets.data?.wallets ?? [];
      const now = new Date().toISOString();
      chainWallets = contexts.map((context) => {
        const wallet = createdWallets.find((item) => item.blockchain === context.circleBlockchain);
        return {
          chainId: context.chainId,
          chain: context.label,
          circleBlockchain: context.circleBlockchain,
          address: wallet?.address ?? null,
          circleWalletId: wallet?.id ?? null,
          status: wallet?.address ? "ready" : wallet?.id ? "circle_wallet_pending_address" : "circle_request_submitted",
          updatedAt: now
        };
      });
      const primary = chainWallets.find((wallet) => wallet.chainId === config.arc.chainId) ?? chainWallets[0];
      address = primary?.address ?? null;
      walletId = primary?.circleWalletId ?? null;
      status = chainWallets.every((wallet) => wallet.status === "ready")
        ? "ready"
        : chainWallets.some((wallet) => wallet.status === "ready")
          ? "partially_ready"
          : chainWallets.some((wallet) => wallet.circleWalletId)
            ? "circle_wallet_pending_address"
            : "circle_request_submitted";
    } catch (error) {
      throw new Error(circleFriendlyError(error));
    }

    const result = await updateStore((store) => {
      const circleAccountType = config.circle.agentWalletAccountType;
      const settlementMode: "eoa_memo" | "sca_direct" = circleAccountType === "EOA" ? "eoa_memo" : "sca_direct";
      const record = {
        id: crypto.randomUUID(),
        walletKind: "circle_developer" as const,
        operatorAddress: input.operatorAddress,
        arcName: input.arcName ?? null,
        address,
        circleWalletStatus: status,
        circleWalletSetId: walletSetId,
        circleWalletId: walletId,
        circleAccountType,
        settlementMode,
        chainWallets,
        createdAt: new Date().toISOString(),
        policy: {
          dailyLimitUsdc: input.dailyLimitUsdc,
          transactionCapUsdc: input.transactionCapUsdc,
          contractAllowlist: [],
          recipientAllowlist: [],
          active: true,
          v2: normalizePolicyV2(input.policyV2)
        }
      };
      store.agents.push(record);
      const notification = pushNotification(store, {
        operatorAddress: record.operatorAddress,
        title: "Agent wallet created",
        detail: chainWallets.some((wallet) => wallet.address)
          ? `Circle wallets created across ${chainWallets.length} chains`
          : "Wallets pending Circle confirmation",
        kind: "agent"
      });
      return {record, notification};
    });
    await notifyAgentAction(result.notification);
    return result.record;
  }

  const result = await updateStore((store) => {
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      walletKind: "circle_developer" as const,
      operatorAddress: input.operatorAddress,
      arcName: input.arcName ?? null,
      address: null,
      circleWalletStatus: "requires_circle_api_key",
      circleAccountType: null,
      settlementMode: null,
      chainWallets: agentChainContexts().map((context) => ({
        chainId: context.chainId,
        chain: context.label,
        circleBlockchain: context.circleBlockchain,
        address: null,
        circleWalletId: null,
        status: "requires_circle_api_key",
        updatedAt: now
      })),
      createdAt: now,
      policy: {
        dailyLimitUsdc: input.dailyLimitUsdc,
        transactionCapUsdc: input.transactionCapUsdc,
        contractAllowlist: [],
        recipientAllowlist: [],
        active: true,
        v2: normalizePolicyV2(input.policyV2)
      }
    };
      store.agents.push(record);
      const notification = pushNotification(store, {
        operatorAddress: record.operatorAddress,
        title: "Agent wallet saved locally",
        detail: "Circle API key is required to complete wallet creation",
        kind: "agent"
      });
      return {record, notification};
    });
  await notifyAgentAction(result.notification);
  return result.record;
}

/**
 * Registers a connected EOA as a Nexora-controlled policy subject without
 * treating it as a Circle agent wallet. BOT Chain uses this profile because
 * Circle Agent Wallets do not support BOT; payment signing remains in the
 * user's wallet and settlement remains with Meridian.
 */
export async function upsertExternalPolicyWallet(input: {operatorAddress: string; chainId: number}) {
  if (!isAddress(input.operatorAddress)) throw new Error("operatorAddress is invalid");
  const isTestnet = input.chainId === config.botchain.testnetChainId;
  const isEnabledMainnet = input.chainId === config.botchain.mainnetChainId && config.botchain.mainnetEnabled;
  if (!isTestnet && !isEnabledMainnet) {
    const error = new Error("External EOA policy profiles are not enabled for this BOT Chain network.");
    (error as Error & {status?: number}).status = 400;
    throw error;
  }

  const normalizedAddress = input.operatorAddress.toLowerCase();
  const id = `external-eoa-${input.chainId}-${normalizedAddress}`;
  const result = await updateStore((store) => {
    const existing = store.agents.find((agent) => (
      isVisibleAgent(agent)
      && agent.walletKind === "external_eoa"
      && agent.operatorAddress.toLowerCase() === normalizedAddress
      && (agent.chainWallets ?? []).some((wallet) => wallet.chainId === input.chainId)
    ));
    if (existing) return {record: existing, notification: null as NotificationRecord | null};

    const now = new Date().toISOString();
    const record = {
      id,
      walletKind: "external_eoa" as const,
      operatorAddress: input.operatorAddress,
      arcName: null,
      address: input.operatorAddress,
      circleWalletStatus: "external_eoa_ready",
      circleWalletSetId: null,
      circleWalletId: null,
      circleAccountType: null,
      settlementMode: null,
      chainWallets: [{
        chainId: input.chainId,
        chain: isTestnet ? "BOT Chain Testnet" : "BOT Chain",
        circleBlockchain: "EXTERNAL-EVM",
        address: input.operatorAddress,
        circleWalletId: null,
        status: "ready",
        updatedAt: now
      }],
      createdAt: now,
      policy: {
        dailyLimitUsdc: 400,
        transactionCapUsdc: 45,
        contractAllowlist: [],
        recipientAllowlist: [],
        active: true,
        v2: normalizePolicyV2(undefined)
      }
    };
    store.agents.push(record);
    const notification = pushNotification(store, {
      operatorAddress: input.operatorAddress,
      title: "BOT policy wallet connected",
      detail: "This EOA can now use Nexora policy checks before Meridian x402 settlement.",
      kind: "agent"
    });
    return {record, notification};
  });
  await notifyAgentAction(result.notification);
  return result.record;
}

/**
 * Adds chain wallets to an agent created before Nexora supported multichain
 * provisioning. Circle derives EVM wallets from the existing Arc wallet, so
 * the existing wallet and any funds on it are never replaced.
 */
export async function addMissingAgentChainWallets(input: {agentId: string; operatorAddress: string}) {
  if (!config.circle.apiKey) throw new Error("Circle API key is required to add agent chain wallets");
  await assertStoreReady();

  const store = await readStore();
  const agent = store.agents.find((item) => isVisibleAgent(item) && item.id === input.agentId);
  if (!agent) throw new Error("agent wallet not found");
  if (agent.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) {
    const error = new Error("agent operator wallet required");
    (error as Error & {status?: number}).status = 403;
    throw error;
  }

  const existing = new Map((agent.chainWallets ?? []).map((wallet) => [wallet.chainId, wallet]));
  const source = walletForChain(agent, config.arc.chainId);
  if (!source?.circleWalletId) {
    throw new Error("This legacy agent does not have a Circle wallet id to derive from. Create a new agent wallet instead.");
  }

  const missing = agentChainContexts().filter((context) => context.chainId !== config.arc.chainId && !existing.has(context.chainId));
  if (missing.length === 0) return {agentId: agent.id, added: [], failed: [], chainWallets: agent.chainWallets ?? []};

  const client = circleClient();
  const now = new Date().toISOString();
  const results = await Promise.all(missing.map(async (context) => {
    try {
      const response = await client.deriveWallet({id: source.circleWalletId!, blockchain: circleBlockchain(context)});
      const wallet = response.data?.wallet;
      if (!wallet?.id) throw new Error("Circle did not return a derived wallet");
      return {
        context,
        wallet: {
          chainId: context.chainId,
          chain: context.label,
          circleBlockchain: context.circleBlockchain,
          address: wallet.address ?? null,
          circleWalletId: wallet.id,
          status: wallet.address ? "ready" : "circle_wallet_pending_address",
          updatedAt: now
        } satisfies AgentChainWalletRecord
      };
    } catch (error) {
      return {context, error: circleFriendlyError(error)};
    }
  }));

  const added = results.filter((result): result is Extract<typeof result, {wallet: AgentChainWalletRecord}> => "wallet" in result).map((result) => result.wallet);
  const failed = results.filter((result): result is Extract<typeof result, {error: string}> => "error" in result).map((result) => ({chainId: result.context.chainId, chain: result.context.label, error: result.error}));

  const result = await updateStore((currentStore) => {
    const current = currentStore.agents.find((item) => item.id === input.agentId);
    if (!current) throw new Error("agent wallet not found");
    const currentChainWallets = current.chainWallets?.length ? [...current.chainWallets] : [walletForChain(current, config.arc.chainId)!];
    for (const wallet of added) {
      if (!currentChainWallets.some((item) => item.chainId === wallet.chainId)) currentChainWallets.push(wallet);
    }
    current.chainWallets = currentChainWallets;
    const notification = added.length > 0 ? pushNotification(currentStore, {
      operatorAddress: current.operatorAddress,
      title: "Agent chain wallets added",
      detail: `Added ${added.map((wallet) => wallet.chain).join(", ")}`,
      kind: "agent"
    }) : null;
    return {chainWallets: current.chainWallets, notification};
  });
  await notifyAgentAction(result.notification);
  return {agentId: agent.id, added, failed, chainWallets: result.chainWallets};
}

export async function updateAgentPolicy(agentId: string, input: AgentPolicyInput & {txHash?: string | null}) {
  await assertPremiumPolicyAccess(input.operatorAddress, input.policyV2);
  const result = await updateStore((store) => {
    const agent = store.agents.find((item) => isVisibleAgent(item) && (item.id === agentId || item.address?.toLowerCase() === agentId.toLowerCase()));
    if (!agent && agentId !== "local") throw new Error("agent wallet not found");
    let notification: NotificationRecord | null = null;
    if (agent) {
      if (agent.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) {
        throw new Error("agent operator wallet required");
      }
      agent.policy = {
        dailyLimitUsdc: input.dailyLimitUsdc,
        transactionCapUsdc: input.transactionCapUsdc,
        contractAllowlist: input.contractAllowlist,
        recipientAllowlist: input.recipientAllowlist,
        active: true,
        txHash: legacyPolicyTxHash(agent.policy, input),
        deployments: updatedPolicyDeployments(agent.policy, input),
        v2: normalizePolicyV2(input.policyV2)
      };
      notification = pushNotification(store, {
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
      policy: input,
      notification
    };
  });
  await notifyAgentAction(result.notification);
  return {
    agentId: result.agentId,
    onchainStatus: result.onchainStatus,
    policy: result.policy
  };
}

/**
 * Securely performs the first on-chain registration for a Circle-controlled
 * agent wallet. The policy registry requires the initial call to come from the
 * agent wallet (or the registry owner), so the connected operator must not send
 * this first transaction from their browser wallet.
 *
 * Once registered, the operator recorded by this transaction can manage later
 * policy updates directly through the normal frontend contract flow.
 */
export async function ensureCircleAgentPolicyRegistration(
  agentId: string,
  input: AgentPolicyInput,
  dependencies: CirclePolicyRegistrationDependencies = {}
) {
  await assertPremiumPolicyAccess(input.operatorAddress, input.policyV2);
  if (!config.circle.apiKey) throw new Error("Circle API key is required for agent policy registration");

  const context = chainContext(input.chainId);
  if (!context.policyRegistry) {
    throw new Error(`Nexora policy registry is not configured on ${context.label}`);
  }
  if (
    input.policyRegistry
    && input.policyRegistry.toLowerCase() !== context.policyRegistry.toLowerCase()
  ) {
    throw new Error(`The requested policy registry does not match Nexora's configured proxy on ${context.label}`);
  }

  const store = await readStore();
  const agent = store.agents.find((item) => isVisibleAgent(item) && item.id === agentId);
  if (!agent) throw new Error("agent wallet not found");
  if (agent.walletKind === "external_eoa") {
    throw new Error("External EOA policies must be registered by the connected wallet");
  }
  if (agent.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) {
    const error = new Error("agent operator wallet required");
    (error as Error & {status?: number}).status = 403;
    throw error;
  }

  const chainWallet = walletForChain(agent, context.chainId);
  if (!chainWallet?.circleWalletId) throw new Error(`Agent Circle wallet id is missing on ${context.label}`);
  if (!chainWallet.address) throw new Error(`Agent wallet address is not ready on ${context.label}`);

  const deployment = agent.policy.deployments?.find((item) => item.chainId === context.chainId);
  if (
    deployment?.policyRegistry
    && deployment.policyRegistry.toLowerCase() !== context.policyRegistry.toLowerCase()
  ) {
    throw new Error(
      `The recorded agent policy on ${context.label} targets a different policy registry. Review the configured proxy before registering this wallet.`
    );
  }

  const publicClient = dependencies.publicClient?.(context) ?? chainPublicClient(context);
  const profile = await readAgentPolicyProfile({
    client: publicClient,
    policyRegistry: context.policyRegistry,
    agentAddress: chainWallet.address,
    context
  });
  const [registeredOperator, , active] = profile;
  if (active) {
    if (registeredOperator.toLowerCase() !== input.operatorAddress.toLowerCase()) {
      throw new Error(`This agent wallet is registered to a different operator on ${context.label}.`);
    }
    return {
      status: "already_registered" as const,
      registered: false,
      chainId: context.chainId,
      chain: context.label,
      agentWallet: chainWallet.address,
      transactionId: null,
      txHash: deployment?.txHash ?? null
    };
  }

  const client = dependencies.circleClient?.() ?? circleClient();
  const pollTransaction = dependencies.pollTransaction ?? ((transactionId: string) => pollCircleTransaction(transactionId, client));
  const idempotencyKey = dependencies.idempotencyKey ?? (() => stableIdempotencyKey(
    `nexora:policy-registration:${agent.id}:${context.chainId}:${policyRegistrationFingerprint(input)}`
  ));
  const contractAllowlist = [...new Set(input.contractAllowlist.map((address) => address.toLowerCase()))];
  const recipientAllowlist = [...new Set(input.recipientAllowlist.map((address) => address.toLowerCase()))];
  const execution: CircleContractExecution = {
    contractAddress: context.policyRegistry,
    abiFunctionSignature: "configureAgentPolicy(address,address,bytes32,uint256,uint256,bool,bool,bool,address[],address[])",
    abiParameters: [
      chainWallet.address,
      input.operatorAddress,
      keccak256(stringToHex(agent.arcName?.trim() || input.operatorAddress)),
      parseUnits(String(input.dailyLimitUsdc), 6).toString(),
      parseUnits(String(input.transactionCapUsdc), 6).toString(),
      contractAllowlist.length > 0,
      recipientAllowlist.length > 0,
      true,
      contractAllowlist,
      recipientAllowlist
    ]
  };
  const registrationNetworkFee = await estimateCircleContractExecutionFee({
    client,
    walletId: chainWallet.circleWalletId,
    execution,
    context,
    action: "Agent policy registration"
  });
  const accountType = agent.circleAccountType ?? "EOA";
  await assertAgentNativeGasBalance({
    agentAddress: chainWallet.address,
    accountType,
    requiredBaseUnits: registrationNetworkFee.baseUnits,
    context,
    client: publicClient,
    action: "Agent policy registration"
  });

  const submitted = await client.createContractExecutionTransaction({
    walletId: chainWallet.circleWalletId,
    ...execution,
    idempotencyKey: idempotencyKey(),
    refId: `nexora-policy-register-${context.chainId}`,
    fee: {type: "level", config: {feeLevel: "MEDIUM"}}
  });
  const transactionId = submitted.data?.id;
  if (!transactionId) throw new Error(circleErrorMessage("Circle policy registration failed", submitted));

  const transaction = await pollTransaction(transactionId);
  if (transaction.state !== "COMPLETE") {
    return {
      status: "pending" as const,
      registered: false,
      chainId: context.chainId,
      chain: context.label,
      agentWallet: chainWallet.address,
      transactionId,
      txHash: transaction.txHash
    };
  }
  if (!transaction.txHash) {
    throw new Error(`Circle policy registration completed without a transaction hash on ${context.label}`);
  }

  return {
    status: "registered" as const,
    registered: true,
    chainId: context.chainId,
    chain: context.label,
    agentWallet: chainWallet.address,
    transactionId,
    txHash: transaction.txHash,
    networkFee: registrationNetworkFee.display,
    networkFeeCurrency: context.nativeCurrency.symbol
  };
}

async function assertPremiumPolicyAccess(operatorAddress: string, policyV2?: AgentPolicy["v2"]) {
  if (!hasPremiumPolicySettings(policyV2)) return;
  const store = await readStore();
  const now = Date.now();
  const hasPlan = store.subscriptions.some((subscription) => (
    subscription.operatorAddress.toLowerCase() === operatorAddress.toLowerCase()
    && subscription.plan === "premium_agent_automation"
    && subscription.status === "active"
    && (!subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > now)
  ));
  if (!hasPlan) {
    const error = new Error("Premium Agent Automation is required for advanced policy controls.");
    (error as Error & {status?: number}).status = 402;
    throw error;
  }
}

function hasPremiumPolicySettings(policyV2?: AgentPolicy["v2"]) {
  if (!policyV2) return false;
  return Number(policyV2.weeklyLimitUsdc || 0) > 0
    || Number(policyV2.monthlyLimitUsdc || 0) > 0
    || Number(policyV2.maxUnitsPerRequest || 0) > 0
    || Number(policyV2.cooldownSeconds || 0) > 0
    || Boolean(policyV2.expiresAt)
    || Boolean(policyV2.requireOnchainPolicy)
    || (policyV2.serviceAllowlist?.length ?? 0) > 0;
}

async function notifyAgentAction(notification?: NotificationRecord | null) {
  if (!notification) return;
  await dispatchNotification({notification, event: "agentActions"}).catch(() => undefined);
}

export async function submitAgentX402Settlement(input: {
  agentId: string;
  operatorAddress: string;
  authorizationId?: string;
  serviceId: number;
  requestHash: string;
  amountUsdc: number;
  units: number;
  settlementChainId?: number | null;
  memo?: NexoraStructuredMemo | null;
}, dependencies: AgentX402SettlementDependencies = {}) {
  if (!config.circle.apiKey) throw new Error("Circle API key is required for agent-wallet settlement");
  assertBytes32(input.requestHash, "requestHash");
  const memo = normalizeMemo(input.memo);
  if (memo) assertBytes32(memo.memoId, "memoId");
  const context = chainContext(input.settlementChainId);
  if (!context.usdc || !context.x402Ledger || !context.policyRegistry) {
    throw new Error(`USDC, x402 ledger, and policy registry addresses are required for agent-wallet settlement on ${context.label}`);
  }

  const store = await readStore();
  const agent = store.agents.find((item) => isVisibleAgent(item) && item.id === input.agentId);
  if (!agent) throw new Error("agent wallet not found");
  if (agent.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) {
    throw new Error("agent operator wallet required for settlement");
  }
  const chainWallet = walletForChain(agent, context.chainId);
  if (!chainWallet?.circleWalletId) throw new Error(`Agent Circle wallet id is missing on ${context.label}`);
  if (!chainWallet.address) throw new Error(`Agent wallet address is not ready on ${context.label}`);

  const client = dependencies.circleClient?.() ?? circleClient();
  const publicClient = dependencies.publicClient?.(context) ?? chainPublicClient(context);
  const pollTransaction = dependencies.pollTransaction ?? ((transactionId: string) => pollCircleTransaction(transactionId, client));
  const idempotencyKey = dependencies.idempotencyKey ?? ((stage: "approval" | "settlement" = "approval") => (
    stableIdempotencyKey(`nexora:x402:${input.authorizationId ?? input.requestHash}:${stage}`)
  ));
  const amountBaseUnits = BigInt(Math.round(input.amountUsdc * 1_000_000));
  await assertAgentPolicyRegistration({
    agentAddress: chainWallet.address,
    operatorAddress: input.operatorAddress,
    policy: agent.policy,
    context,
    client: publicClient
  });
  await assertAgentSettlementBalance(chainWallet.address, amountBaseUnits, context, publicClient);
  const amountBaseUnitsString = amountBaseUnits.toString();
  const settlementMode = agent.settlementMode ?? (agent.circleAccountType === "EOA" ? "eoa_memo" : "sca_direct");
  const accountType = agent.circleAccountType ?? (settlementMode === "eoa_memo" ? "EOA" : "SCA");
  const approvalExecution: CircleContractExecution = {
    contractAddress: context.usdc,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [context.x402Ledger, amountBaseUnitsString]
  };
  const approvalNetworkFee = await estimateCircleContractExecutionFee({
    client,
    walletId: chainWallet.circleWalletId,
    execution: approvalExecution,
    context,
    action: "USDC approval"
  });
  await assertAgentNativeGasBalance({
    agentAddress: chainWallet.address,
    accountType,
    requiredBaseUnits: approvalNetworkFee.baseUnits,
    context,
    client: publicClient,
    action: "USDC approval"
  });

  const approve = await client.createContractExecutionTransaction({
    walletId: chainWallet.circleWalletId,
    ...approvalExecution,
    idempotencyKey: idempotencyKey("approval"),
    refId: `nexora-x402-approve-${input.serviceId}`,
    fee: {type: "level", config: {feeLevel: "MEDIUM"}}
  });
  const approveTransactionId = approve.data?.id;
  if (!approveTransactionId) throw new Error(circleErrorMessage("Circle approval transaction failed", approve));
  const approval = await pollTransaction(approveTransactionId);
  if (approval.state !== "COMPLETE") {
    throw new Error(`Circle USDC approval is still pending on ${context.label}. Wait for transaction ${approveTransactionId} to confirm, then retry settlement.`);
  }

  const settleData = encodeFunctionData({
    abi: x402LedgerAbi,
    functionName: "settleAgentRequest",
    args: [BigInt(input.serviceId), input.requestHash as `0x${string}`, BigInt(input.units)]
  });
  const callDataHash = keccak256(settleData);
  const useMemoSettlement = settlementMode === "eoa_memo" && Boolean(memo?.memoId) && context.chainId === config.arc.chainId;
  const settlementExecution: CircleContractExecution = useMemoSettlement
    ? {
      contractAddress: ARC_MEMO_CONTRACT,
      abiFunctionSignature: "memo(address,bytes,bytes32,bytes)",
      abiParameters: [
        context.x402Ledger,
        settleData,
        memo?.memoId,
        stringToHex(JSON.stringify(publicMemoData(memo)))
      ] as string[]
    }
    : {
      contractAddress: context.x402Ledger,
      abiFunctionSignature: "settleAgentRequest(uint256,bytes32,uint256)",
      abiParameters: [String(input.serviceId), input.requestHash, String(input.units)]
    };
  const settlementNetworkFee = await estimateCircleContractExecutionFee({
    client,
    walletId: chainWallet.circleWalletId,
    execution: settlementExecution,
    context,
    action: "Marketplace settlement"
  });
  await assertAgentNativeGasBalance({
    agentAddress: chainWallet.address,
    accountType,
    requiredBaseUnits: settlementNetworkFee.baseUnits,
    context,
    client: publicClient,
    action: "Marketplace settlement"
  });

  const settle = await client.createContractExecutionTransaction({
    walletId: chainWallet.circleWalletId,
    ...settlementExecution,
    idempotencyKey: idempotencyKey("settlement"),
    refId: useMemoSettlement ? `nexora-x402-memo-settle-${input.serviceId}` : `nexora-x402-settle-${input.serviceId}`,
    fee: {type: "level", config: {feeLevel: "MEDIUM"}}
  });
  const settlementTransactionId = settle.data?.id;
  if (!settlementTransactionId) throw new Error(circleErrorMessage("Circle settlement transaction failed", settle));

  const settlement = await pollTransaction(settlementTransactionId);
  const memoContext = useMemoSettlement && memo && settlement.txHash
    ? await memoContextForSettlement({
      txHash: settlement.txHash,
      memoId: memo.memoId,
      targetContract: context.x402Ledger,
      callDataHash,
      context,
      client: publicClient
    })
    : null;
  return {
    agentWallet: chainWallet.address,
    settlementChainId: context.chainId,
    chain: context.label,
    approveTransactionId,
    settlementTransactionId,
    settlementMode,
    state: settlement.state,
    txHash: settlement.txHash ?? null,
    approvalNetworkFee: approvalNetworkFee.display,
    settlementNetworkFee: settlementNetworkFee.display,
    networkFeeCurrency: context.nativeCurrency.symbol,
    targetContract: memoContext?.targetContract ?? (useMemoSettlement ? context.x402Ledger : null),
    callDataHash: memoContext?.callDataHash ?? (useMemoSettlement ? callDataHash : null),
    memoIndex: memoContext?.memoIndex ?? null
  };
}

function assertBytes32(value: string, label: string): asserts value is `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hexadecimal value`);
  }
}

export async function refreshPendingCircleWallets(operatorAddress?: string) {
  if (!config.circle.apiKey) return;

  const store = await readStore();
  const operator = operatorAddress?.toLowerCase();
  const pendingWallets = store.agents.flatMap((agent) => {
    if (operator && agent.operatorAddress.toLowerCase() !== operator) return [];
    if (!isVisibleAgent(agent)) return [];
    const chainWallets = agent.chainWallets?.length
      ? agent.chainWallets
      : agent.circleWalletId
        ? [{
          chainId: config.arc.chainId,
          chain: "Arc Testnet",
          circleBlockchain: "ARC-TESTNET",
          address: agent.address,
          circleWalletId: agent.circleWalletId,
          status: agent.circleWalletStatus,
          updatedAt: agent.createdAt
        }]
        : [];
    return chainWallets
      .filter((wallet) => !wallet.address && Boolean(wallet.circleWalletId))
      .map((wallet) => ({agentId: agent.id, chainId: wallet.chainId, circleWalletId: wallet.circleWalletId ?? ""}));
  });
  if (pendingWallets.length === 0) return;

  const updates = await Promise.all(pendingWallets.map(async (pending) => {
    try {
      const wallet = await circleClient().getWallet({id: pending.circleWalletId});
      const address = wallet.data?.wallet?.address ?? "";
      const state = wallet.data?.wallet?.state ?? "";
      return {agentId: pending.agentId, chainId: pending.chainId, wallet, address, state};
    } catch (error) {
      return {
        agentId: pending.agentId,
        chainId: pending.chainId,
        wallet: null,
        address: "",
        state: "",
        error: error instanceof Error ? error.message : "Circle wallet refresh failed"
      };
    }
  }));

  await updateStore((currentStore) => {
    for (const update of updates) {
      const agent = currentStore.agents.find((item) => item.id === update.agentId);
      if (!agent) continue;
      const chainWallet = agent.chainWallets?.find((item) => item.chainId === update.chainId);
      const nextStatus = update.address
        ? "ready"
        : update.error
          ? "circle_wallet_refresh_failed"
          : update.state
            ? `circle_wallet_${update.state.toLowerCase()}`
            : "circle_wallet_pending_address";
      if (chainWallet) {
        chainWallet.address = update.address || chainWallet.address;
        chainWallet.status = nextStatus;
        chainWallet.updatedAt = new Date().toISOString();
      }
      if (update.chainId !== config.arc.chainId) continue;
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

// Circle treats an idempotency key as the identity of a transaction request.
// Derive stable UUIDs from the authorization so a client retry after a slow
// response replays the same approval or settlement instead of submitting a
// second transaction.
function stableIdempotencyKey(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function circleFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/entity secret is invalid/i.test(message)) {
    return "Agent wallet service is not ready. Please try again after wallet infrastructure is refreshed.";
  }
  if (/already been set/i.test(message)) {
    return "Agent wallet service is being reconnected. Please try again shortly.";
  }
  return message;
}

function circleClient() {
  if (!config.circle.entitySecret) throw new Error("Agent wallet service is not available right now.");
  return initiateDeveloperControlledWalletsClient({
    apiKey: config.circle.apiKey,
    entitySecret: config.circle.entitySecret
  });
}

function circleBlockchain(context: NexoraChainContext): EvmBlockchain {
  const values: Record<NexoraChainContext["circleBlockchain"], EvmBlockchain> = {
    "ARC-TESTNET": Blockchain.ArcTestnet,
    "BASE-SEPOLIA": Blockchain.BaseSepolia,
    "ARB-SEPOLIA": Blockchain.ArbSepolia,
    BASE: Blockchain.Base,
    ARB: Blockchain.Arb
  };
  return values[context.circleBlockchain];
}

function circleAccountTypeForWallet(accountType: "EOA" | "SCA"): AccountType {
  return accountType;
}

async function assertAgentPolicyRegistration(input: {
  agentAddress: string;
  operatorAddress: string;
  policy: AgentPolicy;
  context: NexoraChainContext;
  client: ReturnType<typeof chainPublicClient>;
}) {
  const deployment = input.policy.deployments?.find((item) => item.chainId === input.context.chainId);
  if (
    deployment?.policyRegistry
    && deployment.policyRegistry.toLowerCase() !== input.context.policyRegistry.toLowerCase()
  ) {
    throw new Error(
      `The recorded agent policy on ${input.context.label} targets a different policy registry. Save the policy again on ${input.context.label} before purchasing a service.`
    );
  }

  const profile = await readAgentPolicyProfile({
    client: input.client,
    policyRegistry: input.context.policyRegistry,
    agentAddress: input.agentAddress,
    context: input.context
  });

  const [registeredOperator, , active] = profile;
  if (!active) {
    throw new Error(
      `This agent wallet is not registered with an active policy on ${input.context.label}. Open Agent Policies, select ${input.context.label}, and save the policy before purchasing a service.`
    );
  }
  if (registeredOperator.toLowerCase() !== input.operatorAddress.toLowerCase()) {
    throw new Error(`This agent wallet is registered to a different operator on ${input.context.label}.`);
  }
}

async function readAgentPolicyProfile(input: {
  client: ReturnType<typeof chainPublicClient>;
  policyRegistry: string;
  agentAddress: string;
  context: NexoraChainContext;
}) {
  try {
    return await input.client.readContract({
      address: input.policyRegistry as `0x${string}`,
      abi: policyRegistryReadAbi,
      functionName: "agentProfiles",
      args: [input.agentAddress as `0x${string}`]
    });
  } catch {
    throw new Error(`Nexora could not verify the agent policy registry on ${input.context.label}. Check the network RPC and try again.`);
  }
}

function policyRegistrationFingerprint(input: AgentPolicyInput) {
  return JSON.stringify({
    operatorAddress: input.operatorAddress.toLowerCase(),
    dailyLimitUsdc: input.dailyLimitUsdc,
    transactionCapUsdc: input.transactionCapUsdc,
    contractAllowlist: [...input.contractAllowlist].map((address) => address.toLowerCase()).sort(),
    recipientAllowlist: [...input.recipientAllowlist].map((address) => address.toLowerCase()).sort()
  });
}

async function assertAgentSettlementBalance(
  agentAddress: string,
  requiredBaseUnits: bigint,
  context: NexoraChainContext,
  client: ReturnType<typeof chainPublicClient>
) {
  const balance = await client.readContract({
    address: context.usdc as `0x${string}`,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: [agentAddress as `0x${string}`]
  });

  if (balance >= requiredBaseUnits) return;

  throw new Error(
    `Agent Circle wallet ${agentAddress} has ${formatUnits(balance, 6)} USDC on ${context.label}, but ${formatUnits(requiredBaseUnits, 6)} USDC is required. Fund this agent wallet with ERC-20 USDC on ${context.label} and try again.`
  );
}

async function estimateCircleContractExecutionFee(input: {
  client: CircleSettlementClient;
  walletId: string;
  execution: CircleContractExecution;
  context: NexoraChainContext;
  action: string;
}) {
  const estimate = await input.client.estimateContractExecutionFee({
    source: {walletId: input.walletId},
    ...input.execution
  });
  const fee = estimate.data?.medium ?? estimate.data?.high ?? estimate.data?.low;
  const display = fee?.networkFee ?? fee?.networkFeeRaw;
  if (!display) {
    throw new Error(`Circle did not return a network fee estimate for ${input.action} on ${input.context.label}. No transaction was submitted.`);
  }

  try {
    return {
      display,
      baseUnits: parseUnits(display, input.context.nativeCurrency.decimals)
    };
  } catch {
    throw new Error(`Circle returned an invalid network fee estimate for ${input.action} on ${input.context.label}. No transaction was submitted.`);
  }
}

async function assertAgentNativeGasBalance(input: {
  agentAddress: string;
  accountType: "EOA" | "SCA";
  requiredBaseUnits: bigint;
  context: NexoraChainContext;
  client: ReturnType<typeof chainPublicClient>;
  action: string;
}) {
  // Circle SCA transactions may use paymaster sponsorship. Arc's native gas
  // currency is USDC and is intentionally not treated as a separate ETH-like
  // balance from the USDC check above.
  if (input.accountType !== "EOA" || input.context.chainId === config.arc.chainId) return;

  const balance = await input.client.getBalance({address: input.agentAddress as `0x${string}`});
  if (balance >= input.requiredBaseUnits) return;

  throw new Error(
    `Agent Circle wallet ${input.agentAddress} has ${formatUnits(balance, input.context.nativeCurrency.decimals)} ${input.context.nativeCurrency.symbol} on ${input.context.label}, but the estimated ${input.action} fee is ${formatUnits(input.requiredBaseUnits, input.context.nativeCurrency.decimals)} ${input.context.nativeCurrency.symbol}. Fund this agent wallet with native ${input.context.nativeCurrency.symbol} on ${input.context.label} and try again.`
  );
}

function chainPublicClient(context: NexoraChainContext) {
  return createPublicClient({
    transport: http(context.rpcUrl),
    chain: {
      id: context.chainId,
      name: context.label,
      nativeCurrency: context.nativeCurrency,
      rpcUrls: {default: {http: [context.rpcUrl]}}
    }
  });
}

async function memoContextForSettlement(input: {
  txHash: string;
  memoId: string;
  targetContract: string;
  callDataHash: string;
  context: NexoraChainContext;
  client?: ReturnType<typeof chainPublicClient>;
}) {
  const client = input.client ?? chainPublicClient(input.context);
  const receipt = await client.getTransactionReceipt({hash: input.txHash as `0x${string}`});
  if (receipt.status !== "success") throw new Error("memo-backed Circle settlement transaction reverted");
  const logs = parseEventLogs({
    abi: arcMemoAbi,
    eventName: "Memo",
    logs: receipt.logs
  }).filter((log) => (
    log.address.toLowerCase() === ARC_MEMO_CONTRACT.toLowerCase()
    && log.args.memoId?.toLowerCase() === input.memoId.toLowerCase()
  ));
  const match = logs[logs.length - 1];
  if (!match) throw new Error("memo-backed Circle settlement event not found");
  if (match.args.target.toLowerCase() !== input.targetContract.toLowerCase()) throw new Error("memo-backed Circle settlement target mismatch");
  if (match.args.callDataHash.toLowerCase() !== input.callDataHash.toLowerCase()) throw new Error("memo-backed Circle settlement calldata mismatch");
  return {
    targetContract: match.args.target,
    callDataHash: match.args.callDataHash,
    memoIndex: Number(match.args.memoIndex)
  };
}

function walletForChain(agent: {chainWallets?: AgentChainWalletRecord[]; address: string | null; circleWalletId?: string | null}, chainId: number) {
  const chainWallet = agent.chainWallets?.find((wallet) => wallet.chainId === chainId);
  if (chainWallet) return chainWallet;
  if (chainId !== config.arc.chainId) return null;
  return {
    chainId,
    chain: "Arc Testnet",
    circleBlockchain: "ARC-TESTNET",
    address: agent.address,
    circleWalletId: agent.circleWalletId ?? null,
    status: agent.address ? "ready" : "circle_wallet_pending_address",
    updatedAt: new Date(0).toISOString()
  };
}

function updatedPolicyDeployments(policy: AgentPolicy, input: AgentPolicyInput & {txHash?: string | null}) {
  const existing = [...(policy.deployments ?? [])];
  if (!input.chainId) {
    return input.txHash
      ? [{
        chainId: config.arc.chainId,
        txHash: input.txHash,
        policyRegistry: config.contracts.policyRegistry || null,
        updatedAt: new Date().toISOString()
      }]
      : [];
  }

  const withoutCurrentChain = existing.filter((deployment) => deployment.chainId !== input.chainId);
  if (!input.txHash) return withoutCurrentChain;
  return [
    ...withoutCurrentChain,
    {
      chainId: input.chainId,
      txHash: input.txHash,
      policyRegistry: input.policyRegistry ?? chainContext(input.chainId).policyRegistry ?? null,
      updatedAt: new Date().toISOString()
    }
  ];
}

function legacyPolicyTxHash(policy: AgentPolicy, input: AgentPolicyInput & {txHash?: string | null}) {
  const deployments = updatedPolicyDeployments(policy, input);
  return deployments.find((deployment) => deployment.chainId === config.arc.chainId)?.txHash ?? null;
}

async function pollCircleTransaction(transactionId: string, client: CircleSettlementClient = circleClient()) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await client.getTransaction({id: transactionId});
    const transaction = response.data?.transaction;
    const state = transaction?.state ?? "UNKNOWN";
    if (["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(state)) {
      if (state !== "COMPLETE") {
        const reason = transaction?.errorReason ? `: ${transaction.errorReason}` : "";
        const details = transaction?.errorDetails ? ` (${transaction.errorDetails})` : "";
        const chain = transaction?.blockchain ? ` on ${transaction.blockchain}` : "";
        throw new Error(`Circle transaction ${transactionId} ended with ${state}${chain}${reason}${details}`);
      }
      return {state, txHash: transaction?.txHash ?? null};
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return {state: "PENDING", txHash: null};
}
