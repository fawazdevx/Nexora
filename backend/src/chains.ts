import {config} from "./config.js";

export type NexoraChainContext = {
  key: "arc-testnet" | "base-sepolia" | "arbitrum-sepolia" | "base" | "arbitrum" | "bot-chain-testnet" | "bot-chain";
  chainId: number;
  label: string;
  rpcUrl: string;
  explorerUrl: string;
  usdc: string;
  policyRegistry: string;
  x402Ledger: string;
  circleBlockchain: "ARC-TESTNET" | "BASE-SEPOLIA" | "ARB-SEPOLIA" | "BASE" | "ARB" | "EXTERNAL-EVM";
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  testnet: boolean;
  gatewayDomain?: number;
};

export type NexoraCircleChainContext = NexoraChainContext & {
  key: "arc-testnet" | "base-sepolia" | "arbitrum-sepolia" | "base" | "arbitrum";
  circleBlockchain: "ARC-TESTNET" | "BASE-SEPOLIA" | "ARB-SEPOLIA" | "BASE" | "ARB";
};

export function agentChainContexts(): NexoraCircleChainContext[] {
  const contexts: NexoraCircleChainContext[] = [
    {
      key: "arc-testnet",
      chainId: config.arc.chainId,
      label: "Arc Testnet",
      rpcUrl: config.arc.rpcUrl,
      explorerUrl: config.arc.explorerUrl,
      usdc: config.contracts.usdc,
      policyRegistry: config.contracts.policyRegistry,
      x402Ledger: config.contracts.x402Ledger,
      circleBlockchain: "ARC-TESTNET",
      nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
      testnet: true,
      gatewayDomain: 26
    },
    {
      key: "base-sepolia",
      chainId: config.base.sepoliaChainId,
      label: "Base Sepolia",
      rpcUrl: config.base.sepoliaRpcUrl,
      explorerUrl: config.base.sepoliaExplorerUrl,
      usdc: config.base.sepoliaUsdc,
      policyRegistry: config.base.sepoliaPolicyRegistry,
      x402Ledger: config.base.sepoliaX402Ledger,
      circleBlockchain: "BASE-SEPOLIA",
      nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
      testnet: true,
      gatewayDomain: 6
    },
    {
      key: "arbitrum-sepolia",
      chainId: config.arbitrum.sepoliaChainId,
      label: "Arbitrum Sepolia",
      rpcUrl: config.arbitrum.sepoliaRpcUrl,
      explorerUrl: config.arbitrum.sepoliaExplorerUrl,
      usdc: config.arbitrum.sepoliaUsdc,
      policyRegistry: config.arbitrum.sepoliaPolicyRegistry,
      x402Ledger: config.arbitrum.sepoliaX402Ledger,
      circleBlockchain: "ARB-SEPOLIA",
      nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
      testnet: true,
      gatewayDomain: 3
    }
  ];

  if (config.circle.agentMainnetsEnabled) {
    contexts.push(
      {
        key: "base",
        chainId: config.base.mainnetChainId,
        label: "Base",
        rpcUrl: config.base.mainnetRpcUrl,
        explorerUrl: config.base.mainnetExplorerUrl,
        usdc: config.base.mainnetUsdc,
        policyRegistry: "",
        x402Ledger: config.base.mainnetX402Ledger,
        circleBlockchain: "BASE",
        nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
        testnet: false
      },
      {
        key: "arbitrum",
        chainId: config.arbitrum.oneChainId,
        label: "Arbitrum One",
        rpcUrl: config.arbitrum.oneRpcUrl,
        explorerUrl: config.arbitrum.oneExplorerUrl,
        usdc: config.arbitrum.oneUsdc,
        policyRegistry: "",
        x402Ledger: config.arbitrum.oneX402Ledger,
        circleBlockchain: "ARB",
        nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
        testnet: false
      }
    );
  }

  return contexts;
}

export function nexoraChainContexts(): NexoraChainContext[] {
  const contexts: NexoraChainContext[] = [
    ...agentChainContexts(),
    {
      key: "bot-chain-testnet",
      chainId: config.botchain.testnetChainId,
      label: "BOT Chain Testnet",
      rpcUrl: config.botchain.testnetRpcUrl,
      explorerUrl: config.botchain.testnetExplorerUrl,
      usdc: config.botchain.testnetUsdt,
      policyRegistry: config.botchain.testnetPolicyRegistry,
      x402Ledger: "",
      circleBlockchain: "EXTERNAL-EVM",
      nativeCurrency: {name: "BOT", symbol: "tBOT", decimals: 18},
      testnet: true
    }
  ];

  if (config.botchain.mainnetEnabled) {
    contexts.push({
      key: "bot-chain",
      chainId: config.botchain.mainnetChainId,
      label: "BOT Chain",
      rpcUrl: config.botchain.mainnetRpcUrl,
      explorerUrl: config.botchain.mainnetExplorerUrl,
      usdc: config.botchain.mainnetUsdt,
      policyRegistry: config.botchain.mainnetPolicyRegistry,
      x402Ledger: "",
      circleBlockchain: "EXTERNAL-EVM",
      nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
      testnet: false
    });
  }

  return contexts;
}

export function chainContext(chainId?: number | null) {
  const resolvedId = chainId ?? config.arc.chainId;
  const context = nexoraChainContexts().find((item) => item.chainId === resolvedId);
  if (!context) throw new Error(`Chain ${resolvedId} is not enabled for Nexora agents.`);
  return context;
}

export function chainContextByCircleBlockchain(blockchain: string) {
  return agentChainContexts().find((item) => item.circleBlockchain === blockchain) ?? null;
}
