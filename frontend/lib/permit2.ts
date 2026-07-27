// Task 5 — BotChain via Meridian (frontend). Self-contained Permit2 witness
// typed-data assembly, mirroring sdk/x402/src/permit2.ts. Kept local to the
// frontend because it does not depend on the built SDK package; both share the
// same canonical Permit2 structure. No @uniswap/permit2-sdk (ethers-v5 era) —
// we sign with wagmi/viem signTypedData instead.

import type {Address, Hex} from "viem";

// Canonical Permit2 contracts (same address on every supported EVM chain).
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const;

// Max uint256 — the standard one-time Permit2 approval amount. Permit2 itself
// enforces per-payment limits via the signed permit, so a max ERC-20 approval to
// Permit2 is the conventional, gas-saving pattern (approve once, sign per pay).
export const MAX_UINT256 = 2n ** 256n - 1n;

// Minimal ERC-20 ABI for the one-time Permit2 allowance check + approval.
export const permit2Erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {name: "owner", type: "address"},
      {name: "spender", type: "address"}
    ],
    outputs: [{name: "", type: "uint256"}]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "spender", type: "address"},
      {name: "amount", type: "uint256"}
    ],
    outputs: [{name: "", type: "bool"}]
  }
] as const;

// BotChain testnet Meridian constants (verified from docs.mrdn.finance).
// Overridable via env so a redeploy or mainnet flip does not require a code change.
export const botchainMeridian = {
  network: (import.meta.env.VITE_BOTCHAIN_MERIDIAN_NETWORK ?? "bot-chain-testnet") as
    | "bot-chain-testnet"
    | "bot-chain",
  chainId: Number(import.meta.env.VITE_BOTCHAIN_TESTNET_CHAIN_ID ?? 968),
  usdt: (import.meta.env.VITE_BOTCHAIN_TESTNET_USDT_ADDRESS ??
    "0x75edC9335175Fc0552D51D48439F229c10420fe3") as Address,
  facilitator: (import.meta.env.VITE_MERIDIAN_TESTNET_FACILITATOR_ADDRESS ??
    "0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A") as Address,
  // Meridian's docs warn against assuming 6 decimals — overridable, confirm on-chain.
  usdtDecimals: Number(import.meta.env.VITE_BOTCHAIN_USDT_DECIMALS ?? 6)
} as const;

// EIP-712 type set for a Permit2 witness transfer with Meridian's exact witness.
export const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    {name: "permitted", type: "TokenPermissions"},
    {name: "spender", type: "address"},
    {name: "nonce", type: "uint256"},
    {name: "deadline", type: "uint256"},
    {name: "witness", type: "Witness"}
  ],
  TokenPermissions: [
    {name: "token", type: "address"},
    {name: "amount", type: "uint256"}
  ],
  Witness: [
    {name: "to", type: "address"},
    {name: "validAfter", type: "uint256"}
  ]
} as const;

export type Permit2WitnessInput = {
  token: Address;
  amount: bigint;
  facilitator: Address;
  chainId: number;
  nonce: bigint;
  deadline: bigint;
  spender?: Address;
};

// Build EIP-712 typed data for signTypedDataAsync. Verifying contract is Permit2,
// signed spender is the x402 exact proxy, witness destination is the facilitator.
export function buildPermit2WitnessTypedData(input: Permit2WitnessInput) {
  return {
    domain: {
      name: "Permit2",
      chainId: input.chainId,
      verifyingContract: PERMIT2_ADDRESS as Address
    },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: {token: input.token, amount: input.amount},
      spender: input.spender ?? X402_EXACT_PERMIT2_PROXY,
      nonce: input.nonce,
      deadline: input.deadline,
      witness: {to: input.facilitator, validAfter: 0n}
    }
  };
}

// Assemble the payload Nexora relays to Meridian from a signature + inputs.
export function buildMeridianPermit2Payload(input: {
  network: "bot-chain-testnet" | "bot-chain";
  signature: Hex;
  owner: Address;
  token: Address;
  amount: bigint;
  facilitator: Address;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    x402Version: 1 as const,
    scheme: "exact" as const,
    network: input.network,
    payload: {
      signature: input.signature,
      owner: input.owner,
      permit: {
        permitted: {token: input.token, amount: input.amount.toString()},
        nonce: input.nonce.toString(),
        deadline: input.deadline.toString()
      },
      witness: {to: input.facilitator, validAfter: "0"}
    }
  };
}

// Random 256-bit Permit2 nonce (non-sequential; Permit2 tracks used nonces in a
// bitmap, so randomness avoids collisions and gives replay protection).
export function randomPermit2Nonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

// Build the seller-side paymentRequirements the backend rebuilds and validates.
export function buildBotchainPaymentRequirements(input: {
  amount: bigint;
  resource: string;
  description?: string;
  maxTimeoutSeconds?: number;
}) {
  return {
    scheme: "exact" as const,
    network: botchainMeridian.network,
    asset: botchainMeridian.usdt,
    payTo: botchainMeridian.facilitator,
    maxAmountRequired: input.amount.toString(),
    resource: input.resource,
    description: input.description ?? "Nexora x402 paid service",
    mimeType: "application/json" as const,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 300,
    extra: {name: "USDT", version: "1"}
  };
}
