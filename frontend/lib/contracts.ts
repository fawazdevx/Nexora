import {createPublicClient, createWalletClient, custom, http, parseUnits, type Address, type Hash} from "viem";
import {arcTestnet} from "@/lib/arc";

const arcChain = {
  id: arcTestnet.id,
  name: arcTestnet.name,
  nativeCurrency: arcTestnet.nativeCurrency,
  rpcUrls: {
    default: {http: [arcTestnet.rpcUrl]}
  },
  blockExplorers: {
    default: {name: "Arc Explorer", url: arcTestnet.explorerUrl}
  }
} as const;

export const policyRegistryAbi = [
  {
    type: "function",
    name: "setPolicy",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "dailyLimit", type: "uint256"},
      {name: "transactionCap", type: "uint256"},
      {name: "contractAllowlistEnabled", type: "bool"},
      {name: "recipientAllowlistEnabled", type: "bool"},
      {name: "active", type: "bool"}
    ],
    outputs: []
  },
  {
    type: "function",
    name: "setAllowedContract",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "target", type: "address"},
      {name: "allowed", type: "bool"}
    ],
    outputs: []
  },
  {
    type: "function",
    name: "setAllowedRecipient",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "recipient", type: "address"},
      {name: "allowed", type: "bool"}
    ],
    outputs: []
  }
] as const;

export const x402LedgerAbi = [
  {
    type: "function",
    name: "nextServiceId",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "uint256"}]
  },
  {
    type: "function",
    name: "publishService",
    stateMutability: "nonpayable",
    inputs: [
      {name: "endpointHash", type: "string"},
      {name: "pricePerUnit", type: "uint256"}
    ],
    outputs: [{name: "serviceId", type: "uint256"}]
  },
  {
    type: "function",
    name: "settleRequest",
    stateMutability: "nonpayable",
    inputs: [
      {name: "serviceId", type: "uint256"},
      {name: "requestHash", type: "bytes32"},
      {name: "payer", type: "address"},
      {name: "units", type: "uint256"}
    ],
    outputs: [{name: "grossAmount", type: "uint256"}]
  }
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "spender", type: "address"},
      {name: "amount", type: "uint256"}
    ],
    outputs: [{type: "bool"}]
  }
] as const;

export const saveEarnVaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{name: "assets", type: "uint256"}],
    outputs: [{name: "shares", type: "uint256"}]
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{name: "shares", type: "uint256"}],
    outputs: [{name: "assetsAfterFee", type: "uint256"}]
  }
] as const;

function requireAddress(value: string | undefined, label: string): Address {
  if (!value || !value.startsWith("0x")) {
    throw new Error(`${label} is not configured`);
  }
  return value as Address;
}

async function walletClient() {
  if (!window.ethereum) throw new Error("No injected wallet found");
  const [account] = await window.ethereum.request<string[]>({method: "eth_requestAccounts"});
  if (!account) throw new Error("Wallet connection rejected");

  return createWalletClient({
    account: account as Address,
    chain: arcChain,
    transport: custom(window.ethereum)
  });
}

function publicClient() {
  return createPublicClient({
    chain: arcChain,
    transport: http(arcTestnet.rpcUrl)
  });
}

export async function writeAgentPolicy(input: {
  agentWallet: string;
  dailyLimitUsdc: string;
  transactionCapUsdc: string;
  contractAllowlist?: string[];
  recipientAllowlist?: string[];
  active: boolean;
}): Promise<Hash> {
  const client = await walletClient();
  const address = requireAddress(import.meta.env.VITE_POLICY_REGISTRY_ADDRESS, "Policy registry address");

  const policyHash = await client.writeContract({
    address,
    abi: policyRegistryAbi,
    functionName: "setPolicy",
    args: [
      input.agentWallet as Address,
      parseUnits(input.dailyLimitUsdc || "0", 6),
      parseUnits(input.transactionCapUsdc || "0", 6),
      true,
      true,
      input.active
    ]
  });

  for (const target of input.contractAllowlist ?? []) {
    await client.writeContract({
      address,
      abi: policyRegistryAbi,
      functionName: "setAllowedContract",
      args: [input.agentWallet as Address, target as Address, true]
    });
  }

  for (const recipient of input.recipientAllowlist ?? []) {
    await client.writeContract({
      address,
      abi: policyRegistryAbi,
      functionName: "setAllowedRecipient",
      args: [input.agentWallet as Address, recipient as Address, true]
    });
  }

  return policyHash;
}

export async function publishX402Service(input: {endpointHash: string; pricePerUnitUsdc: string}): Promise<{txHash: Hash; chainServiceId: number}> {
  const client = await walletClient();
  const address = requireAddress(import.meta.env.VITE_X402_LEDGER_ADDRESS, "x402 ledger address");
  const chainServiceId = await publicClient().readContract({
    address,
    abi: x402LedgerAbi,
    functionName: "nextServiceId"
  });

  const txHash = await client.writeContract({
    address,
    abi: x402LedgerAbi,
    functionName: "publishService",
    args: [input.endpointHash, parseUnits(input.pricePerUnitUsdc || "0", 6)]
  });

  return {txHash, chainServiceId: Number(chainServiceId)};
}

export async function settleX402Request(input: {chainServiceId: number; requestHash: `0x${string}`; payer: string; units: number; amountUsdc: string}) {
  const client = await walletClient();
  const usdc = requireAddress(import.meta.env.VITE_USDC_ADDRESS, "USDC address");
  const ledger = requireAddress(import.meta.env.VITE_X402_LEDGER_ADDRESS, "x402 ledger address");
  const amount = parseUnits(input.amountUsdc || "0", 6);

  const approveHash = await client.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [ledger, amount]
  });

  const settleHash = await client.writeContract({
    address: ledger,
    abi: x402LedgerAbi,
    functionName: "settleRequest",
    args: [BigInt(input.chainServiceId), input.requestHash, input.payer as Address, BigInt(input.units)]
  });

  return {approveHash, settleHash};
}

export async function depositSaveEarn(amountUsdc: string): Promise<{approveHash: Hash; depositHash: Hash}> {
  const client = await walletClient();
  const usdc = requireAddress(import.meta.env.VITE_USDC_ADDRESS, "USDC address");
  const vault = requireAddress(import.meta.env.VITE_SAVE_EARN_VAULT_ADDRESS, "Save/Earn vault address");
  const amount = parseUnits(amountUsdc || "0", 6);

  const approveHash = await client.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [vault, amount]
  });

  const depositHash = await client.writeContract({
    address: vault,
    abi: saveEarnVaultAbi,
    functionName: "deposit",
    args: [amount]
  });

  return {approveHash, depositHash};
}

export async function withdrawSaveEarn(sharesUsdc: string): Promise<Hash> {
  const client = await walletClient();
  const vault = requireAddress(import.meta.env.VITE_SAVE_EARN_VAULT_ADDRESS, "Save/Earn vault address");

  return client.writeContract({
    address: vault,
    abi: saveEarnVaultAbi,
    functionName: "withdraw",
    args: [parseUnits(sharesUsdc || "0", 6)]
  });
}
