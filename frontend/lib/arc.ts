import {ARCNames} from "@arcnames/sdk";
import {ANS_REGISTRY_ADDRESSES} from "@arcnames/sdk/constants";

export const arcTestnet = {
  id: Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  rpcUrl: import.meta.env.VITE_ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
  explorerUrl: import.meta.env.VITE_ARC_EXPLORER_URL ?? "https://testnet.arcscan.app",
  arcNamesRegistry:
    import.meta.env.VITE_ARC_NAMES_REGISTRY_ADDRESS ??
    ANS_REGISTRY_ADDRESSES[Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002)],
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18
  }
} as const;

export const arcTestnetWagmiChain = {
  id: arcTestnet.id,
  name: arcTestnet.name,
  nativeCurrency: arcTestnet.nativeCurrency,
  rpcUrls: {
    default: {http: [arcTestnet.rpcUrl]}
  },
  blockExplorers: {
    default: {name: "Arc Explorer", url: arcTestnet.explorerUrl}
  },
  testnet: true
} as const;

export const arcNamesConfig = {
  rpcUrl: arcTestnet.rpcUrl,
  registryAddress: arcTestnet.arcNamesRegistry
};

export const arcNamesClient = new ARCNames(arcNamesConfig);

export function shortAddress(address?: string | null) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function resolveArcName(address?: string | null) {
  if (!address?.startsWith("0x")) return null;
  const name = await arcNamesClient.reverseLookup(address);
  return name?.endsWith(".arc") ? name : name ? `${name}.arc` : null;
}

export async function switchToArc() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No injected wallet found");
  }

  const chainIdHex = `0x${arcTestnet.id.toString(16)}`;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{chainId: chainIdHex}]
    });
  } catch (error: unknown) {
    const code = typeof error === "object" && error && "code" in error ? (error as {code?: number}).code : undefined;
    if (code !== 4902) throw error;

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: [arcTestnet.rpcUrl],
          blockExplorerUrls: [arcTestnet.explorerUrl]
        }
      ]
    });
  }
}

declare global {
  interface Window {
    ethereum?: {
      request<T = unknown>(args: {method: string; params?: unknown[]}): Promise<T>;
    };
  }
}
