import {createPublicClient, http, isAddress, keccak256, encodeAbiParameters, parseAbi, parseEventLogs, type Address, type Hex} from "viem";
import {config} from "../config.js";

// Nexora-owned x402 settlement contract (NexoraX402Settlement) integration.
//
// This is the fee-collecting path for RAW x402 payments (resources that are not
// Nexora marketplace services). It mirrors what Meridian does on BotChain, but
// with Nexora's own contract on Arc/Base/Arbitrum:
//   - paymentRequirements.payTo = the settlement CONTRACT (not the seller)
//   - the payer signs an EIP-3009 receiveWithAuthorization to the contract
//   - the payer/seller/relayer submits settle(); the contract splits feeBps to
//     treasury and forwards the rest to the seller
//   - Nexora never submits the tx, so it pays no gas and still earns the fee
//
// The seller + fee ceiling are bound into the signed nonce so a relayer cannot
// redirect funds or exceed the agreed fee (see expectedSettlementNonce).

export const settlementCompletedAbi = parseAbi([
  "event SettlementCompleted(bytes32 indexed nonce,address indexed payer,address indexed seller,uint256 grossAmount,uint256 platformFee)"
]);
const settlementConfigAbi = parseAbi(["function feeBps() view returns (uint16)"]);

type SettlementNetwork = {
  network: string;
  chainId: number;
  rpcUrl: string;
  usdc: string;
  label: string;
  domainName: string;
  domainVersion: string;
  contract: string;
};

// Resolve the settlement-contract context for an x402 network id, or null when
// no settlement contract is configured for that chain (caller falls back to the
// legacy EOA path). Chain/RPC/USDC/domain mirror protocol-facilitator's map.
export function settlementNetwork(network: string): SettlementNetwork | null {
  const s = config.x402Settlement;
  switch (network) {
    case "arc-testnet":
    case "arc":
      return maybe({network, chainId: config.arc.chainId, rpcUrl: config.arc.rpcUrl, usdc: config.contracts.usdc, label: "Arc Testnet", domainName: "USDC", domainVersion: "2", contract: s.arcTestnet});
    case "base-sepolia":
      return maybe({network, chainId: config.base.sepoliaChainId, rpcUrl: config.base.sepoliaRpcUrl, usdc: config.base.sepoliaUsdc, label: "Base Sepolia", domainName: "USDC", domainVersion: "2", contract: s.baseSepolia});
    case "base":
      return maybe({network, chainId: config.base.mainnetChainId, rpcUrl: config.base.mainnetRpcUrl, usdc: config.base.mainnetUsdc, label: "Base", domainName: "USD Coin", domainVersion: "2", contract: s.baseMainnet});
    case "arbitrum-sepolia":
      return maybe({network, chainId: config.arbitrum.sepoliaChainId, rpcUrl: config.arbitrum.sepoliaRpcUrl, usdc: config.arbitrum.sepoliaUsdc, label: "Arbitrum Sepolia", domainName: "USD Coin", domainVersion: "2", contract: s.arbitrumSepolia});
    case "arbitrum":
      return maybe({network, chainId: config.arbitrum.oneChainId, rpcUrl: config.arbitrum.oneRpcUrl, usdc: config.arbitrum.oneUsdc, label: "Arbitrum One", domainName: "USD Coin", domainVersion: "2", contract: s.arbitrumOne});
    default:
      return null;
  }
}

// Only a network with a configured, valid contract + asset counts as enabled.
function maybe(entry: SettlementNetwork): SettlementNetwork | null {
  return isAddress(entry.contract) && isAddress(entry.usdc) ? entry : null;
}

export function settlementConfigured(network: string): boolean {
  return settlementNetwork(network) !== null;
}

// The nonce the payer must sign, binding the seller + fee ceiling into the
// otherwise-free EIP-3009 nonce. MUST match NexoraX402Settlement.expectedNonce
// exactly: keccak256(abi.encode(address seller, uint16 maxFeeBps, bytes32 salt)).
export function expectedSettlementNonce(seller: string, maxFeeBps: number, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{type: "address"}, {type: "uint16"}, {type: "bytes32"}],
      [seller as Address, maxFeeBps, salt]
    )
  );
}

export type SettlementRequirements = {
  scheme: "exact";
  network: string;
  asset: string;
  // payTo is the settlement CONTRACT — the EIP-3009 receiveWithAuthorization
  // recipient — not the seller. The seller is carried in `extra` and bound into
  // the nonce, so funds can only reach the seller via the contract's split.
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    settlement: "nexora-x402-settlement";
    seller: string;
    maxFeeBps: number;
    salt: Hex;
    nonce: Hex;
  };
};

// Build seller-side requirements for a settlement-contract payment. Callers pass
// the true seller and a random salt; we compute the bound nonce the payer signs.
export async function buildSettlementRequirements(input: {
  network: string;
  amountBaseUnits: string;
  resource: string;
  seller: string;
  salt: Hex;
  maxFeeBps?: number;
  description?: string;
  maxTimeoutSeconds?: number;
}, options: {
  feeBpsReader?: (network: SettlementNetwork) => Promise<number>;
} = {}): Promise<SettlementRequirements> {
  const net = settlementNetwork(input.network);
  if (!net) throw new Error(`x402 settlement contract is not configured for ${input.network}`);
  if (!isAddress(input.seller)) throw new Error("seller address is invalid");
  if (!/^\d+$/.test(input.amountBaseUnits) || input.amountBaseUnits === "0") {
    throw new Error("amountBaseUnits must be a positive integer string");
  }
  // Read the contract immediately before issuing requirements. A frontend or
  // environment default can become stale after an owner fee update and would
  // make an otherwise-valid authorization revert with FeeExceedsMax.
  const currentFeeBps = await currentSettlementFeeBps(net, options.feeBpsReader);
  const maxFeeBps = input.maxFeeBps ?? currentFeeBps;
  if (!Number.isInteger(maxFeeBps) || maxFeeBps < 0 || maxFeeBps > 1_000) {
    throw new Error("maxFeeBps must be an integer between 0 and 1000");
  }
  if (maxFeeBps < currentFeeBps) throw new Error("maxFeeBps is below the current facilitator fee");
  return {
    scheme: "exact",
    network: net.network,
    asset: net.usdc,
    payTo: net.contract,
    maxAmountRequired: input.amountBaseUnits,
    resource: input.resource,
    description: input.description ?? "Nexora x402 settlement",
    mimeType: "application/json",
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 300,
    extra: {
      name: net.domainName,
      version: net.domainVersion,
      settlement: "nexora-x402-settlement",
      seller: input.seller,
      maxFeeBps,
      salt: input.salt,
      nonce: expectedSettlementNonce(input.seller, maxFeeBps, input.salt)
    }
  };
}

async function currentSettlementFeeBps(
  net: SettlementNetwork,
  reader?: (network: SettlementNetwork) => Promise<number>
) {
  try {
    const value = reader
      ? await reader(net)
      : await createPublicClient({
          chain: {
            id: net.chainId,
            name: net.label,
            nativeCurrency: {name: "ETH", symbol: "ETH", decimals: 18},
            rpcUrls: {default: {http: [net.rpcUrl]}}
          },
          transport: http(net.rpcUrl)
        }).readContract({
          address: net.contract as Address,
          abi: settlementConfigAbi,
          functionName: "feeBps"
        });
    const feeBps = Number(value);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1_000) throw new Error("invalid fee");
    return feeBps;
  } catch {
    const error = new Error("The current x402 settlement fee could not be confirmed. Please try again shortly.");
    (error as Error & {status?: number}).status = 503;
    throw error;
  }
}

export type SettlementVerification = {
  verified: boolean;
  reason?: string;
  payer?: string;
  seller?: string;
  grossAmountUsdc?: number;
  platformFeeUsdc?: number;
  txHash?: string;
};

type PublicClientLike = {
  getTransactionReceipt(args: {hash: `0x${string}`}): Promise<{status: "success" | "reverted"; logs: unknown[]}>;
};

// Verify a settlement happened on-chain by reading the SettlementCompleted event
// from the settlement contract for the given tx. This is how the backend records
// a settlement it did NOT submit (the payer/seller broadcast it), so it must
// trust the chain, not the caller. `clientFactory` is injectable for tests.
export async function verifySettlementTx(
  input: {
    network: string;
    txHash: string;
    expectedNonce: Hex;
    seller: string;
  },
  options: {clientFactory?: (net: SettlementNetwork) => PublicClientLike} = {}
): Promise<SettlementVerification> {
  const net = settlementNetwork(input.network);
  if (!net) return {verified: false, reason: `x402 settlement contract is not configured for ${input.network}`};
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) return {verified: false, reason: "invalid settlement transaction hash"};

  const client = options.clientFactory
    ? options.clientFactory(net)
    : (createPublicClient({
        chain: {id: net.chainId, name: net.label, nativeCurrency: {name: "ETH", symbol: "ETH", decimals: 18}, rpcUrls: {default: {http: [net.rpcUrl]}}},
        transport: http(net.rpcUrl)
      }) as unknown as PublicClientLike);

  let receipt: Awaited<ReturnType<PublicClientLike["getTransactionReceipt"]>>;
  try {
    receipt = await client.getTransactionReceipt({hash: input.txHash as `0x${string}`});
  } catch {
    return {verified: false, reason: "settlement transaction not found or RPC unavailable"};
  }
  if (receipt.status !== "success") return {verified: false, reason: "settlement transaction reverted"};

  const events = parseEventLogs({abi: settlementCompletedAbi, logs: receipt.logs as never})
    .filter((log) => log.address.toLowerCase() === net.contract.toLowerCase());
  const match = events.find((log) => (log.args.nonce as string).toLowerCase() === input.expectedNonce.toLowerCase());
  if (!match) return {verified: false, reason: "SettlementCompleted event not found for this authorization"};
  if ((match.args.seller as string).toLowerCase() !== input.seller.toLowerCase()) {
    return {verified: false, reason: "settlement seller mismatch"};
  }

  return {
    verified: true,
    payer: match.args.payer as string,
    seller: match.args.seller as string,
    grossAmountUsdc: Number(match.args.grossAmount) / 1_000_000,
    platformFeeUsdc: Number(match.args.platformFee) / 1_000_000,
    txHash: input.txHash
  };
}
