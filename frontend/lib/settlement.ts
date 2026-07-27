// Task 7 — Nexora-owned x402 settlement (frontend). Runs the full fee-collecting
// settlement flow through NexoraX402Settlement: sign an EIP-3009
// receiveWithAuthorization to the settlement contract, then submit settle() from
// the CONNECTED wallet (payer/seller), so Nexora pays no gas and still earns the
// fee. The seller + fee ceiling are bound into the signed nonce (must match the
// contract's expectedNonce and the backend's expectedSettlementNonce).

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  http,
  keccak256,
  parseUnits,
  type Address,
  type Hex
} from "viem";
import {x402SignNetwork, type X402SignNetwork} from "@/lib/x402-networks";

// EIP-712 type for USDC receiveWithAuthorization.
const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    {name: "from", type: "address"},
    {name: "to", type: "address"},
    {name: "value", type: "uint256"},
    {name: "validAfter", type: "uint256"},
    {name: "validBefore", type: "uint256"},
    {name: "nonce", type: "bytes32"}
  ]
} as const;

// settle(from,value,validAfter,validBefore,nonce,v,r,s,seller,maxFeeBps,salt)
const settlementAbi = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      {name: "from", type: "address"},
      {name: "value", type: "uint256"},
      {name: "validAfter", type: "uint256"},
      {name: "validBefore", type: "uint256"},
      {name: "nonce", type: "bytes32"},
      {name: "v", type: "uint8"},
      {name: "r", type: "bytes32"},
      {name: "s", type: "bytes32"},
      {name: "seller", type: "address"},
      {name: "maxFeeBps", type: "uint16"},
      {name: "salt", type: "bytes32"}
    ],
    outputs: [{name: "platformFee", type: "uint256"}]
  }
] as const;

// Bound nonce = keccak256(abi.encode(seller, maxFeeBps, salt)).
export function bindSettlementNonce(seller: Address, maxFeeBps: number, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{type: "address"}, {type: "uint16"}, {type: "bytes32"}], [seller, maxFeeBps, salt])
  );
}

export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function splitSignature(sig: Hex): {v: number; r: Hex; s: Hex} {
  const body = sig.slice(2);
  const r = `0x${body.slice(0, 64)}` as Hex;
  const s = `0x${body.slice(64, 128)}` as Hex;
  let v = parseInt(body.slice(128, 130), 16);
  if (v < 27) v += 27;
  return {v, r, s};
}

export type SettlementResult = {
  networkId: string;
  txHash: Hex;
  nonce: Hex;
  seller: Address;
  amountUsdc: string;
  settlementContract: Address;
};

export type SettlementRequirements = {
  scheme: "exact";
  network: string;
  asset: Address;
  payTo: Address;
  maxAmountRequired: string;
  extra: {
    settlement: "nexora-x402-settlement";
    seller: Address;
    maxFeeBps: number;
    salt: Hex;
    nonce: Hex;
  };
};

export function settlementAmountBaseUnits(amountUsdc: string) {
  const value = parseUnits(amountUsdc.trim(), 6);
  if (value <= 0n) throw new Error("Amount must be greater than 0");
  return value;
}

// Sign the authorization and submit settle() from the connected wallet. Requires
// the selected network to have a settlement contract configured.
export async function paySettlementContract(input: {
  networkId: string;
  seller: Address;
  amountUsdc: string;
  requirements: SettlementRequirements;
}): Promise<SettlementResult> {
  if (typeof window === "undefined" || !window.ethereum) throw new Error("No injected wallet found");
  const net: X402SignNetwork | undefined = x402SignNetwork(input.networkId);
  if (!net) throw new Error("Unsupported network");
  if (!net.settlementContract) throw new Error(`No Nexora settlement contract deployed on ${net.label}`);

  const [account] = await window.ethereum.request<string[]>({method: "eth_requestAccounts"});
  if (!account) throw new Error("Wallet connection rejected");
  const from = account as Address;

  const value = settlementAmountBaseUnits(input.amountUsdc);
  const requirements = validateSettlementRequirements(input, net, value);

  const now = Math.floor(Date.now() / 1000);
  const validAfter = 0n;
  const validBefore = BigInt(now + 30 * 60);
  const {salt, nonce, maxFeeBps} = requirements.extra;

  const chain = {
    id: net.chainId,
    name: net.label,
    nativeCurrency: {name: "ETH", symbol: "ETH", decimals: 18},
    rpcUrls: {default: {http: [] as string[]}}
  } as const;
  const wallet = createWalletClient({account: from, chain, transport: custom(window.ethereum)});
  const publicClient = createPublicClient({chain, transport: custom(window.ethereum)});

  const signature = (await wallet.signTypedData({
    account: from,
    domain: {name: net.domainName, version: net.domainVersion, chainId: net.chainId, verifyingContract: net.usdc},
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from,
      to: requirements.payTo,
      value,
      validAfter,
      validBefore,
      nonce
    }
  })) as Hex;
  const {v, r, s} = splitSignature(signature);

  // Simulate with the exact signed arguments before opening the final wallet
  // transaction prompt. This catches fee, nonce, balance, and token issues
  // without submitting a transaction that is already known to revert.
  const simulation = await publicClient.simulateContract({
    account: from,
    address: requirements.payTo,
    abi: settlementAbi,
    functionName: "settle",
    args: [from, value, validAfter, validBefore, nonce, v, r, s, input.seller, maxFeeBps, salt]
  });
  const txHash = (await wallet.writeContract(simulation.request)) as Hex;

  return {
    networkId: net.id,
    txHash,
    nonce,
    seller: input.seller,
    amountUsdc: input.amountUsdc,
    settlementContract: requirements.payTo
  };
}

function validateSettlementRequirements(
  input: {networkId: string; seller: Address; requirements: SettlementRequirements},
  net: X402SignNetwork,
  value: bigint
) {
  const requirements = input.requirements;
  if (requirements.scheme !== "exact" || requirements.network !== net.id) throw new Error("Settlement requirements do not match the selected network");
  if (requirements.asset.toLowerCase() !== net.usdc.toLowerCase()) throw new Error("Settlement requirements use the wrong payment token");
  if (!net.settlementContract || requirements.payTo.toLowerCase() !== net.settlementContract.toLowerCase()) {
    throw new Error("Settlement requirements use the wrong settlement contract");
  }
  if (requirements.maxAmountRequired !== value.toString()) throw new Error("Settlement requirements use the wrong payment amount");
  if (requirements.extra.settlement !== "nexora-x402-settlement") throw new Error("Unsupported settlement requirements");
  if (requirements.extra.seller.toLowerCase() !== input.seller.toLowerCase()) throw new Error("Settlement requirements use the wrong seller");
  if (!/^0x[0-9a-fA-F]{64}$/.test(requirements.extra.salt) || !/^0x[0-9a-fA-F]{64}$/.test(requirements.extra.nonce)) {
    throw new Error("Settlement requirements contain an invalid authorization value");
  }
  if (!Number.isInteger(requirements.extra.maxFeeBps) || requirements.extra.maxFeeBps < 0 || requirements.extra.maxFeeBps > 1_000) {
    throw new Error("Settlement requirements contain an invalid fee ceiling");
  }
  const expectedNonce = bindSettlementNonce(input.seller, requirements.extra.maxFeeBps, requirements.extra.salt);
  if (expectedNonce.toLowerCase() !== requirements.extra.nonce.toLowerCase()) throw new Error("Settlement requirements contain an invalid nonce");
  return requirements;
}

// Wait for the settle tx to confirm (public RPC read).
export async function waitForSettlement(networkId: string, txHash: Hex): Promise<"success" | "reverted"> {
  const net = x402SignNetwork(networkId);
  if (!net) throw new Error("Unsupported network");
  const client = createPublicClient({
    chain: {id: net.chainId, name: net.label, nativeCurrency: {name: "ETH", symbol: "ETH", decimals: 18}, rpcUrls: {default: {http: []}}},
    transport: custom(window.ethereum!)
  });
  const receipt = await client.waitForTransactionReceipt({hash: txHash});
  return receipt.status;
}
