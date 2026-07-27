// Task 7 — Nexora-owned x402 settlement contract. Hand-rolled EIP-3009
// `ReceiveWithAuthorization` typed data + the nonce-binding helper, so buyers can
// sign with any viem/wagmi wallet. Pure data assembly — no network, no signing.
//
// The buyer signs a receiveWithAuthorization naming the settlement CONTRACT as
// the recipient. The seller + fee ceiling are folded into the signed nonce so a
// relayer cannot redirect funds or exceed the agreed fee. Feed the returned
// domain/types/message into wallet.signTypedData({..., primaryType:
// "ReceiveWithAuthorization"}); then anyone (payer/seller) submits the
// contract's settle() with the same seller/maxFeeBps/salt.

// EIP-712 type for USDC receiveWithAuthorization (FiatTokenV2).
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    {name: "from", type: "address"},
    {name: "to", type: "address"},
    {name: "value", type: "uint256"},
    {name: "validAfter", type: "uint256"},
    {name: "validBefore", type: "uint256"},
    {name: "nonce", type: "bytes32"}
  ]
} as const;

export type ReceiveAuthorizationInput = {
  // Payer (authorization signer).
  from: string;
  // Settlement CONTRACT address (paymentRequirements.payTo). The signed `to`.
  settlementContract: string;
  // Gross USDC amount in base units (paymentRequirements.maxAmountRequired).
  value: string;
  // Bound nonce from bindSettlementNonce / paymentRequirements.extra.nonce.
  nonce: string;
  validAfter: string;
  validBefore: string;
  // USDC EIP-712 domain — per-token (Circle uses "USDC" on some chains,
  // "USD Coin" on others). Comes from paymentRequirements.extra.name/version.
  chainId: number;
  usdc: string;
  domainName: string;
  domainVersion: string;
};

export type ReceiveAuthorizationTypedData = {
  domain: {name: string; version: string; chainId: number; verifyingContract: string};
  types: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
  primaryType: "ReceiveWithAuthorization";
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

// Build the EIP-712 typed data a buyer signs for a settlement-contract payment.
export function buildReceiveAuthorizationTypedData(input: ReceiveAuthorizationInput): ReceiveAuthorizationTypedData {
  return {
    domain: {
      name: input.domainName,
      version: input.domainVersion,
      chainId: input.chainId,
      verifyingContract: input.usdc
    },
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: input.from,
      to: input.settlementContract,
      value: input.value,
      validAfter: input.validAfter,
      validBefore: input.validBefore,
      nonce: input.nonce
    }
  };
}

// The nonce the payer must sign, binding the settlement terms. MUST match
// NexoraX402Settlement.expectedNonce and the backend's expectedSettlementNonce:
// keccak256(abi.encode(address seller, uint16 maxFeeBps, bytes32 salt)).
//
// `keccak256`/`encodeAbiParameters` are passed in by the caller (from viem) so
// this module stays dependency-free like the rest of the SDK.
export function bindSettlementNonce(
  input: {seller: string; maxFeeBps: number; salt: string},
  crypto: {
    keccak256: (hex: `0x${string}`) => `0x${string}`;
    encodeAbiParameters: (
      params: readonly {type: string}[],
      values: readonly unknown[]
    ) => `0x${string}`;
  }
): `0x${string}` {
  return crypto.keccak256(
    crypto.encodeAbiParameters(
      [{type: "address"}, {type: "uint16"}, {type: "bytes32"}],
      [input.seller, input.maxFeeBps, input.salt]
    )
  );
}

// Cryptographically-random 32-byte salt as a 0x hex string.
export function randomSettlementSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}
