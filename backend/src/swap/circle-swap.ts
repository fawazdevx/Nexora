import {createPublicClient, createWalletClient, http} from "viem";
import {SwapChain, SwapKit} from "@circle-fin/swap-kit";
import {createViemAdapterFromPrivateKey} from "@circle-fin/adapter-viem-v2";
import {config} from "../config.js";

const allowedTokens = new Set(["USDC", "EURC", "CIRBTC"]);

type SwapInput = {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
};

export async function estimateCircleSwap(input: SwapInput) {
  const kit = new SwapKit();
  const adapter = swapAdapter();
  return kit.estimate({
    from: {adapter, chain: SwapChain.Arc_Testnet},
    tokenIn: normalizeToken(input.tokenIn),
    tokenOut: normalizeToken(input.tokenOut),
    amountIn: input.amountIn,
    config: {
      kitKey: requiredKitKey(),
      slippageBps: input.slippageBps ?? 300,
      allowanceStrategy: "approve"
    }
  });
}

export async function executeCircleSwap(input: SwapInput) {
  const kit = new SwapKit();
  const adapter = swapAdapter();
  return kit.swap({
    from: {adapter, chain: SwapChain.Arc_Testnet},
    tokenIn: normalizeToken(input.tokenIn),
    tokenOut: normalizeToken(input.tokenOut),
    amountIn: input.amountIn,
    config: {
      kitKey: requiredKitKey(),
      slippageBps: input.slippageBps ?? 300,
      allowanceStrategy: "approve"
    }
  });
}

export function circleSwapReadiness() {
  return {
    chain: "Arc_Testnet",
    tokens: ["USDC", "EURC", "CIRBTC"],
    kitKeyConfigured: Boolean(config.circle.kitKey),
    signerConfigured: Boolean(swapPrivateKey())
  };
}

function normalizeToken(value: string) {
  const token = value.trim().toUpperCase();
  if (!allowedTokens.has(token)) {
    throw new Error("Circle Swap Kit on Arc Testnet currently supports USDC, EURC, and CIRBTC.");
  }
  return token === "CIRBTC" ? "CIRBTC" : token;
}

function requiredKitKey() {
  if (!config.circle.kitKey) {
    throw new Error("CIRCLE_KIT_KEY is required on the backend for Circle Swap Kit.");
  }
  return config.circle.kitKey;
}

function swapPrivateKey() {
  return process.env.CIRCLE_SWAP_PRIVATE_KEY ?? process.env.SWAP_SIGNER_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? process.env.FACILITATOR_PRIVATE_KEY ?? "";
}

function requiredSwapPrivateKey() {
  const privateKey = swapPrivateKey();
  if (!privateKey) {
    throw new Error("CIRCLE_SWAP_PRIVATE_KEY or SWAP_SIGNER_PRIVATE_KEY is required on the backend for Circle Swap Kit estimates and swaps.");
  }
  return privateKey;
}

function swapAdapter() {
  return createViemAdapterFromPrivateKey({
    privateKey: requiredSwapPrivateKey(),
    getPublicClient: ({chain}) => createPublicClient({
      chain,
      transport: http(chain.id === config.arc.chainId ? config.arc.rpcUrl : chain.rpcUrls.default.http[0])
    }),
    getWalletClient: ({chain, account}) => createWalletClient({
      chain,
      account,
      transport: http(chain.id === config.arc.chainId ? config.arc.rpcUrl : chain.rpcUrls.default.http[0])
    })
  });
}
