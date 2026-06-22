import {createPublicClient, createWalletClient, custom, encodeFunctionData, formatUnits, http, keccak256, parseEventLogs, parseUnits, stringToHex, type Address, type Hash} from "viem";
import {CurrencyAmount, Percent, Token, TradeType} from "@synthra-swap/sdk/core";
import {Pool, Route} from "@synthra-swap/sdk/v3";
import {SwapRouter as SynthraUniversalSwapRouter, Trade as SynthraUniversalTrade, UniswapTrade} from "@synthra-swap/sdk/universal-router";
import {arcTestnet, arbitrumOneWagmiChain, arbitrumSepoliaWagmiChain, baseSepoliaWagmiChain, supportedChains} from "@/lib/arc";
import {apiPost} from "@/lib/api";

export const policyRegistryAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{name: "", type: "address"}]
  },
  {
    type: "function",
    name: "agentProfiles",
    stateMutability: "view",
    inputs: [{name: "agentWallet", type: "address"}],
    outputs: [
      {name: "operator", type: "address"},
      {name: "arcNameHash", type: "bytes32"},
      {name: "active", type: "bool"}
    ]
  },
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
    name: "configureAgentPolicy",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "operator", type: "address"},
      {name: "arcNameHash", type: "bytes32"},
      {name: "dailyLimit", type: "uint256"},
      {name: "transactionCap", type: "uint256"},
      {name: "contractAllowlistEnabled", type: "bool"},
      {name: "recipientAllowlistEnabled", type: "bool"},
      {name: "active", type: "bool"},
      {name: "contractAllowlist", type: "address[]"},
      {name: "recipientAllowlist", type: "address[]"}
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
  },
  {
    type: "function",
    name: "setPolicyV2",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "weeklyLimit", type: "uint256"},
      {name: "monthlyLimit", type: "uint256"},
      {name: "maxUnitsPerRequest", type: "uint256"},
      {name: "cooldownSeconds", type: "uint256"},
      {name: "expiresAt", type: "uint64"},
      {name: "requireServiceAllowlist", type: "bool"},
      {name: "requireOnchainPolicy", type: "bool"}
    ],
    outputs: []
  },
  {
    type: "function",
    name: "setAllowedService",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentWallet", type: "address"},
      {name: "serviceId", type: "bytes32"},
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {name: "owner", type: "address"},
      {name: "spender", type: "address"}
    ],
    outputs: [{type: "uint256"}]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "spender", type: "address"},
      {name: "amount", type: "uint256"}
    ],
    outputs: [{type: "bool"}]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      {name: "to", type: "address"},
      {name: "amount", type: "uint256"}
    ],
    outputs: [{type: "bool"}]
  }
] as const;

export const gatewayWalletTestnetAddress = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address;
export const gatewayMinterTestnetAddress = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as Address;
export const arcMemoContractAddress = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as Address;

export type NexoraStructuredMemo = {
  protocol: "nexora.memo";
  version: "1.0";
  type: "nexora.x402.purchase";
  memoId: `0x${string}`;
  memoData: Record<string, unknown>;
  encoding: "json";
  arc: {
    memoContract: string;
    targetContract?: string | null;
    callDataHash?: string | null;
    memoIndex?: number | null;
  };
};

function publicMemoData(memo: NexoraStructuredMemo) {
  return {
    type: memo.type,
    serviceId: String(memo.memoData.serviceId ?? ""),
    requestHash: String(memo.memoData.requestHash ?? ""),
    budgetBucket: String(memo.memoData.budgetBucket ?? "general"),
    policy: {mode: String((memo.memoData.policy as {mode?: unknown} | undefined)?.mode ?? "auto")},
    privacy: {scope: String((memo.memoData.privacy as {scope?: unknown} | undefined)?.scope ?? "public")},
    intent: String(memo.memoData.intent ?? ""),
    createdAt: String(memo.memoData.createdAt ?? new Date().toISOString())
  };
}

export const arcMemoAbi = [
  {
    type: "function",
    name: "memo",
    stateMutability: "nonpayable",
    inputs: [
      {name: "target", type: "address"},
      {name: "data", type: "bytes"},
      {name: "memoId", type: "bytes32"},
      {name: "memoData", type: "bytes"}
    ],
    outputs: []
  },
  {
    type: "event",
    name: "Memo",
    anonymous: false,
    inputs: [
      {name: "sender", type: "address", indexed: true},
      {name: "target", type: "address", indexed: true},
      {name: "callDataHash", type: "bytes32", indexed: false},
      {name: "memoId", type: "bytes32", indexed: true},
      {name: "memo", type: "bytes", indexed: false},
      {name: "memoIndex", type: "uint256", indexed: false}
    ]
  }
] as const;

export const gatewayWalletAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      {name: "token", type: "address"},
      {name: "value", type: "uint256"}
    ],
    outputs: []
  }
] as const;

const permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const maxUint160 = (1n << 160n) - 1n;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {name: "owner", type: "address"},
      {name: "token", type: "address"},
      {name: "spender", type: "address"}
    ],
    outputs: [
      {name: "amount", type: "uint160"},
      {name: "expiration", type: "uint48"},
      {name: "nonce", type: "uint48"}
    ]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "token", type: "address"},
      {name: "spender", type: "address"},
      {name: "amount", type: "uint160"},
      {name: "expiration", type: "uint48"}
    ],
    outputs: []
  }
] as const;

export const xylonetRouterAbi = [
  {
    type: "function",
    name: "getAmountOut",
    stateMutability: "view",
    inputs: [
      {name: "pool", type: "address"},
      {name: "tokenIn", type: "address"},
      {name: "tokenOut", type: "address"},
      {name: "amountIn", type: "uint256"}
    ],
    outputs: [{name: "amountOut", type: "uint256"}]
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      {name: "pool", type: "address"},
      {name: "tokenIn", type: "address"},
      {name: "tokenOut", type: "address"},
      {name: "amountIn", type: "uint256"},
      {name: "minAmountOut", type: "uint256"},
      {name: "to", type: "address"},
      {name: "deadline", type: "uint256"}
    ],
    outputs: [{name: "amountOut", type: "uint256"}]
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

export const synthra = {
  universalRouter: "0xbf4479C07Dc6fdc6dAa764A0ccA06969e894275F",
  quoter: "0x3Ce954107b1A675826B33bF23060Dd655e3758fE",
  factory: "0x0fB6EEDA6e90E90797083861A75D15752a27f59c",
  usdcEurcFeeTiers: [500, 3000, 10000]
} as const;

export const xylonetSwapTokens = {
  USDC: {symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6},
  EURC: {symbol: "EURC", address: xylonet.eurc, decimals: 6},
  USYC: {symbol: "USYC", address: xylonet.usyc, decimals: 6}
} as const;

export type XyloNetSwapToken = keyof typeof xylonetSwapTokens;

export type XyloNetSwapQuote = {
  venue: "XyloNet";
  tokenIn: XyloNetSwapToken;
  tokenOut: XyloNetSwapToken;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  amountIn: string;
  amountOut: string;
  pool: Address;
  router: Address;
};

export const synthraQuoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {name: "tokenIn", type: "address"},
          {name: "tokenOut", type: "address"},
          {name: "amountIn", type: "uint256"},
          {name: "fee", type: "uint24"},
          {name: "sqrtPriceLimitX96", type: "uint160"}
        ]
      }
    ],
    outputs: [
      {name: "amountOut", type: "uint256"},
      {name: "sqrtPriceX96After", type: "uint160"},
      {name: "initializedTicksCrossed", type: "uint32"},
      {name: "gasEstimate", type: "uint256"}
    ]
  }
] as const;

export type SynthraSwapQuote = {
  venue: "Synthra";
  tokenIn: XyloNetSwapToken;
  tokenOut: XyloNetSwapToken;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  amountIn: string;
  amountOut: string;
  feeTier: number;
  quoter: Address;
  router: Address;
  gasEstimate: bigint;
};

type SynthraApiTransaction = {
  to?: string;
  target?: string;
  data?: string;
  calldata?: string;
  value?: string | number | bigint;
  gas?: string | number | bigint;
  gasLimit?: string | number | bigint;
};

type SynthraApiResponse = Record<string, unknown>;

type SynthraTransactionClient = {
  sendTransaction(args: {to: Address; data?: `0x${string}`; value?: bigint; gas?: bigint}): Promise<Hash>;
};

const arbSepoliaContracts = {
  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  policyRegistry: "0x30c8cc3C07F822f8cCb8ab2df2a8485DDb210328",
  x402Ledger: "0x195f70790d977983586d90f2000725B6e26684eE",
  reputation: "0x27711DC66D308EA89bF720633f4F7Bf4c339350B",
  saveEarnVault: "0x12B6fF427abA4f0438EA6B5af7E1e49e55DeaB2D",
  nexoraEscrow: "0xBEA95761fb313Dc0Ee90cc8EB2e2ad7b405EaC68"
} as const;

const baseSepoliaContracts = {
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  policyRegistry: "0x195f70790d977983586d90f2000725B6e26684eE",
  x402Ledger: "0x12B6fF427abA4f0438EA6B5af7E1e49e55DeaB2D",
  reputation: "0xB5e859af0C6d3198Ed33200E9145e31D62F0b032",
  saveEarnVault: "0xdf080a50fe94C15EDD0Ce4A9409e046abada96eD",
  nexoraEscrow: "0x870757eEA236Fe0cD45c7013d97E09AEbFc800A4"
} as const;

const arbOneContracts = {
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  policyRegistry: "",
  x402Ledger: "",
  reputation: "",
  saveEarnVault: "",
  nexoraEscrow: ""
} as const;

function requireAddress(value: string | undefined, label: string): Address {
  if (!value || !value.startsWith("0x")) {
    throw new Error(`${label} is not configured`);
  }
  return value as Address;
}

export function chainLabel(chainId?: number) {
  return chainById(chainId)?.name ?? "configured network";
}

export function contractAddressesForChain(chainId?: number) {
  const id = chainId ?? arcTestnet.id;
  if (id === arbitrumSepoliaWagmiChain.id) {
    return {
      usdc: envAddress(import.meta.env.VITE_ARB_SEPOLIA_USDC_ADDRESS, arbSepoliaContracts.usdc),
      policyRegistry: envAddress(import.meta.env.VITE_ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS, arbSepoliaContracts.policyRegistry),
      x402Ledger: envAddress(import.meta.env.VITE_ARB_SEPOLIA_X402_LEDGER_ADDRESS, arbSepoliaContracts.x402Ledger),
      reputation: envAddress(import.meta.env.VITE_ARB_SEPOLIA_REPUTATION_ADDRESS, arbSepoliaContracts.reputation),
      saveEarnVault: envAddress(import.meta.env.VITE_ARB_SEPOLIA_SAVE_EARN_VAULT_ADDRESS, arbSepoliaContracts.saveEarnVault),
      nexoraEscrow: envAddress(import.meta.env.VITE_ARB_SEPOLIA_NEXORA_ESCROW_ADDRESS, arbSepoliaContracts.nexoraEscrow),
      saveEarnDeployBlock: import.meta.env.VITE_ARB_SEPOLIA_SAVE_EARN_DEPLOY_BLOCK
    };
  }
  if (id === baseSepoliaWagmiChain.id) {
    return {
      usdc: envAddress(import.meta.env.VITE_BASE_SEPOLIA_USDC_ADDRESS, baseSepoliaContracts.usdc),
      policyRegistry: envAddress(import.meta.env.VITE_BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS, baseSepoliaContracts.policyRegistry),
      x402Ledger: envAddress(import.meta.env.VITE_BASE_SEPOLIA_X402_LEDGER_ADDRESS, baseSepoliaContracts.x402Ledger),
      reputation: envAddress(import.meta.env.VITE_BASE_SEPOLIA_REPUTATION_ADDRESS, baseSepoliaContracts.reputation),
      saveEarnVault: envAddress(import.meta.env.VITE_BASE_SEPOLIA_SAVE_EARN_VAULT_ADDRESS, baseSepoliaContracts.saveEarnVault),
      nexoraEscrow: envAddress(import.meta.env.VITE_BASE_SEPOLIA_NEXORA_ESCROW_ADDRESS, baseSepoliaContracts.nexoraEscrow),
      saveEarnDeployBlock: import.meta.env.VITE_BASE_SEPOLIA_SAVE_EARN_DEPLOY_BLOCK
    };
  }
  if (id === arbitrumOneWagmiChain.id) {
    return {
      usdc: envAddress(import.meta.env.VITE_ARB_ONE_USDC_ADDRESS, arbOneContracts.usdc),
      policyRegistry: envAddress(import.meta.env.VITE_ARB_ONE_POLICY_REGISTRY_ADDRESS, arbOneContracts.policyRegistry),
      x402Ledger: envAddress(import.meta.env.VITE_ARB_ONE_X402_LEDGER_ADDRESS, arbOneContracts.x402Ledger),
      reputation: envAddress(import.meta.env.VITE_ARB_ONE_REPUTATION_ADDRESS, arbOneContracts.reputation),
      saveEarnVault: envAddress(import.meta.env.VITE_ARB_ONE_SAVE_EARN_VAULT_ADDRESS, arbOneContracts.saveEarnVault),
      nexoraEscrow: envAddress(import.meta.env.VITE_ARB_ONE_NEXORA_ESCROW_ADDRESS, arbOneContracts.nexoraEscrow),
      saveEarnDeployBlock: import.meta.env.VITE_ARB_ONE_SAVE_EARN_DEPLOY_BLOCK
    };
  }
  return {
    usdc: import.meta.env.VITE_USDC_ADDRESS,
    policyRegistry: import.meta.env.VITE_POLICY_REGISTRY_ADDRESS,
    x402Ledger: import.meta.env.VITE_X402_LEDGER_ADDRESS,
    reputation: import.meta.env.VITE_REPUTATION_ADDRESS,
    saveEarnVault: import.meta.env.VITE_SAVE_EARN_VAULT_ADDRESS,
    nexoraEscrow: import.meta.env.VITE_NEXORA_ESCROW_ADDRESS,
    saveEarnDeployBlock: import.meta.env.VITE_SAVE_EARN_DEPLOY_BLOCK
  };
}

function envAddress(value: string | undefined, fallback: string) {
  return value?.startsWith("0x") ? value : fallback;
}

function chainById(chainId?: number) {
  if (chainId === arbitrumSepoliaWagmiChain.id) return arbitrumSepoliaWagmiChain;
  if (chainId === baseSepoliaWagmiChain.id) return baseSepoliaWagmiChain;
  if (chainId === arbitrumOneWagmiChain.id) return arbitrumOneWagmiChain;
  return supportedChains.find((chain) => chain.id === chainId) ?? supportedChains[0];
}

export function isGatewayTestnetChain(chainId?: number) {
  return chainId === arcTestnet.id || chainId === arbitrumSepoliaWagmiChain.id || chainId === baseSepoliaWagmiChain.id;
}

async function connectedChainId() {
  if (!window.ethereum) return arcTestnet.id;
  const value = await window.ethereum.request<string>({method: "eth_chainId"});
  return Number.parseInt(value, 16);
}

async function walletClient() {
  if (!window.ethereum) throw new Error("No injected wallet found");
  const [account] = await window.ethereum.request<string[]>({method: "eth_requestAccounts"});
  if (!account) throw new Error("Wallet connection rejected");
  const chainId = await connectedChainId();
  const chain = chainById(chainId);

  return {
    account: account as Address,
    chainId,
    contracts: contractAddressesForChain(chainId),
    client: createWalletClient({
      account: account as Address,
      chain,
      transport: custom(window.ethereum)
    })
  };
}

async function publicClient(chainId?: number) {
  const id = chainId ?? await connectedChainId().catch(() => arcTestnet.id);
  const chain = chainById(id);
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0])
  });
}

function xylonetRoute(tokenIn: XyloNetSwapToken, tokenOut: XyloNetSwapToken): Address | null {
  if ((tokenIn === "USDC" && tokenOut === "EURC") || (tokenIn === "EURC" && tokenOut === "USDC")) {
    return xylonet.usdcEurcPool as Address;
  }
  if ((tokenIn === "USDC" && tokenOut === "USYC") || (tokenIn === "USYC" && tokenOut === "USDC")) {
    return xylonet.usdcUsycPool as Address;
  }
  return null;
}

export function isXyloNetRouteSupported(tokenIn: XyloNetSwapToken, tokenOut: XyloNetSwapToken) {
  return Boolean(xylonetRoute(tokenIn, tokenOut));
}

export async function quoteXyloNetSwap(input: {tokenIn: XyloNetSwapToken; tokenOut: XyloNetSwapToken; amountIn: string}): Promise<XyloNetSwapQuote> {
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  if (chainId !== arcTestnet.id) {
    throw new Error("XyloNet swaps are available on Arc Testnet.");
  }
  const pool = xylonetRoute(input.tokenIn, input.tokenOut);
  if (!pool) {
    throw new Error(`${input.tokenIn} to ${input.tokenOut} is not available on XyloNet yet.`);
  }
  const tokenIn = xylonetSwapTokens[input.tokenIn];
  const tokenOut = xylonetSwapTokens[input.tokenOut];
  const amountInRaw = parseUnits(input.amountIn || "0", tokenIn.decimals);
  if (amountInRaw <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }

  const amountOutRaw = await (await publicClient(chainId)).readContract({
    address: xylonet.router,
    abi: xylonetRouterAbi,
    functionName: "getAmountOut",
    args: [pool, tokenIn.address, tokenOut.address, amountInRaw]
  });
  if (amountOutRaw <= 0n) {
    throw new Error("XyloNet returned zero output for this route.");
  }

  return {
    venue: "XyloNet",
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountInRaw,
    amountOutRaw,
    amountIn: formatUnits(amountInRaw, tokenIn.decimals),
    amountOut: formatUnits(amountOutRaw, tokenOut.decimals),
    pool,
    router: xylonet.router
  };
}

export async function quoteSynthraSwap(input: {tokenIn: XyloNetSwapToken; tokenOut: XyloNetSwapToken; amountIn: string}): Promise<SynthraSwapQuote> {
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  if (chainId !== arcTestnet.id) {
    throw new Error("Synthra swaps are available on Arc Testnet.");
  }
  if (input.tokenIn !== "USDC" || input.tokenOut !== "EURC") {
    throw new Error(`${input.tokenIn} to ${input.tokenOut} is not available on Synthra yet.`);
  }

  const tokenIn = xylonetSwapTokens[input.tokenIn];
  const tokenOut = xylonetSwapTokens[input.tokenOut];
  const amountInRaw = parseUnits(input.amountIn || "0", tokenIn.decimals);
  if (amountInRaw <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }

  const client = await publicClient(chainId);
  type SynthraCandidateQuote = {feeTier: number; amountOutRaw: bigint; gasEstimate: bigint};
  const quotes = await Promise.all(
    synthra.usdcEurcFeeTiers.map(async (feeTier): Promise<SynthraCandidateQuote | null> => {
      try {
        const result = await client.readContract({
          address: synthra.quoter,
          abi: synthraQuoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn: amountInRaw,
            fee: feeTier,
            sqrtPriceLimitX96: 0n
          }]
        }) as readonly [bigint, bigint, number, bigint];
        const [amountOutRaw, , , gasEstimate] = result;
        return {feeTier, amountOutRaw, gasEstimate};
      } catch {
        return null;
      }
    })
  );
  const best = quotes
    .filter((quote): quote is SynthraCandidateQuote => quote !== null)
    .sort((a, b) => a.amountOutRaw > b.amountOutRaw ? -1 : a.amountOutRaw < b.amountOutRaw ? 1 : 0)[0];
  if (!best) {
    throw new Error("No live Synthra quote is available for this pair.");
  }

  return {
    venue: "Synthra",
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountInRaw,
    amountOutRaw: best.amountOutRaw,
    amountIn: formatUnits(amountInRaw, tokenIn.decimals),
    amountOut: formatUnits(best.amountOutRaw, tokenOut.decimals),
    feeTier: best.feeTier,
    quoter: synthra.quoter,
    router: synthra.universalRouter,
    gasEstimate: best.gasEstimate
  };
}

export async function readSwapTokenBalance(input: {owner: string; token: XyloNetSwapToken}) {
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  const token = xylonetSwapTokens[input.token];
  const balance = await (await publicClient(chainId)).readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [input.owner as Address]
  });
  return {
    token: input.token,
    raw: balance,
    formatted: formatUnits(balance, token.decimals)
  };
}

export async function executeXyloNetSwap(input: {
  quote: XyloNetSwapQuote;
  slippageBps: number;
}): Promise<{approveHash: Hash; swapHash: Hash}> {
  const {client, account, chainId} = await walletClient();
  if (chainId !== arcTestnet.id) {
    throw new Error("Switch to Arc Testnet to swap through XyloNet.");
  }

  const tokenIn = xylonetSwapTokens[input.quote.tokenIn];
  const minAmountOut = input.quote.amountOutRaw * BigInt(10_000 - input.slippageBps) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const approveHash = await client.writeContract({
    address: tokenIn.address,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.quote.router, input.quote.amountInRaw]
  });
  await waitForSuccessfulReceipt(chainId, approveHash, "Token approval");

  const swapHash = await client.writeContract({
    address: input.quote.router,
    abi: xylonetRouterAbi,
    functionName: "swap",
    args: [
      input.quote.pool,
      tokenIn.address,
      xylonetSwapTokens[input.quote.tokenOut].address,
      input.quote.amountInRaw,
      minAmountOut,
      account,
      deadline
    ]
  });

  return {approveHash, swapHash};
}

export async function executeSynthraSwap(input: {
  quote: SynthraSwapQuote;
  slippageBps: number;
}): Promise<{approveHash?: Hash; swapHash: Hash}> {
  const {client, account, chainId} = await walletClient();
  if (chainId !== arcTestnet.id) {
    throw new Error("Switch to Arc Testnet to swap through Synthra.");
  }

  const tokenIn = xylonetSwapTokens[input.quote.tokenIn];
  const tokenOut = xylonetSwapTokens[input.quote.tokenOut];
  await ensureTokenAllowance({
    chainId,
    client,
    owner: account,
    token: tokenIn.address,
    spender: permit2Address,
    amount: input.quote.amountInRaw,
    label: "Synthra Permit2 token approval"
  });
  const permit2Hash = await ensurePermit2Allowance({
    chainId,
    client,
    owner: account,
    token: tokenIn.address,
    spender: input.quote.router,
    amount: input.quote.amountInRaw
  });

  const tx = synthraUniversalRouterTransaction({quote: input.quote, account, slippageBps: input.slippageBps});
  const swapHash = await client.sendTransaction(tx);

  return {approveHash: permit2Hash, swapHash};
}

function extractTransaction(value: unknown): SynthraApiTransaction | null {
  const seen = new Set<unknown>();

  function visit(node: unknown): SynthraApiTransaction | null {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);

    const record = node as Record<string, unknown>;
    const to = stringValue(record.to) ?? stringValue(record.target);
    const data = stringValue(record.data) ?? stringValue(record.calldata);
    if (isHexString(to) && (data === undefined || isHexString(data))) {
      return record as SynthraApiTransaction;
    }

    for (const key of ["transaction", "tx", "approval", "approvalTransaction", "approvalTx", "swap", "swapTransaction", "swapTx", "data", "result"]) {
      const found = visit(record[key]);
      if (found) return found;
    }

    for (const item of Object.values(record)) {
      const found = visit(item);
      if (found) return found;
    }
    return null;
  }

  return visit(value);
}

function synthraUniversalRouterTransaction(input: {
  quote: SynthraSwapQuote;
  account: Address;
  slippageBps: number;
}): {to: Address; data: `0x${string}`; value?: bigint} {
  const tokenIn = xylonetSwapTokens[input.quote.tokenIn];
  const tokenOut = xylonetSwapTokens[input.quote.tokenOut];
  const inputToken = new Token(arcTestnet.id, tokenIn.address, tokenIn.decimals, tokenIn.symbol, tokenIn.symbol, true);
  const outputToken = new Token(arcTestnet.id, tokenOut.address, tokenOut.decimals, tokenOut.symbol, tokenOut.symbol, true);
  const pool = new Pool(
    inputToken,
    outputToken,
    input.quote.feeTier,
    "79228162514264337593543950336",
    "1",
    0
  );
  const route = new Route([pool], inputToken, outputToken);
  const trade = new SynthraUniversalTrade({
    v3Routes: [{
      routev3: route,
      inputAmount: CurrencyAmount.fromRawAmount(inputToken, input.quote.amountInRaw.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(outputToken, input.quote.amountOutRaw.toString())
    }],
    tradeType: TradeType.EXACT_INPUT
  });
  const command = new UniswapTrade(trade, {
    slippageTolerance: new Percent(input.slippageBps, 10_000),
    recipient: input.account,
    safeMode: true
  });
  const deadline = Math.floor(Date.now() / 1000) + 1_200;
  const parameters = SynthraUniversalSwapRouter.swapCallParameters(command, {deadline});
  const value = optionalBigInt(parameters.value);

  return {
    to: input.quote.router,
    data: parameters.calldata as `0x${string}`,
    ...(value === undefined ? {} : {value})
  };
}

async function sendSynthraTransaction(client: SynthraTransactionClient, tx: SynthraApiTransaction): Promise<Hash> {
  const to = transactionTarget(tx);

  const data = tx.data ?? tx.calldata ?? "0x";
  if (!isHexString(data)) {
    throw new Error("Synthra transaction calldata is invalid.");
  }

  const value = optionalBigInt(tx.value);
  const gas = optionalBigInt(tx.gas ?? tx.gasLimit);

  return client.sendTransaction({
    to: to as Address,
    data: data as `0x${string}`,
    ...(value === undefined ? {} : {value}),
    ...(gas === undefined ? {} : {gas})
  });
}

function transactionTarget(tx: SynthraApiTransaction): Address {
  const to = tx.to ?? tx.target;
  if (!isHexString(to)) {
    throw new Error("Synthra transaction target is missing.");
  }
  return to as Address;
}

async function ensureTokenAllowance(input: {
  chainId: number;
  client: SynthraTransactionClient;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  label: string;
}) {
  const reader = await publicClient(input.chainId);
  const allowance = await reader.readContract({
    address: input.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [input.owner, input.spender]
  });
  if (allowance >= input.amount) return undefined;

  const approveHash = await input.client.sendTransaction({
    to: input.token,
    data: encodeApprove(input.spender, input.amount)
  });
  await waitForSuccessfulReceipt(input.chainId, approveHash, input.label);
  return approveHash;
}

async function ensurePermit2Allowance(input: {
  chainId: number;
  client: SynthraTransactionClient;
  owner: Address;
  token: Address;
  spender: Address;
  amount: bigint;
}) {
  if (input.amount > maxUint160) {
    throw new Error("Synthra amount exceeds Permit2 uint160 limit.");
  }
  const reader = await publicClient(input.chainId);
  const [allowance, expiration] = await reader.readContract({
    address: permit2Address,
    abi: permit2Abi,
    functionName: "allowance",
    args: [input.owner, input.token, input.spender]
  });
  const minExpiration = BigInt(Math.floor(Date.now() / 1000) + 600);
  if (allowance >= input.amount && BigInt(expiration) > minExpiration) return undefined;

  const approveHash = await input.client.sendTransaction({
    to: permit2Address,
    data: encodeFunctionData({
      abi: permit2Abi,
      functionName: "approve",
      args: [
        input.token,
        input.spender,
        input.amount,
        Math.floor(Date.now() / 1000) + 3_600
      ]
    })
  });
  await waitForSuccessfulReceipt(input.chainId, approveHash, "Synthra Permit2 allowance");
  return approveHash;
}

async function waitForSuccessfulReceipt(chainId: number, hash: Hash, label: string) {
  const receipt = await (await publicClient(chainId)).waitForTransactionReceipt({hash});
  if (receipt.status !== "success") {
    throw new Error(`${label} transaction reverted.`);
  }
  return receipt;
}

function optionalBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim()) return BigInt(value);
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && value.startsWith("0x");
}

function encodeApprove(spender: Address, amount: bigint): `0x${string}` {
  const selector = "0x095ea7b3";
  const spenderWord = spender.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const amountWord = amount.toString(16).padStart(64, "0");
  return `${selector}${spenderWord}${amountWord}` as `0x${string}`;
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
  policyV2?: {
    weeklyLimitUsdc?: string | number;
    monthlyLimitUsdc?: string | number;
    maxUnitsPerRequest?: string | number;
    cooldownSeconds?: string | number;
    expiresAt?: string | null;
    serviceAllowlist?: string[];
    previousServiceAllowlist?: string[];
    requireOnchainPolicy?: boolean;
  };
}): Promise<Hash> {
  const {client, chainId, contracts} = await walletClient();
  const address = requireAddress(contracts.policyRegistry, "Policy registry address");
  const arcNameHash = keccak256(stringToHex(input.arcName?.trim() || input.operatorAddress));
  const reader = await publicClient(chainId);
  const contractAllowlist = (input.contractAllowlist ?? []) as Address[];
  const recipientAllowlist = (input.recipientAllowlist ?? []) as Address[];
  const policyHash = await client.writeContract({
    address,
    abi: policyRegistryAbi,
    functionName: "configureAgentPolicy",
    args: [
      input.agentWallet as Address,
      input.operatorAddress as Address,
      arcNameHash,
      parseUnits(input.dailyLimitUsdc || "0", 6),
      parseUnits(input.transactionCapUsdc || "0", 6),
      contractAllowlist.length > 0,
      recipientAllowlist.length > 0,
      input.active,
      contractAllowlist,
      recipientAllowlist
    ]
  });
  await reader.waitForTransactionReceipt({hash: policyHash});

  if (input.policyV2) {
    const serviceAllowlist = (input.policyV2.serviceAllowlist ?? []).map(serviceIdHash);
    const previousServiceAllowlist = (input.policyV2.previousServiceAllowlist ?? []).map(serviceIdHash);
    const v2Hash = await client.writeContract({
      address,
      abi: policyRegistryAbi,
      functionName: "setPolicyV2",
      args: [
        input.agentWallet as Address,
        parseUnits(String(input.policyV2.weeklyLimitUsdc || "0"), 6),
        parseUnits(String(input.policyV2.monthlyLimitUsdc || "0"), 6),
        BigInt(Number(input.policyV2.maxUnitsPerRequest || "0")),
        BigInt(Number(input.policyV2.cooldownSeconds || "0")),
        BigInt(expiryTimestamp(input.policyV2.expiresAt)),
        serviceAllowlist.length > 0,
        Boolean(input.policyV2.requireOnchainPolicy)
      ]
    });
    await reader.waitForTransactionReceipt({hash: v2Hash});

    const current = new Set(serviceAllowlist);
    const staleServiceIds = previousServiceAllowlist.filter((serviceId) => !current.has(serviceId));
    for (const serviceId of staleServiceIds) {
      const serviceHash = await client.writeContract({
        address,
        abi: policyRegistryAbi,
        functionName: "setAllowedService",
        args: [input.agentWallet as Address, serviceId, false]
      });
      await reader.waitForTransactionReceipt({hash: serviceHash});
    }

    for (const serviceId of serviceAllowlist) {
      const serviceHash = await client.writeContract({
        address,
        abi: policyRegistryAbi,
        functionName: "setAllowedService",
        args: [input.agentWallet as Address, serviceId, true]
      });
      await reader.waitForTransactionReceipt({hash: serviceHash});
    }
  }

  return policyHash;
}

function serviceIdHash(value: string): `0x${string}` {
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return `0x${BigInt(normalized).toString(16).padStart(64, "0")}` as `0x${string}`;
  }
  return keccak256(stringToHex(normalized));
}

function expiryTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = Math.floor(Date.parse(value) / 1000);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export async function publishX402Service(input: {endpointHash: string; pricePerUnitUsdc: string}): Promise<{txHash: Hash; chainServiceId: number}> {
  const {client, chainId, contracts} = await walletClient();
  const address = requireAddress(contracts.x402Ledger, "x402 ledger address");
  const chainServiceId = await (await publicClient(chainId)).readContract({
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

export async function settleX402Request(input: {chainServiceId: number; requestHash: `0x${string}`; payer: string; units: number; amountUsdc: string; memo?: NexoraStructuredMemo | null}) {
  const {client, chainId, contracts} = await walletClient();
  const usdc = requireAddress(contracts.usdc, "USDC address");
  const ledger = requireAddress(contracts.x402Ledger, "x402 ledger address");
  const amount = parseUnits(input.amountUsdc || "0", 6);

  const approveHash = await client.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [ledger, amount]
  });
  await waitForSuccessfulReceipt(chainId, approveHash, "USDC approval");

  const settleData = encodeFunctionData({
    abi: x402LedgerAbi,
    functionName: "settleRequest",
    args: [BigInt(input.chainServiceId), input.requestHash, input.payer as Address, BigInt(input.units)]
  });
  const callDataHash = keccak256(settleData);
  let memoIndex: number | null = null;
  const useArcMemo = Boolean(input.memo?.memoId) && chainId === arcTestnet.id;
  const settleHash = useArcMemo
    ? await client.writeContract({
      address: arcMemoContractAddress,
      abi: arcMemoAbi,
      functionName: "memo",
      args: [
        ledger,
        settleData,
        input.memo?.memoId as `0x${string}`,
        stringToHex(JSON.stringify(input.memo ? publicMemoData(input.memo) : {}))
      ]
    })
    : await client.writeContract({
      address: ledger,
      abi: x402LedgerAbi,
      functionName: "settleRequest",
      args: [BigInt(input.chainServiceId), input.requestHash, input.payer as Address, BigInt(input.units)]
    });

  const receipt = await waitForSuccessfulReceipt(chainId, settleHash, useArcMemo ? "Memo-backed x402 settlement" : "x402 settlement");
  if (useArcMemo) {
    const memoLogs = parseEventLogs({
      abi: arcMemoAbi,
      eventName: "Memo",
      logs: receipt.logs
    }).filter((log) => log.args.memoId?.toLowerCase() === input.memo?.memoId.toLowerCase());
    const memoLog = memoLogs[memoLogs.length - 1];
    if (!memoLog) throw new Error("Memo-backed x402 settlement did not emit a matching memo event.");
    memoIndex = Number(memoLog.args.memoIndex);
  }

  return {approveHash, settleHash, memo: input.memo ?? null, memoBacked: useArcMemo, targetContract: ledger, callDataHash, memoIndex};
}

export async function createOnchainEscrow(input: {
  counterparty: string;
  amountUsdc: string;
  performanceBondUsdc: string;
  platformFeeBps: number;
  title: string;
  description: string;
}) {
  const {client, chainId, contracts} = await walletClient();
  const escrow = requireAddress(contracts.nexoraEscrow, "Nexora escrow address");
  const nextEscrowId = await (await publicClient(chainId)).readContract({
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
  const {client, contracts} = await walletClient();
  const usdc = requireAddress(contracts.usdc, "USDC address");
  const escrow = requireAddress(contracts.nexoraEscrow, "Nexora escrow address");
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
  const {client, contracts} = await walletClient();
  const escrow = requireAddress(contracts.nexoraEscrow, "Nexora escrow address");
  return client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "submitDeliverable",
    args: [BigInt(escrowId), deliverableUrl]
  });
}

export async function readOnchainEscrow(escrowId: string) {
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  const contracts = contractAddressesForChain(chainId);
  const escrow = requireAddress(contracts.nexoraEscrow, "Nexora escrow address");
  const data = await (await publicClient(chainId)).readContract({
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
  const {client, contracts} = await walletClient();
  const escrow = requireAddress(contracts.nexoraEscrow, "Nexora escrow address");
  return client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "verifyDeliverable",
    args: [BigInt(escrowId), verifierNotes]
  });
}

export async function releaseOnchainEscrow(escrowId: string) {
  const {client, contracts} = await walletClient();
  const escrow = requireAddress(contracts.nexoraEscrow, "Nexora escrow address");
  return client.writeContract({
    address: escrow,
    abi: nexoraEscrowAbi,
    functionName: "releaseEscrow",
    args: [BigInt(escrowId)]
  });
}

export async function depositSaveEarn(amountUsdc: string): Promise<{approveHash: Hash; depositHash: Hash}> {
  const {client, contracts} = await walletClient();
  const usdc = requireAddress(contracts.usdc, "USDC address");
  const vault = requireAddress(contracts.saveEarnVault, "Save/Earn vault address");
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

export async function depositGatewayUsdc(amountUsdc: string): Promise<{approveHash?: Hash; depositHash: Hash}> {
  const {client, account, chainId, contracts} = await walletClient();
  if (!isGatewayTestnetChain(chainId)) {
    throw new Error("Switch to Arc Testnet, Arbitrum Sepolia, or Base Sepolia before depositing to Gateway.");
  }

  const usdc = requireAddress(contracts.usdc, "USDC address");
  const amount = parseUnits(amountUsdc || "0", 6);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");

  const approveHash = await ensureTokenAllowance({
    chainId,
    client,
    owner: account,
    token: usdc,
    spender: gatewayWalletTestnetAddress,
    amount,
    label: "Gateway USDC approval"
  });

  const depositHash = await client.writeContract({
    address: gatewayWalletTestnetAddress,
    abi: gatewayWalletAbi,
    functionName: "deposit",
    args: [usdc, amount]
  });

  await waitForSuccessfulReceipt(chainId, depositHash, "Gateway deposit");
  return {approveHash, depositHash};
}

export async function payTreasuryUsdc(input: {treasury: string; amountUsdc: string}): Promise<{txHash: Hash; chainId: number}> {
  const {client, chainId, contracts} = await walletClient();
  if (chainId !== arcTestnet.id) {
    throw new Error("Switch to Arc Testnet to activate Nexora monthly plans.");
  }
  const usdc = requireAddress(contracts.usdc, "USDC token address");
  const treasury = requireAddress(input.treasury || import.meta.env.VITE_TREASURY_ADDRESS, "Treasury address");
  const amount = parseUnits(input.amountUsdc || "0", 6);
  if (amount <= 0n) throw new Error("Plan amount must be greater than zero.");

  const txHash = await client.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "transfer",
    args: [treasury, amount]
  });
  await waitForSuccessfulReceipt(chainId, txHash, "Plan payment");
  return {txHash, chainId};
}

export async function fundAgentWalletUsdc(input: {agentAddress: string; amountUsdc: string}): Promise<{txHash: Hash; chainId: number}> {
  const {client, chainId, contracts} = await walletClient();
  if (chainId !== arcTestnet.id) {
    throw new Error("Switch to Arc Testnet to fund an agent wallet.");
  }
  const usdc = requireAddress(contracts.usdc, "USDC token address");
  const agentAddress = requireAddress(input.agentAddress, "Agent wallet address");
  const amount = parseUnits(input.amountUsdc || "0", 6);
  if (amount <= 0n) throw new Error("Funding amount must be greater than zero.");

  const txHash = await client.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "transfer",
    args: [agentAddress, amount]
  });
  await waitForSuccessfulReceipt(chainId, txHash, "Agent wallet funding");
  return {txHash, chainId};
}

export async function withdrawSaveEarn(amountUsdc: string): Promise<Hash> {
  const {client, contracts} = await walletClient();
  const vault = requireAddress(contracts.saveEarnVault, "Save/Earn vault address");

  return client.writeContract({
    address: vault,
    abi: saveEarnVaultAbi,
    functionName: "withdraw",
    args: [await sharesForWithdrawalAmount(amountUsdc)]
  });
}

export async function readSaveEarnPosition(account: string) {
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  const contracts = contractAddressesForChain(chainId);
  const vault = requireAddress(contracts.saveEarnVault, "Save/Earn vault address");
  const client = await publicClient(chainId);
  const fromBlock = BigInt(Number(contracts.saveEarnDeployBlock ?? 42_490_737));
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

export async function readUsdcBalance(account: string) {
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  const contracts = contractAddressesForChain(chainId);
  const usdc = requireAddress(contracts.usdc, "USDC token address");
  const client = await publicClient(chainId);
  const balance = await client.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account as Address]
  });
  return formatUnits(balance, 6);
}

async function readSaveEarnEventTotals(account: string, vault: Address, fromBlock: bigint) {
  const client = await publicClient();
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
  const chainId = await connectedChainId().catch(() => arcTestnet.id);
  const contracts = contractAddressesForChain(chainId);
  const vault = requireAddress(contracts.saveEarnVault, "Save/Earn vault address");
  const client = await publicClient(chainId);
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
