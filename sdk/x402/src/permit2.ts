// Task 5 — BotChain via Meridian. Hand-rolled Permit2 `PermitWitnessTransferFrom`
// EIP-712 typed data, so buyers can sign with any viem/wagmi wallet without the
// legacy `@uniswap/permit2-sdk` (ethers-v5-era) dependency. The structure is the
// canonical Permit2 witness-transfer shape; the witness is Meridian's `{to,
// validAfter}` binding for the exact scheme.
//
// This is pure data assembly — no network, no signing. Feed the returned
// `domain`/`types`/`message` straight into wallet.signTypedData({...,
// primaryType: "PermitWitnessTransferFrom"}). Nexora emits the requirements and
// relays the resulting payload to Meridian; the buyer signs locally.

import {PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, type MeridianPermit2Network} from "./types.js";

export type Permit2WitnessInput = {
  // ERC-20 token the buyer pays with (paymentRequirements.asset).
  token: string;
  // Amount in token base units (paymentRequirements.maxAmountRequired).
  amount: string;
  // Meridian facilitator address (paymentRequirements.payTo === witness.to).
  facilitator: string;
  // EVM chain id for the EIP-712 domain (must match the network).
  chainId: number;
  // Random 256-bit Permit2 nonce as a decimal string (replay protection).
  nonce: string;
  // Unix-seconds deadline as a decimal string.
  deadline: string;
  // Permit2 spender: the x402 exact proxy. Defaults to the canonical address.
  spender?: string;
};

// EIP-712 type set for a Permit2 witness transfer with Meridian's exact-scheme
// witness. Matches what the facilitator verifies on-chain.
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

export type Permit2TypedData = {
  domain: {name: "Permit2"; chainId: number; verifyingContract: string};
  types: typeof PERMIT2_WITNESS_TYPES;
  primaryType: "PermitWitnessTransferFrom";
  message: {
    permitted: {token: string; amount: string};
    spender: string;
    nonce: string;
    deadline: string;
    witness: {to: string; validAfter: string};
  };
};

// Build the EIP-712 typed data a buyer signs for a Meridian exact-scheme payment.
// The verifying contract is Permit2 (not the token, not the proxy); the signed
// spender is the x402 exact proxy; the witness destination is the facilitator.
export function buildPermit2WitnessTypedData(input: Permit2WitnessInput): Permit2TypedData {
  return {
    domain: {
      name: "Permit2",
      chainId: input.chainId,
      verifyingContract: PERMIT2_ADDRESS
    },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: {token: input.token, amount: input.amount},
      spender: input.spender ?? X402_EXACT_PERMIT2_PROXY,
      nonce: input.nonce,
      deadline: input.deadline,
      witness: {to: input.facilitator, validAfter: "0"}
    }
  };
}

// Assemble the payload Nexora relays to Meridian's settle API from a signature
// and the inputs used to build the typed data. `owner` is the signer address.
export function buildMeridianPermit2Payload(input: {
  network: MeridianPermit2Network;
  signature: string;
  owner: string;
  token: string;
  amount: string;
  facilitator: string;
  nonce: string;
  deadline: string;
}) {
  return {
    x402Version: 1 as const,
    scheme: "exact" as const,
    network: input.network,
    payload: {
      signature: input.signature,
      owner: input.owner,
      permit: {
        permitted: {token: input.token, amount: input.amount},
        nonce: input.nonce,
        deadline: input.deadline
      },
      witness: {
        to: input.facilitator,
        validAfter: "0"
      }
    }
  };
}

// Cryptographically-random 256-bit Permit2 nonce as a decimal string. Uses Web
// Crypto (available in browsers and modern Node). Non-sequential by design —
// Permit2 tracks used nonces in a bitmap, so randomness avoids collisions.
export function randomPermit2Nonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value.toString();
}
