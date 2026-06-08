import {createPublicClient, createWalletClient, encodeFunctionData, http, isAddress, parseAbi, verifyTypedData, type Address, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {config} from "../config.js";
import {pushNotification, readStore, updateStore} from "../store.js";

const transferWithAuthorizationAbi = parseAbi([
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)"
]);

const supportedNetworks = new Map([
  ["arc-testnet", {chainId: config.arc.chainId, rpcUrl: config.arc.rpcUrl, usdc: config.contracts.usdc, label: "Arc Testnet"}],
  ["arc", {chainId: config.arc.chainId, rpcUrl: config.arc.rpcUrl, usdc: config.contracts.usdc, label: "Arc Testnet"}]
]);

type PaymentRequirements = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  outputSchema?: unknown;
  extra?: {
    name?: string;
    version?: string;
  };
};

type PaymentPayload = {
  x402Version: number;
  scheme: string;
  network: string;
  payload?: {
    signature?: string;
    authorization?: {
      from?: string;
      to?: string;
      value?: string;
      validAfter?: string;
      validBefore?: string;
      nonce?: string;
    };
  };
};

type FacilitatorInput = {
  paymentPayload: unknown;
  paymentRequirements: unknown;
};

export function supportedX402() {
  return {
    x402Version: 1,
    kinds: [
      {
        scheme: "exact",
        network: "arc-testnet",
        asset: config.contracts.usdc,
        assetSymbol: "USDC",
        settlement: "erc3009-transferWithAuthorization",
        facilitator: "Nexora"
      }
    ].filter((item) => isAddress(item.asset))
  };
}

export async function verifyFacilitatorPayment(input: FacilitatorInput) {
  const parsed = parseFacilitatorInput(input);
  const duplicate = await isRequestSettled(parsed.requestHash);
  if (duplicate) {
    const result = {
      isValid: false,
      invalidReason: "payment authorization has already been settled",
      payer: parsed.authorization.from
    };
    await recordFacilitatorEvent(parsed, "verify", "failed", {reason: result.invalidReason});
    return result;
  }

  const signatureValid = await verifyPaymentSignature(parsed);
  if (!signatureValid) {
    const result = {
      isValid: false,
      invalidReason: "invalid payment signature",
      payer: parsed.authorization.from
    };
    await recordFacilitatorEvent(parsed, "verify", "failed", {reason: result.invalidReason});
    return result;
  }

  await recordFacilitatorEvent(parsed, "verify", "success");
  return {
    isValid: true,
    payer: parsed.authorization.from,
    amount: parsed.authorization.value,
    payTo: parsed.authorization.to,
    network: parsed.requirements.network,
    asset: parsed.requirements.asset
  };
}

export async function settleFacilitatorPayment(input: FacilitatorInput) {
  const verification = await verifyFacilitatorPayment(input);
  if (verification.isValid !== true) {
    return {
      success: false,
      errorReason: "invalidReason" in verification ? verification.invalidReason : "payment verification failed",
      payer: verification.payer
    };
  }

  const parsed = parseFacilitatorInput(input);
  const network = requiredNetwork(parsed.requirements.network);
  if (!config.facilitator.privateKey) {
    return {
      success: false,
      errorReason: "Nexora facilitator settlement is temporarily unavailable.",
      payer: parsed.authorization.from
    };
  }

  const account = privateKeyToAccount(normalizePrivateKey(config.facilitator.privateKey));
  const wallet = createWalletClient({
    account,
    chain: viemChain(parsed.requirements.network, network.chainId, network.rpcUrl),
    transport: http(network.rpcUrl)
  });
  const publicClient = createPublicClient({
    chain: viemChain(parsed.requirements.network, network.chainId, network.rpcUrl),
    transport: http(network.rpcUrl)
  });
  const {v, r, s} = splitSignature(parsed.signature);

  const hash = await wallet.writeContract({
    address: parsed.requirements.asset as Address,
    abi: transferWithAuthorizationAbi,
    functionName: "transferWithAuthorization",
    args: [
      parsed.authorization.from as Address,
      parsed.authorization.to as Address,
      BigInt(parsed.authorization.value),
      BigInt(parsed.authorization.validAfter),
      BigInt(parsed.authorization.validBefore),
      parsed.authorization.nonce as Hex,
      v,
      r,
      s
    ]
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  await recordExternalSettlement(parsed, hash);
  await recordFacilitatorEvent(parsed, "settle", receipt.status === "success" ? "success" : "failed", {txHash: hash});

  return {
    success: receipt.status === "success",
    transaction: hash,
    network: parsed.requirements.network,
    payer: parsed.authorization.from,
    payerAddress: parsed.authorization.from,
    amount: parsed.authorization.value,
    asset: parsed.requirements.asset
  };
}

async function recordFacilitatorEvent(
  input: ReturnType<typeof parseFacilitatorInput>,
  kind: "verify" | "settle",
  status: "success" | "failed",
  extra: {reason?: string | null; txHash?: string | null} = {}
) {
  const amountUsdc = Number(input.authorization.value) / 1_000_000;
  await updateStore((store) => {
    store.facilitatorEvents.push({
      id: crypto.randomUUID(),
      kind,
      status,
      payer: input.authorization.from,
      payTo: input.authorization.to,
      network: input.requirements.network,
      asset: input.requirements.asset,
      amountUsdc,
      requestHash: input.requestHash,
      txHash: extra.txHash ?? null,
      reason: extra.reason ?? null,
      createdAt: new Date().toISOString()
    });
    if (store.facilitatorEvents.length > 500) {
      store.facilitatorEvents = store.facilitatorEvents.slice(-500);
    }
  });
}

function parseFacilitatorInput(input: FacilitatorInput) {
  const paymentPayload = input.paymentPayload as PaymentPayload;
  const requirements = input.paymentRequirements as PaymentRequirements;
  if (!paymentPayload || typeof paymentPayload !== "object") throw new Error("paymentPayload is required");
  if (!requirements || typeof requirements !== "object") throw new Error("paymentRequirements is required");
  if (paymentPayload.x402Version !== 1) throw new Error("unsupported x402Version");
  if (paymentPayload.scheme !== "exact" || requirements.scheme !== "exact") throw new Error("unsupported x402 scheme");
  if (paymentPayload.network !== requirements.network) throw new Error("payment network mismatch");

  const network = requiredNetwork(requirements.network);
  if (!isAddress(requirements.asset) || requirements.asset.toLowerCase() !== network.usdc.toLowerCase()) {
    throw new Error("unsupported payment asset");
  }
  if (!isAddress(requirements.payTo)) throw new Error("paymentRequirements.payTo is invalid");

  const authorization = paymentPayload.payload?.authorization;
  const signature = paymentPayload.payload?.signature;
  if (!authorization || typeof authorization !== "object") throw new Error("payment authorization is required");
  if (!signature?.startsWith("0x")) throw new Error("payment signature is required");
  if (!isAddress(String(authorization.from))) throw new Error("authorization.from is invalid");
  if (!isAddress(String(authorization.to))) throw new Error("authorization.to is invalid");
  if (String(authorization.to).toLowerCase() !== requirements.payTo.toLowerCase()) throw new Error("payment recipient mismatch");
  if (!String(authorization.nonce ?? "").startsWith("0x")) throw new Error("authorization.nonce is invalid");

  const value = BigInt(requiredIntegerString(authorization.value, "authorization.value"));
  const maxAmountRequired = BigInt(requiredIntegerString(requirements.maxAmountRequired, "paymentRequirements.maxAmountRequired"));
  if (value === 0n) throw new Error("payment value is zero");
  if (value > maxAmountRequired) throw new Error("payment value exceeds maxAmountRequired");

  const validAfter = BigInt(requiredIntegerString(authorization.validAfter, "authorization.validAfter"));
  const validBefore = BigInt(requiredIntegerString(authorization.validBefore, "authorization.validBefore"));
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validAfter > now) throw new Error("payment authorization is not valid yet");
  if (validBefore <= now) throw new Error("payment authorization expired");

  return {
    requirements,
    paymentPayload,
    signature: signature as Hex,
    authorization: {
      from: authorization.from as string,
      to: authorization.to as string,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: authorization.nonce as string
    },
    requestHash: requestHash(requirements.network, requirements.asset, authorization.nonce as string)
  };
}

async function verifyPaymentSignature(input: ReturnType<typeof parseFacilitatorInput>) {
  const network = requiredNetwork(input.requirements.network);
  return verifyTypedData({
    address: input.authorization.from as Address,
    domain: {
      name: input.requirements.extra?.name ?? "USDC",
      version: input.requirements.extra?.version ?? "2",
      chainId: network.chainId,
      verifyingContract: input.requirements.asset as Address
    },
    types: {
      TransferWithAuthorization: [
        {name: "from", type: "address"},
        {name: "to", type: "address"},
        {name: "value", type: "uint256"},
        {name: "validAfter", type: "uint256"},
        {name: "validBefore", type: "uint256"},
        {name: "nonce", type: "bytes32"}
      ]
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: input.authorization.from as Address,
      to: input.authorization.to as Address,
      value: BigInt(input.authorization.value),
      validAfter: BigInt(input.authorization.validAfter),
      validBefore: BigInt(input.authorization.validBefore),
      nonce: input.authorization.nonce as Hex
    },
    signature: input.signature
  });
}

async function isRequestSettled(hash: string) {
  const store = await readStore();
  return store.payments.some((payment) => payment.requestHash === hash && payment.status === "settled");
}

async function recordExternalSettlement(input: ReturnType<typeof parseFacilitatorInput>, txHash: string) {
  await updateStore((store) => {
    const existing = store.payments.find((payment) => payment.requestHash === input.requestHash);
    const amountUsdc = Number(input.authorization.value) / 1_000_000;
    if (existing) {
      existing.status = "settled";
      existing.txHash = txHash;
      existing.settledAt = new Date().toISOString();
      return existing;
    }
    const payment = {
      id: crypto.randomUUID(),
      authorizationId: input.requestHash,
      serviceId: `external:${input.requestHash}`,
      serviceName: input.requirements.description ?? input.requirements.resource,
      payer: input.authorization.from,
      agentId: null,
      agentWallet: null,
      publisherAddress: input.authorization.to,
      amountUsdc,
      grossAmountUsdc: amountUsdc,
      platformFeeUsdc: 0,
      publisherNetUsdc: amountUsdc,
      facilitatorFeeBps: 0,
      units: 1,
      requestHash: input.requestHash,
      status: "settled" as const,
      policyReason: null,
      txHash,
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString()
    };
    store.payments.push(payment);
    pushNotification(store, {
      operatorAddress: input.authorization.to,
      title: "x402 payment settled",
      detail: `${amountUsdc} USDC for ${input.requirements.resource}`,
      kind: "payment",
      txHash
    });
    return payment;
  });
}

function requiredNetwork(network: string) {
  const entry = supportedNetworks.get(network);
  if (!entry || !isAddress(entry.usdc)) throw new Error(`unsupported x402 network: ${network}`);
  return entry;
}

function requiredIntegerString(value: unknown, label: string) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new Error(`${label} is required`);
  const normalized = String(value);
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be an integer string`);
  return normalized;
}

function requestHash(network: string, asset: string, nonce: string) {
  return `${network}:${asset.toLowerCase()}:${nonce.toLowerCase()}`;
}

function splitSignature(signature: Hex) {
  const normalized = signature.slice(2);
  if (normalized.length !== 130) throw new Error("signature must be 65 bytes");
  const r = `0x${normalized.slice(0, 64)}` as Hex;
  const s = `0x${normalized.slice(64, 128)}` as Hex;
  const recovery = Number.parseInt(normalized.slice(128, 130), 16);
  return {r, s, v: recovery < 27 ? recovery + 27 : recovery};
}

function normalizePrivateKey(value: string) {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

function viemChain(network: string, chainId: number, rpcUrl: string) {
  return {
    id: chainId,
    name: network,
    nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
    rpcUrls: {default: {http: [rpcUrl]}}
  } as const;
}
