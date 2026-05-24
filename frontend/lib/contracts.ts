import {createPublicClient, createWalletClient, custom, formatUnits, http, keccak256, parseUnits, stringToHex, type Address, type Hash} from "viem";
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
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "operator", type: "address"},
      {name: "arcNameHash", type: "bytes32"}
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

export const nexoraEscrowAbi = [
  {
    type: "function",
    name: "createEscrow",
    stateMutability: "nonpayable",
    inputs: [
      {name: "counterparty", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "performanceBond", type: "uint256"},
      {name: "platformFeeBps", type: "uint16"},
      {name: "title", type: "string"},
      {name: "description", type: "string"}
    ],
    outputs: [{name: "escrowId", type: "uint256"}]
  },
  {
    type: "function",
    name: "fundEscrow",
    stateMutability: "nonpayable",
    inputs: [{name: "escrowId", type: "uint256"}],
    outputs: []
  },
  {
    type: "function",
    name: "submitDeliverable",
    stateMutability: "nonpayable",
    inputs: [
      {name: "escrowId", type: "uint256"},
      {name: "deliverableUrl", type: "string"}
    ],
    outputs: []
  },
  {
    type: "function",
    name: "verifyDeliverable",
    stateMutability: "nonpayable",
    inputs: [
      {name: "escrowId", type: "uint256"},
      {name: "verifierNotes", type: "string"}
    ],
    outputs: []
  },
  {
    type: "function",
    name: "releaseEscrow",
    stateMutability: "nonpayable",
    inputs: [{name: "escrowId", type: "uint256"}],
    outputs: []
  },
  {
    type: "function",
    name: "nextEscrowId",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "uint256"}]
  },
  {
    type: "function",
    name: "escrows",
    stateMutability: "view",
    inputs: [{name: "", type: "uint256"}],
    outputs: [
      {name: "creator", type: "address"},
      {name: "counterparty", type: "address"},
      {name: "amount", type: "uint256"},
      {name: "performanceBond", type: "uint256"},
      {name: "platformFeeBps", type: "uint16"},
      {name: "platformFee", type: "uint256"},
      {name: "counterpartyNet", type: "uint256"},
      {name: "status", type: "uint8"},
      {name: "title", type: "string"},
      {name: "description", type: "string"},
      {name: "deliverableUrl", type: "string"},
      {name: "verifierNotes", type: "string"}
    ]
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
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{name: "shares", type: "uint256"}]
  },
  {
    type: "function",
    name: "previewWithdraw",
    stateMutability: "view",
    inputs: [{name: "shares", type: "uint256"}],
    outputs: [
      {name: "assets", type: "uint256"},
      {name: "fee", type: "uint256"}
    ]
  },
  {
    type: "function",
    name: "previewWithdrawFor",
    stateMutability: "view",
    inputs: [
      {name: "user", type: "address"},
      {name: "shares", type: "uint256"}
    ],
    outputs: [
      {name: "assets", type: "uint256"},
      {name: "fee", type: "uint256"}
    ]
  },
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{name: "assets", type: "uint256"}],
    outputs: [{name: "shares", type: "uint256"}]
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      {name: "user", type: "address", indexed: true},
      {name: "assets", type: "uint256", indexed: false},
      {name: "shares", type: "uint256", indexed: false}
    ]
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      {name: "user", type: "address", indexed: true},
      {name: "assets", type: "uint256", indexed: false},
      {name: "fee", type: "uint256", indexed: false},
      {name: "shares", type: "uint256", indexed: false}
    ]
  },
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "assets", type: "uint256"}]
  },
  {
    type: "function",
    name: "totalShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "shares", type: "uint256"}]
  }
] as const;

export const xylonet = {
  router: "0x73742278c31a76dBb0D2587d03ef92E6E2141023",
  vault: "0x240Eb85458CD41361bd8C3773253a1D78054f747",
  usdcEurcPool: "0x3DF3966F5138143dce7a9cFDdC2c0310ce083BB1",
  usdcUsycPool: "0x8296cC7477A9CD12cF632042fDDc2aB89151bb61",
  eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  usyc: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C"
} as const;

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
  operatorAddress: string;
  arcName?: string | null;
  dailyLimitUsdc: string;
  transactionCapUsdc: string;
  contractAllowlist?: string[];
  recipientAllowlist?: string[];
  active: boolean;
}): Promise<Hash> {
  const client = await walletClient();
  const address = requireAddress(import.meta.env.VITE_POLICY_REGISTRY_ADDRESS, "Policy registry address");
  const arcNameHash = keccak256(stringToHex(input.arcName?.trim() || input.operatorAddress));

  await client.writeContract({
    address,
    abi: policyRegistryAbi,
    functionName: "registerAgent",
    args: [input.agentWallet as Address, input.operatorAddress as Address, arcNameHash]
  });

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

export async function createOnchainEscrow(input: {
  counterparty: string;
  amountUsdc: string;
  performanceBondUsdc: string;
  platformFeeBps: number;
  title: string;
  description: string;
}) {
  const client = await walletClient();
  const escrow = requireAddress(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS, "Nexora escrow address");
  const nextEscrowId = await publicClient().readContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "nextEscrowId"
  });
  const txHash = await client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "createEscrow",
    args: [
      input.counterparty as Address,
      parseUnits(input.amountUsdc || "0", 6),
      parseUnits(input.performanceBondUsdc || "0", 6),
      input.platformFeeBps,
      input.title,
      input.description
    ]
  });
  return {txHash, chainEscrowId: Number(nextEscrowId)};
}

export async function fundOnchainEscrow(escrowId: string, amountUsdc: number, performanceBondUsdc: number) {
  const client = await walletClient();
  const usdc = requireAddress(import.meta.env.VITE_USDC_ADDRESS, "USDC address");
  const escrow = requireAddress(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS, "Nexora escrow address");
  const amount = parseUnits(String(amountUsdc + performanceBondUsdc), 6);
  const approveHash = await client.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrow, amount]
  });
  const fundHash = await client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "fundEscrow",
    args: [BigInt(escrowId)]
  });
  return {approveHash, fundHash};
}

export async function submitOnchainEscrow(escrowId: string, deliverableUrl: string) {
  const client = await walletClient();
  const escrow = requireAddress(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS, "Nexora escrow address");
  return client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "submitDeliverable",
    args: [BigInt(escrowId), deliverableUrl]
  });
}

export async function readOnchainEscrow(escrowId: string) {
  const escrow = requireAddress(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS, "Nexora escrow address");
  const data = await publicClient().readContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "escrows",
    args: [BigInt(escrowId)]
  });
  const [
    creator,
    counterparty,
    amount,
    performanceBond,
    platformFeeBps,
    platformFee,
    counterpartyNet,
    status,
    title,
    description,
    deliverableUrl,
    verifierNotes
  ] = data;
  return {
    creator,
    counterparty,
    amount,
    performanceBond,
    platformFeeBps,
    platformFee,
    counterpartyNet,
    status,
    title,
    description,
    deliverableUrl,
    verifierNotes
  };
}

export async function verifyOnchainEscrow(escrowId: string, verifierNotes: string) {
  const client = await walletClient();
  const escrow = requireAddress(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS, "Nexora escrow address");
  return client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "verifyDeliverable",
    args: [BigInt(escrowId), verifierNotes]
  });
}

export async function releaseOnchainEscrow(escrowId: string) {
  const client = await walletClient();
  const escrow = requireAddress(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS, "Nexora escrow address");
  return client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "releaseEscrow",
    args: [BigInt(escrowId)]
  });
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

export async function withdrawSaveEarn(amountUsdc: string): Promise<Hash> {
  const client = await walletClient();
  const vault = requireAddress(import.meta.env.VITE_SAVE_EARN_VAULT_ADDRESS, "Save/Earn vault address");

  return client.writeContract({
    address: vault,
    abi: saveEarnVaultAbi,
    functionName: "withdraw",
    args: [await sharesForWithdrawalAmount(amountUsdc)]
  });
}

export async function readSaveEarnPosition(account: string) {
  const vault = requireAddress(import.meta.env.VITE_SAVE_EARN_VAULT_ADDRESS, "Save/Earn vault address");
  const client = publicClient();
  const fromBlock = BigInt(Number(import.meta.env.VITE_SAVE_EARN_DEPLOY_BLOCK ?? 42_490_737));
  const [shares, totalShares, totalAssets] = await Promise.all([
    client.readContract({
      address: vault,
      abi: saveEarnVaultAbi,
      functionName: "balanceOf",
      args: [account as Address]
    }),
    client.readContract({
      address: vault,
      abi: saveEarnVaultAbi,
      functionName: "totalShares"
    }),
    client.readContract({
      address: vault,
      abi: saveEarnVaultAbi,
      functionName: "totalAssets"
    })
  ]);
  const [assets, fee] = shares > 0n
    ? await client.readContract({
        address: vault,
        abi: saveEarnVaultAbi,
        functionName: "previewWithdrawFor",
        args: [account as Address, shares]
      })
    : [0n, 0n];

  const eventTotals = await readSaveEarnEventTotals(account, vault, fromBlock).catch(() => null);
  const netDepositedRaw = eventTotals
    ? eventTotals.deposited > eventTotals.withdrawn
      ? eventTotals.deposited - eventTotals.withdrawn
      : 0n
    : shares;
  const estimatedEarningsRaw = assets > netDepositedRaw ? assets - netDepositedRaw : 0n;

  return {
    sharesRaw: shares,
    shares: formatUnits(shares, 6),
    deposited: formatUnits(netDepositedRaw, 6),
    currentAssets: formatUnits(assets, 6),
    withdrawalFee: formatUnits(fee, 6),
    withdrawableAssets: formatUnits(assets - fee, 6),
    estimatedEarnings: formatUnits(estimatedEarningsRaw, 6),
    totalAssets: formatUnits(totalAssets, 6),
    totalShares: formatUnits(totalShares, 6)
  };
}

async function readSaveEarnEventTotals(account: string, vault: Address, fromBlock: bigint) {
  const client = publicClient();
  const [depositLogs, withdrawLogs] = await Promise.all([
    client.getContractEvents({
      address: vault,
      abi: saveEarnVaultAbi,
      eventName: "Deposited",
      args: {user: account as Address},
      fromBlock
    }),
    client.getContractEvents({
      address: vault,
      abi: saveEarnVaultAbi,
      eventName: "Withdrawn",
      args: {user: account as Address},
      fromBlock
    })
  ]);

  return {
    deposited: depositLogs.reduce((sum, log) => sum + (log.args.assets ?? 0n), 0n),
    withdrawn: withdrawLogs.reduce((sum, log) => sum + (log.args.assets ?? 0n) + (log.args.fee ?? 0n), 0n)
  };
}

async function sharesForWithdrawalAmount(amountUsdc: string) {
  const vault = requireAddress(import.meta.env.VITE_SAVE_EARN_VAULT_ADDRESS, "Save/Earn vault address");
  const client = publicClient();
  const assets = parseUnits(amountUsdc || "0", 6);
  const [totalShares, totalAssets] = await Promise.all([
    client.readContract({
      address: vault,
      abi: saveEarnVaultAbi,
      functionName: "totalShares"
    }),
    client.readContract({
      address: vault,
      abi: saveEarnVaultAbi,
      functionName: "totalAssets"
    })
  ]);

  if (assets === 0n || totalAssets === 0n || totalShares === 0n) return assets;
  return (assets * totalShares + totalAssets - 1n) / totalAssets;
}
