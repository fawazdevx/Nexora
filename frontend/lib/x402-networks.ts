// Task 6 — EIP-3009 self-facilitation networks for the x402 playground signer.
// Mirrors the backend supportedNetworks map in protocol-facilitator.ts. The
// domain name/version are token-specific and were read on-chain from each
// deployed USDC: base-sepolia signs as "USDC", but arbitrum-sepolia and both
// mainnets sign as "USD Coin". A wrong domain makes every signature fail
// verification, so these values must stay in sync with the backend.

import type {Address} from "viem";

export type X402SignNetwork = {
  // x402 network id sent in paymentRequirements.network (must match backend).
  id: string;
  label: string;
  chainId: number;
  usdc: Address;
  domainName: string;
  domainVersion: string;
  // NexoraX402Settlement contract on this chain, if deployed. When set, raw x402
  // can settle through it (fee split to treasury, payer submits, Nexora pays no
  // gas). Empty = no settlement contract yet on this chain.
  settlementContract?: Address;
  // Whether this network is exposed in the UI. Testnets on by default; mainnets
  // gated so we don't surface real-money chains before they're funded/tested.
  enabledEnv?: string;
  testnet: boolean;
};

const asAddress = (value: string | undefined): Address | undefined =>
  value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as Address) : undefined;

// Reads the same VITE_* addresses the rest of the frontend already uses, with
// canonical fallbacks. Only testnets are surfaced by default.
export const x402SignNetworks: X402SignNetwork[] = [
  {
    id: "arc-testnet",
    label: "Arc Testnet",
    chainId: Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002),
    usdc: (import.meta.env.VITE_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address,
    domainName: "USDC",
    domainVersion: "2",
    settlementContract: asAddress(import.meta.env.VITE_ARC_X402_SETTLEMENT_ADDRESS),
    testnet: true
  },
  {
    id: "base-sepolia",
    label: "Base Sepolia",
    chainId: Number(import.meta.env.VITE_BASE_SEPOLIA_CHAIN_ID ?? 84532),
    usdc: (import.meta.env.VITE_BASE_SEPOLIA_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address,
    domainName: "USDC",
    domainVersion: "2",
    settlementContract: asAddress(import.meta.env.VITE_BASE_SEPOLIA_X402_SETTLEMENT_ADDRESS),
    testnet: true
  },
  {
    id: "arbitrum-sepolia",
    label: "Arbitrum Sepolia",
    chainId: Number(import.meta.env.VITE_ARB_SEPOLIA_CHAIN_ID ?? 421614),
    usdc: (import.meta.env.VITE_ARB_SEPOLIA_USDC_ADDRESS ?? "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d") as Address,
    domainName: "USD Coin",
    domainVersion: "2",
    settlementContract: asAddress(import.meta.env.VITE_ARB_SEPOLIA_X402_SETTLEMENT_ADDRESS),
    testnet: true
  }
];

// The networks to show in the selector: Arc always, plus any enabled via env.
export function enabledX402SignNetworks(): X402SignNetwork[] {
  return x402SignNetworks.filter(
    (net) => !net.enabledEnv || import.meta.env[net.enabledEnv as keyof ImportMetaEnv] === "true"
  );
}

export function x402SignNetwork(id: string): X402SignNetwork | undefined {
  return x402SignNetworks.find((net) => net.id === id);
}
