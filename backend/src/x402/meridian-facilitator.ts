// Task 5 — BotChain via Meridian (seller integration).
//
// On Arc, Nexora IS the facilitator: it self-submits transferWithAuthorization
// with its own key (see protocol-facilitator.ts). BotChain's payment token
// (USDT) has no EIP-3009, so that path can't work. Instead Nexora acts as a
// Meridian *seller*: it builds Permit2 payment requirements pointing at
// Meridian's already-deployed facilitator, the buyer signs a Permit2 witness
// off-chain, and Nexora relays the signed payload to Meridian's hosted settle
// API. Meridian pulls funds via Permit2 and distributes. Nexora deploys nothing
// and never holds a BotChain key.
//
// This module is intentionally isolated from protocol-facilitator.ts: the Arc
// EIP-3009 path is untouched. Verified constants live in memory
// (botchain-meridian-constants) and config.ts.

import {createPublicClient, createWalletClient, http, isAddress, keccak256, parseAbi, stringToHex, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {config} from "../config.js";
import {dispatchNotification} from "../notifications.js";
import {insertPayment, pushNotification, readStore, withAgentSpendLock, type PaymentRecord} from "../store.js";

// Meridian networks Nexora exposes. Testnet-first per rollout; mainnet is wired
// but gated behind an explicit opt-in env so we don't advertise it prematurely.
export type MeridianNetwork = "bot-chain-testnet" | "bot-chain";
export type MeridianNetworkId = MeridianNetwork | "eip155:968" | "eip155:677";

type MeridianNetworkConfig = {
  network: MeridianNetwork;
  chainId: number;
  rpcUrl: string;
  asset: string;
  assetSymbol: string;
  assetName: string;
  assetVersion: string;
  assetDecimals: number;
  facilitator: string;
  label: string;
};

// Build the per-network Meridian config from config.ts. Kept as a function (not
// a module-level constant) so tests that mutate env before import see fresh
// values, matching how the rest of the backend reads config.
function meridianNetworks(): Map<MeridianNetwork, MeridianNetworkConfig> {
  return new Map<MeridianNetwork, MeridianNetworkConfig>([
    [
      "bot-chain-testnet",
      {
        network: "bot-chain-testnet",
        chainId: config.botchain.testnetChainId,
        rpcUrl: config.botchain.testnetRpcUrl,
        asset: config.botchain.testnetUsdt,
        assetSymbol: "USDT",
        assetName: "USDT",
        assetVersion: "1",
        assetDecimals: config.botchain.tokenDecimals,
        facilitator: config.meridian.testnetFacilitator,
        label: "BOT Chain Testnet"
      }
    ],
    [
      "bot-chain",
      {
        network: "bot-chain",
        chainId: config.botchain.mainnetChainId,
        rpcUrl: config.botchain.mainnetRpcUrl,
        asset: config.botchain.mainnetUsdt,
        assetSymbol: "USDT",
        assetName: "USDT",
        assetVersion: "1",
        assetDecimals: config.botchain.tokenDecimals,
        facilitator: config.meridian.mainnetFacilitator,
        label: "BOT Chain"
      }
    ]
  ]);
}

export function normalizeMeridianNetwork(network: unknown): MeridianNetwork | null {
  if (network === "bot-chain-testnet" || network === "eip155:968") return "bot-chain-testnet";
  if (network === "bot-chain" || network === "eip155:677") return "bot-chain";
  return null;
}

export function isMeridianNetwork(network: unknown): network is MeridianNetworkId {
  return normalizeMeridianNetwork(network) !== null;
}

// Whether the Meridian seller path is usable. Requires an API key (held
// server-side) since settlement is a keyed call to Meridian. Without it we
// degrade gracefully rather than advertising a path we can't complete.
export function meridianConfigured() {
  return Boolean(config.meridian.publicKey.trim());
}

export function guardedMeridianConfigured() {
  return meridianConfigured()
    && isAddress(config.meridian.sellerAddress)
    && isAddress(config.botchain.testnetPolicyRegistry)
    && isAddress(config.botchain.testnetReputation)
    && /^0x[0-9a-fA-F]{64}$/.test(config.meridian.policyRelayerPrivateKey);
}

// Which Meridian networks Nexora actively advertises. Mainnet stays off until
// explicitly enabled so testnet-first rollout is the default.
export function enabledMeridianNetworks(): MeridianNetworkConfig[] {
  if (!guardedMeridianConfigured()) return [];
  const networks = meridianNetworks();
  const enabled: MeridianNetworkConfig[] = [];
  const testnet = networks.get("bot-chain-testnet");
  if (testnet && isAddress(testnet.asset) && isAddress(testnet.facilitator)) enabled.push(testnet);
  // Mainnet advertisement stays off until Nexora has separate mainnet policy,
  // reputation, and relayer configuration. Reusing testnet controls would make
  // the guard misleading.
  return enabled;
}

// x402 `supported` kinds contributed by the Meridian path, in the same shape as
// protocol-facilitator's supportedX402() so the router can merge them.
export function supportedMeridianKinds() {
  return enabledMeridianNetworks().map((net) => ({
    scheme: "exact" as const,
    network: net.network,
    asset: net.asset,
    assetSymbol: net.assetSymbol,
    settlement: "permit2-x402ExactPermit2Proxy",
    facilitator: "Meridian"
  }));
}

export function meridianNetworkConfig(network: MeridianNetwork): MeridianNetworkConfig {
  const entry = meridianNetworks().get(network);
  if (!entry) throw new Error(`unsupported Meridian network: ${network}`);
  if (!isAddress(entry.asset)) throw new Error(`Meridian asset is not configured for ${network}`);
  if (!isAddress(entry.facilitator)) throw new Error(`Meridian facilitator is not configured for ${network}`);
  return entry;
}

export type MeridianPaymentRequirements = {
  scheme: "exact";
  network: MeridianNetwork;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
  };
};

// Build the seller-side paymentRequirements for a Meridian Permit2 payment.
// Critical invariants from the Meridian docs, enforced here so callers can't get
// them wrong: payTo is the Meridian FACILITATOR (never the seller wallet), asset
// is the ERC-20 the buyer pays, and amounts are token base units.
export function buildMeridianPaymentRequirements(input: {
  network: MeridianNetwork;
  amountBaseUnits: string;
  resource: string;
  description?: string;
  maxTimeoutSeconds?: number;
}): MeridianPaymentRequirements {
  const net = meridianNetworkConfig(input.network);
  if (!/^\d+$/.test(input.amountBaseUnits) || input.amountBaseUnits === "0") {
    throw new Error("amountBaseUnits must be a positive integer string in token base units");
  }
  return {
    scheme: "exact",
    network: net.network,
    asset: net.asset,
    payTo: net.facilitator,
    maxAmountRequired: input.amountBaseUnits,
    resource: input.resource,
    description: input.description ?? "Nexora x402 paid service",
    mimeType: "application/json",
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 300,
    extra: {
      name: net.assetName,
      version: net.assetVersion
    }
  };
}

// Convert a human USDC/USDT-denominated amount into token base units using the
// network's configured decimals. Never assumes 6 — decimals come from config,
// which is overridable and should be confirmed on-chain.
export function meridianAmountToBaseUnits(network: MeridianNetwork, amount: number): string {
  const net = meridianNetworkConfig(network);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const scaled = BigInt(Math.round(amount * 10 ** net.assetDecimals));
  return scaled.toString();
}

// The Permit2 payment payload a buyer produces (signature + permit + witness).
// Shape mirrors the Meridian non-EIP-3009 docs. Validated before relay so we
// fail fast on a malformed client payload instead of forwarding junk.
export type MeridianPaymentPayload = {
  x402Version: 1;
  scheme: "exact";
  network: MeridianNetwork;
  payload: {
    signature: string;
    owner: string;
    permit: {
      permitted: {token: string; amount: string};
      nonce: string;
      deadline: string;
    };
    witness: {
      to: string;
      validAfter: string;
    };
  };
};

function assertValidPermit2Payload(payload: MeridianPaymentPayload, requirements: MeridianPaymentRequirements) {
  if (payload.x402Version !== 1) throw new Error("unsupported x402Version");
  if (payload.scheme !== "exact") throw new Error("unsupported scheme");
  if (normalizeMeridianNetwork(payload.network) !== requirements.network) throw new Error("payment network mismatch");
  const p = payload.payload;
  if (!p || typeof p !== "object") throw new Error("payment payload is required");
  if (typeof p.signature !== "string" || !p.signature.startsWith("0x")) throw new Error("payload.signature is invalid");
  if (!isAddress(String(p.owner))) throw new Error("payload.owner is invalid");
  if (!p.permit?.permitted || !isAddress(String(p.permit.permitted.token))) throw new Error("permit.permitted.token is invalid");
  if (p.permit.permitted.token.toLowerCase() !== requirements.asset.toLowerCase()) throw new Error("permit token does not match payment asset");
  if (!/^\d+$/.test(String(p.permit.permitted.amount))) throw new Error("permit.permitted.amount must be an integer string");
  // The signed amount must cover the required amount (exact scheme).
  if (BigInt(p.permit.permitted.amount) !== BigInt(requirements.maxAmountRequired)) {
    throw new Error("permit amount does not match the required amount");
  }
  if (!/^\d+$/.test(String(p.permit.nonce))) throw new Error("permit.nonce must be an integer string");
  if (!/^\d+$/.test(String(p.permit.deadline))) throw new Error("permit.deadline must be an integer string");
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (BigInt(p.permit.deadline) <= now) throw new Error("permit authorization expired");
  // witness.to MUST be the facilitator — this is what binds the payment to
  // Meridian's settlement. A mismatch means funds would route elsewhere.
  if (!p.witness || String(p.witness.to).toLowerCase() !== requirements.payTo.toLowerCase()) {
    throw new Error("witness.to must equal the Meridian facilitator (payTo)");
  }
  if (!/^\d+$/.test(String(p.witness.validAfter))) throw new Error("witness.validAfter must be an integer string");
  if (BigInt(p.witness.validAfter) > now) throw new Error("permit authorization is not valid yet");
}

export function verifyMeridianPayment(input: {
  paymentPayload: Omit<MeridianPaymentPayload, "network"> & {network: MeridianNetworkId};
  paymentRequirements: Omit<MeridianPaymentRequirements, "network"> & {network: MeridianNetworkId};
}) {
  const network = normalizeMeridianNetwork(input.paymentRequirements?.network);
  if (!network) return {isValid: false, invalidReason: "This BOT Chain network is not supported."};
  try {
    const requirements = buildMeridianPaymentRequirements({
      network,
      amountBaseUnits: input.paymentRequirements.maxAmountRequired,
      resource: input.paymentRequirements.resource,
      description: input.paymentRequirements.description,
      maxTimeoutSeconds: input.paymentRequirements.maxTimeoutSeconds
    });
    const payload = {...input.paymentPayload, network} as MeridianPaymentPayload;
    assertValidPermit2Payload(payload, requirements);
    return {
      isValid: true,
      payer: payload.payload.owner,
      amount: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      network,
      asset: requirements.asset
    };
  } catch (error) {
    return {
      isValid: false,
      invalidReason: safeMeridianVerificationReason(error)
    };
  }
}

export type MeridianSettleResult = {
  success: boolean;
  transaction?: string | null;
  network: MeridianNetwork;
  payer?: string | null;
  amount?: string | null;
  asset?: string | null;
  errorReason?: string | null;
};

type FetchLike = (url: string, init: {method: string; headers: Record<string, string>; body: string}) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

// Relay a signed Permit2 payload to Meridian's settle API. The API key is read
// from config (server-side only) and never leaves the backend. `fetchImpl` is
// injectable so tests exercise the relay without a live network.
export async function settleMeridianPayment(
  input: {
    paymentPayload: Omit<MeridianPaymentPayload, "network"> & {network: MeridianNetworkId};
    paymentRequirements: Omit<MeridianPaymentRequirements, "network"> & {network: MeridianNetworkId};
  },
  options: {fetchImpl?: FetchLike} = {}
): Promise<MeridianSettleResult> {
  const requestedNetwork = input.paymentRequirements?.network;
  const network = normalizeMeridianNetwork(requestedNetwork);
  if (!network) {
    return {success: false, network: requestedNetwork as MeridianNetwork, errorReason: "This BOT Chain network is not supported."};
  }
  if (!meridianConfigured()) {
    return {
      success: false,
      network,
      errorReason: "BOT Chain settlement is not configured for this Nexora workspace."
    };
  }

  // Rebuild requirements server-side and validate the payload against them, so a
  // malformed or mis-targeted client payload is rejected before we spend a
  // Meridian API call. We trust our own rebuilt requirements, not the client's.
  const requirements = buildMeridianPaymentRequirements({
    network,
    amountBaseUnits: input.paymentRequirements.maxAmountRequired,
    resource: input.paymentRequirements.resource,
    description: input.paymentRequirements.description,
    maxTimeoutSeconds: input.paymentRequirements.maxTimeoutSeconds
  });
  const normalizedPayload = {...input.paymentPayload, network} as MeridianPaymentPayload;
  try {
    assertValidPermit2Payload(normalizedPayload, requirements);
  } catch (error) {
    return {
      success: false,
      network,
      errorReason: safeMeridianVerificationReason(error)
    };
  }

  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (!fetchImpl) {
    return {success: false, network, errorReason: "no fetch implementation available for Meridian settlement"};
  }

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`${config.meridian.apiBase.replace(/\/+$/, "")}/settle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.meridian.publicKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        paymentPayload: normalizedPayload,
        paymentRequirements: requirements
      })
    });
  } catch {
    return {success: false, network, errorReason: "Meridian settlement service is temporarily unreachable."};
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const success = response.ok && parsed.success === true;
  const providerReason = success
    ? null
    : (typeof parsed.errorReason === "string" && parsed.errorReason)
      || (typeof parsed.error === "string" && parsed.error)
      || null;
  const errorReason = success ? null : safeMeridianErrorReason(providerReason, response.status);

  return {
    success,
    network,
    transaction: (parsed.transaction as string) ?? (parsed.txHash as string) ?? null,
    payer: (parsed.payer as string) ?? normalizedPayload.payload.owner ?? null,
    amount: requirements.maxAmountRequired,
    asset: requirements.asset,
    errorReason: errorReason || null
  };
}

const botPolicyAbi = parseAbi([
  "function canSpendV2(address agentWallet,address targetContract,address recipient,uint256 amount,bytes32 serviceId,uint256 units) view returns (bool)",
  "function recordSpendV2(address agentWallet,address targetContract,address recipient,uint256 amount,bytes32 serviceId,uint256 units)"
]);
const botReputationAbi = parseAbi([
  "function record(address operator,uint8 metric,uint256 amount)"
]);

type GuardedMeridianDependencies = {
  fetchImpl?: FetchLike;
  canSpend?: (input: GuardedMeridianPolicyContext) => Promise<boolean>;
  recordAccounting?: (input: GuardedMeridianPolicyContext) => Promise<string[]>;
};

type GuardedMeridianPolicyContext = {
  network: MeridianNetwork;
  owner: Address;
  facilitator: Address;
  seller: Address;
  amount: bigint;
  serviceId: Hex;
  resource: string;
  units: bigint;
};

/**
 * Policy-aware BOT settlement. Nexora derives the controlled wallet from the
 * signed Permit2 owner, derives the seller from server configuration, checks
 * the BOT policy registry, then relays to Meridian. A direct call to Meridian
 * remains outside Nexora's enforcement boundary.
 */
export async function settleGuardedMeridianPayment(
  input: Parameters<typeof settleMeridianPayment>[0],
  dependencies: GuardedMeridianDependencies = {}
) {
  const network = normalizeMeridianNetwork(input.paymentRequirements?.network);
  if (!network) return {success: false, errorReason: "This BOT Chain network is not supported."};
  if (network !== "bot-chain-testnet") {
    return {success: false, network, errorReason: "BOT Chain mainnet policy settlement is not enabled yet."};
  }
  if (!guardedMeridianConfigured() && (!dependencies.canSpend || !dependencies.recordAccounting)) {
    return {
      success: false,
      network,
      errorReason: "BOT Chain policy settlement is not configured for this Nexora workspace."
    };
  }

  const verification = verifyMeridianPayment(input);
  if (!verification.isValid || !verification.payer || !isAddress(verification.payer)) {
    return {success: false, network, errorReason: verification.invalidReason ?? "The BOT Chain payment authorization is invalid."};
  }
  const requirements = buildMeridianPaymentRequirements({
    network,
    amountBaseUnits: input.paymentRequirements.maxAmountRequired,
    resource: input.paymentRequirements.resource,
    description: input.paymentRequirements.description,
    maxTimeoutSeconds: input.paymentRequirements.maxTimeoutSeconds
  });
  const owner = verification.payer as Address;
  const context: GuardedMeridianPolicyContext = {
    network,
    owner,
    facilitator: requirements.payTo as Address,
    seller: config.meridian.sellerAddress as Address,
    amount: BigInt(requirements.maxAmountRequired),
    serviceId: keccak256(stringToHex(requirements.resource.trim().toLowerCase())),
    resource: requirements.resource,
    units: 1n
  };
  const authorizationId = `meridian:${network}:${owner.toLowerCase()}:${input.paymentPayload.payload.permit.nonce}`;

  return withAgentSpendLock(`external:${network}:${owner.toLowerCase()}`, async () => {
    const before = await readStore();
    const externalAgentId = before.agents.find((agent) => (
      agent.walletKind === "external_eoa"
      && agent.operatorAddress.toLowerCase() === owner.toLowerCase()
      && agent.chainWallets?.some((wallet) => wallet.chainId === config.botchain.testnetChainId)
    ))?.id ?? null;
    const replay = before.payments.find((payment) => payment.authorizationId === authorizationId);
    if (replay) {
      return {
        success: replay.status === "settled",
        network,
        transaction: replay.txHash ?? null,
        payer: owner,
        amount: requirements.maxAmountRequired,
        asset: requirements.asset,
        receiptId: replay.id,
        replay: true,
        errorReason: replay.status === "settled" ? null : replay.policyReason ?? "This BOT Chain authorization was already processed."
      };
    }
    const accountingPending = before.payments.some((payment) => (
      payment.external?.provider === "meridian"
      && payment.agentWallet?.toLowerCase() === owner.toLowerCase()
      && payment.external.accountingStatus === "pending"
    ));
    if (accountingPending) {
      return {
        success: false,
        network,
        errorReason: "A previous BOT Chain payment is waiting for policy accounting. Try again after it is reconciled."
      };
    }

    const allowed = dependencies.canSpend
      ? await dependencies.canSpend(context)
      : await botPolicyCanSpend(context);
    if (!allowed) {
      const receipt = await recordGuardedMeridianPayment({
        authorizationId,
        context,
        requirements,
        agentId: externalAgentId,
        status: "policy_blocked",
        policyReason: "Nexora policy blocked this BOT Chain payment before Meridian settlement."
      });
      return {
        success: false,
        network,
        payer: owner,
        amount: requirements.maxAmountRequired,
        asset: requirements.asset,
        receiptId: receipt.id,
        errorReason: receipt.policyReason
      };
    }

    const settlement = await settleMeridianPayment(input, {fetchImpl: dependencies.fetchImpl});
    if (!settlement.success) {
      const receipt = await recordGuardedMeridianPayment({
        authorizationId,
        context,
        requirements,
        agentId: externalAgentId,
        status: "failed",
        policyReason: settlement.errorReason ?? "BOT Chain settlement failed."
      });
      return {...settlement, receiptId: receipt.id};
    }

    let accountingStatus: "recorded" | "pending" = "recorded";
    let accountingTxHashes: string[] = [];
    try {
      accountingTxHashes = dependencies.recordAccounting
        ? await dependencies.recordAccounting(context)
        : await recordBotPolicyAndReputation(context);
    } catch {
      accountingStatus = "pending";
    }
    const receipt = await recordGuardedMeridianPayment({
      authorizationId,
      context,
      requirements,
      agentId: externalAgentId,
      status: "settled",
      txHash: settlement.transaction ?? null,
      accountingStatus,
      accountingTxHashes
    });
    return {
      ...settlement,
      receiptId: receipt.id,
      policy: {checked: true, accountingStatus, accountingTxHashes},
      warning: accountingStatus === "pending"
        ? "Payment settled, but BOT policy accounting needs reconciliation before this wallet can make another Nexora-routed payment."
        : null
    };
  });
}

async function botPolicyCanSpend(input: GuardedMeridianPolicyContext) {
  const client = createPublicClient({transport: http(config.botchain.testnetRpcUrl, {timeout: 20_000})});
  return client.readContract({
    address: config.botchain.testnetPolicyRegistry as Address,
    abi: botPolicyAbi,
    functionName: "canSpendV2",
    args: [input.owner, input.facilitator, input.seller, input.amount, input.serviceId, input.units]
  });
}

async function recordBotPolicyAndReputation(input: GuardedMeridianPolicyContext) {
  const account = privateKeyToAccount(config.meridian.policyRelayerPrivateKey as Hex);
  const wallet = createWalletClient({account, transport: http(config.botchain.testnetRpcUrl, {timeout: 20_000})});
  const publicClient = createPublicClient({transport: http(config.botchain.testnetRpcUrl, {timeout: 20_000})});
  const hashes: string[] = [];
  const spendHash = await wallet.writeContract({
    chain: undefined,
    address: config.botchain.testnetPolicyRegistry as Address,
    abi: botPolicyAbi,
    functionName: "recordSpendV2",
    args: [input.owner, input.facilitator, input.seller, input.amount, input.serviceId, input.units]
  });
  await publicClient.waitForTransactionReceipt({hash: spendHash});
  hashes.push(spendHash);

  const payerReputationHash = await wallet.writeContract({
    chain: undefined,
    address: config.botchain.testnetReputation as Address,
    abi: botReputationAbi,
    functionName: "record",
    args: [input.owner, 0, 1n]
  });
  await publicClient.waitForTransactionReceipt({hash: payerReputationHash});
  hashes.push(payerReputationHash);

  const sellerReputationHash = await wallet.writeContract({
    chain: undefined,
    address: config.botchain.testnetReputation as Address,
    abi: botReputationAbi,
    functionName: "record",
    args: [input.seller, 2, 1n]
  });
  await publicClient.waitForTransactionReceipt({hash: sellerReputationHash});
  hashes.push(sellerReputationHash);
  return hashes;
}

async function recordGuardedMeridianPayment(input: {
  authorizationId: string;
  context: GuardedMeridianPolicyContext;
  requirements: MeridianPaymentRequirements;
  agentId?: string | null;
  status: PaymentRecord["status"];
  txHash?: string | null;
  policyReason?: string | null;
  accountingStatus?: "recorded" | "pending";
  accountingTxHashes?: string[];
}) {
  const now = new Date().toISOString();
  const amount = Number(input.context.amount) / 10 ** meridianNetworkConfig(input.context.network).assetDecimals;
  const payment: PaymentRecord = {
    id: crypto.randomUUID(),
    authorizationId: input.authorizationId,
    serviceId: `meridian:${input.context.serviceId}`,
    serviceName: input.requirements.description || "BOT Chain x402 service",
    payer: input.context.owner,
    agentId: input.agentId ?? null,
    agentWallet: input.context.owner,
    publisherAddress: input.context.seller,
    amountUsdc: amount,
    grossAmountUsdc: amount,
    platformFeeUsdc: 0,
    publisherNetUsdc: input.status === "settled" ? amount : 0,
    facilitatorFeeBps: 0,
    units: Number(input.context.units),
    requestHash: input.context.serviceId,
    status: input.status,
    policyReason: input.policyReason ?? null,
    memo: null,
    txHash: input.txHash ?? null,
    external: {
      provider: "meridian",
      serviceUrl: input.context.resource,
      chain: "BOT Chain Testnet",
      chainId: config.botchain.testnetChainId,
      network: input.context.network,
      paymentScheme: "permit2-x402ExactPermit2Proxy",
      resultSummary: null,
      accountingStatus: input.accountingStatus ?? null,
      accountingTxHashes: input.accountingTxHashes ?? null,
      assetSymbol: meridianNetworkConfig(input.context.network).assetSymbol
    },
    createdAt: now,
    settledAt: input.status === "settled" ? now : null
  };
  const result = await insertPayment(payment, (store) => {
    const notification = pushNotification(store, {
      operatorAddress: payment.payer,
      title: input.status === "settled" ? "BOT Chain payment settled" : input.status === "policy_blocked" ? "BOT Chain payment blocked" : "BOT Chain payment failed",
      detail: `${payment.serviceName} · ${amount} ${meridianNetworkConfig(input.context.network).assetSymbol}`,
      kind: input.status === "settled" ? "payment" : "policy",
      txHash: payment.txHash,
      receiptId: payment.id,
      actionHref: `/receipts/${encodeURIComponent(payment.id)}`
    });
    return {notification};
  });
  if (result?.notification) {
    await dispatchNotification({
      notification: result.notification,
      event: input.status === "settled" ? "paymentReceipts" : "policyAlerts",
      receiptId: payment.id
    }).catch(() => undefined);
  }
  return payment;
}

function safeMeridianErrorReason(reason: string | null, status: number) {
  const message = reason?.trim() ?? "";
  if (/insufficient|balance|funds/i.test(message)) {
    return "The BOT Chain wallet does not have enough USDT or gas for this payment.";
  }
  if (/allowance|permit2|approval/i.test(message)) {
    return "The BOT Chain USDT approval is missing or expired. Approve Permit2 and try again.";
  }
  if (/expired|deadline|timeout/i.test(message)) {
    return "The BOT Chain payment authorization expired. Create a new authorization and try again.";
  }
  if (/signature|authorization|witness|nonce/i.test(message)) {
    return "The BOT Chain payment authorization was rejected. Sign a fresh payment request and try again.";
  }
  if (status === 401 || status === 403) {
    return "BOT Chain settlement is temporarily unavailable because the facilitator credentials were rejected.";
  }
  if (status === 429) {
    return "BOT Chain settlement is temporarily busy. Please try again shortly.";
  }
  return "BOT Chain settlement could not be completed. No successful payment was recorded.";
}

function safeMeridianVerificationReason(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/expired|deadline/i.test(message)) return "The BOT Chain payment authorization expired.";
  if (/not valid yet/i.test(message)) return "The BOT Chain payment authorization is not valid yet.";
  if (/amount/i.test(message)) return "The BOT Chain payment amount does not match the service price.";
  if (/token|asset/i.test(message)) return "The BOT Chain payment token does not match this service.";
  if (/network/i.test(message)) return "The BOT Chain payment network does not match this service.";
  return "The BOT Chain payment authorization is invalid.";
}
