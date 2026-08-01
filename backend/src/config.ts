import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

loadLocalEnv();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  databaseSslRejectUnauthorized: (process.env.PGSSL_REJECT_UNAUTHORIZED ?? "true").toLowerCase() !== "false",
  redisUrl: process.env.REDIS_URL ?? "",
  arc: {
    rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    explorerUrl: process.env.ARC_EXPLORER_URL ?? "https://testnet.arcscan.app"
  },
  arbitrum: {
    sepoliaRpcUrl: process.env.ARB_SEPOLIA_RPC_URL ?? process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
    sepoliaChainId: Number(process.env.ARB_SEPOLIA_CHAIN_ID ?? 421614),
    sepoliaExplorerUrl: process.env.ARB_SEPOLIA_EXPLORER_URL ?? "https://sepolia.arbiscan.io",
    sepoliaUsdc: process.env.ARB_SEPOLIA_USDC_ADDRESS ?? "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    sepoliaPolicyRegistry: process.env.ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS ?? "",
    sepoliaX402Ledger: process.env.ARB_SEPOLIA_X402_LEDGER_ADDRESS ?? "",
    sepoliaReputation: process.env.ARB_SEPOLIA_REPUTATION_ADDRESS ?? "",
    sepoliaYieldRouter: process.env.ARB_SEPOLIA_YIELD_ROUTER_ADDRESS ?? "",
    sepoliaSaveEarnVault: process.env.ARB_SEPOLIA_SAVE_EARN_VAULT_ADDRESS ?? "",
    sepoliaEscrow: process.env.ARB_SEPOLIA_NEXORA_ESCROW_ADDRESS ?? "",
    oneRpcUrl: process.env.ARB_ONE_RPC_URL ?? process.env.ARBITRUM_ONE_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
    oneChainId: Number(process.env.ARB_ONE_CHAIN_ID ?? 42161),
    oneExplorerUrl: process.env.ARB_ONE_EXPLORER_URL ?? "https://arbiscan.io",
    oneUsdc: process.env.ARB_ONE_USDC_ADDRESS ?? "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    oneX402Ledger: process.env.ARB_ONE_X402_LEDGER_ADDRESS ?? ""
  },
  base: {
    sepoliaRpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://base-sepolia-rpc.publicnode.com",
    sepoliaChainId: Number(process.env.BASE_SEPOLIA_CHAIN_ID ?? 84532),
    sepoliaExplorerUrl: process.env.BASE_SEPOLIA_EXPLORER_URL ?? "https://sepolia.basescan.org",
    sepoliaUsdc: process.env.BASE_SEPOLIA_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    sepoliaPolicyRegistry: process.env.BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS ?? "",
    sepoliaX402Ledger: process.env.BASE_SEPOLIA_X402_LEDGER_ADDRESS ?? "",
    sepoliaReputation: process.env.BASE_SEPOLIA_REPUTATION_ADDRESS ?? "",
    sepoliaYieldRouter: process.env.BASE_SEPOLIA_YIELD_ROUTER_ADDRESS ?? "",
    sepoliaSaveEarnVault: process.env.BASE_SEPOLIA_SAVE_EARN_VAULT_ADDRESS ?? "",
    sepoliaEscrow: process.env.BASE_SEPOLIA_NEXORA_ESCROW_ADDRESS ?? "",
    mainnetRpcUrl: process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    mainnetChainId: Number(process.env.BASE_MAINNET_CHAIN_ID ?? 8453),
    mainnetExplorerUrl: process.env.BASE_MAINNET_EXPLORER_URL ?? "https://basescan.org",
    mainnetUsdc: process.env.BASE_MAINNET_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    mainnetX402Ledger: process.env.BASE_MAINNET_X402_LEDGER_ADDRESS ?? ""
  },
  // Nexora-owned x402 settlement contract (NexoraX402Settlement) per chain. This
  // is the fee-collecting, EIP-3009 receiveWithAuthorization splitter for the RAW
  // x402 path — distinct from the marketplace X402FacilitatorLedger. When an
  // address is set for a chain, raw x402 settles through it (payTo = contract,
  // payer/seller submits, Nexora pays no gas and earns feeBps). Empty = that
  // chain has no settlement contract yet; raw x402 falls back to the legacy EOA.
  x402Settlement: {
    arcTestnet: process.env.ARC_X402_SETTLEMENT_ADDRESS ?? "",
    baseSepolia: process.env.BASE_SEPOLIA_X402_SETTLEMENT_ADDRESS ?? "",
    baseMainnet: process.env.BASE_MAINNET_X402_SETTLEMENT_ADDRESS ?? "",
    arbitrumSepolia: process.env.ARB_SEPOLIA_X402_SETTLEMENT_ADDRESS ?? "",
    arbitrumOne: process.env.ARB_ONE_X402_SETTLEMENT_ADDRESS ?? ""
  },
  // BOT Chain (EVM). Its payment token (USDT) has no EIP-3009, so x402 settles
  // via Permit2 through Meridian's facilitator (see `meridian` below), not by
  // Nexora self-submitting like on Arc. Testnet-first per rollout plan.
  botchain: {
    testnetRpcUrl: process.env.BOTCHAIN_TESTNET_RPC_URL ?? "https://rpc.bohr.life",
    testnetChainId: Number(process.env.BOTCHAIN_TESTNET_CHAIN_ID ?? 968),
    testnetExplorerUrl: process.env.BOTCHAIN_TESTNET_EXPLORER_URL ?? "",
    // Meridian's default testnet payment token (USDT). NOTE: token decimals are
    // NOT assumed — Meridian's docs warn against hardcoding 6. `tokenDecimals`
    // is overridable and should be confirmed on-chain (decimals()) before use.
    testnetUsdt: process.env.BOTCHAIN_TESTNET_USDT_ADDRESS ?? "0x75edC9335175Fc0552D51D48439F229c10420fe3",
    mainnetRpcUrl: process.env.BOTCHAIN_MAINNET_RPC_URL ?? "https://rpc.botchain.ai",
    mainnetChainId: Number(process.env.BOTCHAIN_MAINNET_CHAIN_ID ?? 677),
    mainnetExplorerUrl: process.env.BOTCHAIN_MAINNET_EXPLORER_URL ?? "",
    mainnetUsdt: process.env.BOTCHAIN_MAINNET_USDT_ADDRESS ?? "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
    tokenDecimals: Number(process.env.BOTCHAIN_USDT_DECIMALS ?? 6),
    // BOT payments stay on Meridian. Nexora deploys only policy and reputation
    // controls; the legacy BOT ledger address is retained as an ignored
    // compatibility setting for existing environments.
    testnetPolicyRegistry: process.env.BOTCHAIN_TESTNET_POLICY_REGISTRY_ADDRESS ?? "",
    testnetX402Ledger: process.env.BOTCHAIN_TESTNET_X402_LEDGER_ADDRESS ?? "",
    testnetReputation: process.env.BOTCHAIN_TESTNET_REPUTATION_ADDRESS ?? "",
    mainnetPolicyRegistry: process.env.BOTCHAIN_MAINNET_POLICY_REGISTRY_ADDRESS ?? "",
    mainnetReputation: process.env.BOTCHAIN_MAINNET_REPUTATION_ADDRESS ?? "",
    mainnetEnabled: (process.env.NEXORA_ENABLE_BOTCHAIN_MAINNET ?? "false").toLowerCase() === "true",
    testnetReservationsEnabled: (process.env.BOTCHAIN_TESTNET_POLICY_RESERVATIONS_ENABLED ?? "false").toLowerCase() === "true",
    mainnetReservationsEnabled: (process.env.BOTCHAIN_MAINNET_POLICY_RESERVATIONS_ENABLED ?? "true").toLowerCase() !== "false",
    reservationTtlSeconds: normalizeBoundedInteger(process.env.BOTCHAIN_POLICY_RESERVATION_TTL_SECONDS, 900, 60, 86_400),
    accountingReconciliationIntervalMs: normalizeBoundedInteger(
      process.env.BOTCHAIN_ACCOUNTING_RECONCILIATION_INTERVAL_MS,
      60_000,
      0,
      86_400_000
    ),
    testnetPaymasterUrl: process.env.BOTCHAIN_TESTNET_PAYMASTER_RPC_URL ?? "",
    mainnetPaymasterUrl: process.env.BOTCHAIN_MAINNET_PAYMASTER_RPC_URL ?? "",
    paymasterEnabled: (process.env.BOTCHAIN_PAYMASTER_ENABLED ?? "false").toLowerCase() === "true",
    bridgeUrl: process.env.BOTCHAIN_BRIDGE_URL ?? "https://bridge.botchain.ai",
    dexUrl: process.env.BOTCHAIN_DEX_URL ?? "https://dex.botchain.ai",
    vcomputeProviderUrl: process.env.BOTCHAIN_VCOMPUTE_PROVIDER_URL ?? "",
    vcomputeUnitPriceUsdt: normalizeOptionalPositiveNumber(process.env.BOTCHAIN_VCOMPUTE_UNIT_PRICE_USDT, 0.002),
    vcomputeMaxUnits: normalizeBoundedInteger(process.env.BOTCHAIN_VCOMPUTE_MAX_UNITS, 10_000, 1, 1_000_000)
  },
  circle: {
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID ?? "",
    agentWalletAccountType: normalizeCircleAccountType(process.env.CIRCLE_AGENT_WALLET_ACCOUNT_TYPE),
    agentMainnetsEnabled: (process.env.NEXORA_ENABLE_AGENT_MAINNETS ?? "false").toLowerCase() === "true",
    agentMarketplace: {
      enabled: (process.env.NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED ?? "false").toLowerCase() === "true",
      cliPath: process.env.NEXORA_CIRCLE_CLI_PATH ?? "circle",
      defaultChain: process.env.NEXORA_CIRCLE_DEFAULT_CHAIN ?? "BASE_SEPOLIA",
      requireConfirmation: (process.env.NEXORA_CIRCLE_PAYMENT_REQUIRE_CONFIRMATION ?? "true").toLowerCase() !== "false",
      maxPaymentUsdc: normalizeOptionalPositiveNumber(process.env.NEXORA_CIRCLE_PAYMENT_MAX_USDC, 5)
    },
    gatewaySeller: {
      enabled: (process.env.NEXORA_CIRCLE_GATEWAY_SELLER_ENABLED ?? "true").toLowerCase() !== "false",
      mode: normalizeCircleGatewaySellerMode(process.env.NEXORA_CIRCLE_GATEWAY_SELLER_MODE),
      networks: process.env.NEXORA_CIRCLE_GATEWAY_SELLER_NETWORKS ?? "",
      publicApiUrl: process.env.NEXORA_PUBLIC_API_URL ?? "",
      facilitatorUrl: process.env.CIRCLE_GATEWAY_FACILITATOR_URL
        ?? defaultCircleGatewayFacilitatorUrl(process.env.NEXORA_CIRCLE_GATEWAY_SELLER_MODE)
    }
  },
  // Meridian is an external x402 facilitator. On non-EIP-3009 chains (BOT Chain)
  // Nexora acts as a Meridian seller and relays signed Permit2 payloads with a
  // server-side public `pk_` credential. When unset, Nexora does not advertise
  // BOT Chain settlement.
  meridian: {
    apiBase: process.env.MERIDIAN_API_BASE ?? "https://api.mrdn.finance/v1",
    // Meridian authenticates seller API calls with the public `pk_` credential
    // as a Bearer token. Keep the old variable as a backwards-compatible
    // fallback, but never load or send MERIDIAN_API_SECRET.
    publicKey: process.env.MERIDIAN_PUBLIC_KEY ?? process.env.MERIDIAN_API_KEY ?? "",
    sellerAddress: process.env.MERIDIAN_SELLER_ADDRESS ?? "",
    // Meridian applies the marketplace fee configured in Command Centre. This
    // value must match that setting and is used for disclosure and receipts; it
    // is not sent as an unsupported paymentRequirements field.
    marketplaceFeeBps: normalizeBoundedInteger(
      process.env.NEXORA_BOTCHAIN_MARKETPLACE_FEE_BPS ?? process.env.NEXORA_BOTCHAIN_PLATFORM_FEE_BPS,
      200,
      0,
      1_000
    ),
    testnetPolicyRelayerPrivateKey:
      process.env.BOTCHAIN_TESTNET_POLICY_RELAYER_PRIVATE_KEY
      ?? process.env.BOTCHAIN_POLICY_RELAYER_PRIVATE_KEY
      ?? "",
    mainnetPolicyRelayerPrivateKey: process.env.BOTCHAIN_MAINNET_POLICY_RELAYER_PRIVATE_KEY ?? "",
    // Meridian's fixed contract set (same across supported EVM chains).
    permit2: process.env.MERIDIAN_PERMIT2_ADDRESS ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    exactPermit2Proxy: process.env.MERIDIAN_EXACT_PERMIT2_PROXY_ADDRESS ?? "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
    // Per-network facilitator (payTo / witness.to). Testnet differs from mainnet.
    testnetFacilitator: process.env.MERIDIAN_TESTNET_FACILITATOR_ADDRESS ?? "0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A",
    mainnetFacilitator: process.env.MERIDIAN_MAINNET_FACILITATOR_ADDRESS ?? "0x8E7769D440b3460b92159Dd9C6D17302b036e2d6"
  },
  contracts: {
    usdc: process.env.USDC_ADDRESS ?? "",
    policyRegistry: process.env.POLICY_REGISTRY_ADDRESS ?? "",
    x402Ledger: process.env.X402_LEDGER_ADDRESS ?? "",
    reputation: process.env.REPUTATION_ADDRESS ?? "",
    yieldRouter: process.env.YIELD_ROUTER_ADDRESS ?? "",
    saveEarnVault: process.env.SAVE_EARN_VAULT_ADDRESS ?? "",
    nexoraEscrow: process.env.NEXORA_ESCROW_ADDRESS ?? "",
    treasury: process.env.TREASURY_ADDRESS ?? "",
    marketplacePublisher: process.env.NEXORA_MARKETPLACE_PUBLISHER_ADDRESS ?? process.env.OWNER_ADDRESS ?? ""
  },
  facilitator: {
    signingMode: process.env.FACILITATOR_SIGNING_MODE ?? "wallet",
    privateKey: process.env.FACILITATOR_PRIVATE_KEY ?? ""
  },
  gateway: {
    apiUrl: process.env.GATEWAY_API_URL ?? "https://gateway-api-testnet.circle.com/v1",
    token: process.env.GATEWAY_TOKEN ?? "USDC",
    walletAddress: process.env.GATEWAY_WALLET_ADDRESS ?? "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    minterAddress: process.env.GATEWAY_MINTER_ADDRESS ?? "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    maxTransferUsdc: normalizeOptionalPositiveNumber(process.env.NEXORA_GATEWAY_MAX_TRANSFER_USDC, 10_000)
  },
  security: {
    authSecret: process.env.NEXORA_AUTH_SECRET ?? process.env.AUTH_SECRET ?? "nexora-local-dev-secret",
    requireSignedAuth: (process.env.NEXORA_REQUIRE_SIGNED_AUTH ?? "false").toLowerCase() === "true",
    adminSecret: process.env.NEXORA_ADMIN_SECRET ?? "",
    webhookSecret: process.env.CIRCLE_WEBHOOK_SECRET ?? process.env.NEXORA_WEBHOOK_SECRET ?? "",
    indexerSecret: process.env.NEXORA_INDEXER_SECRET ?? ""
  },
  integrations: {
    xBearerToken: process.env.X_BEARER_TOKEN ?? "",
    githubToken: process.env.GITHUB_TOKEN ?? "",
    synthraApiKey: process.env.SYNTHRA_API_KEY ?? "",
    synthraApiUrl: process.env.SYNTHRA_API_URL ?? "https://trading-api.synthra.org",
    tenderlyAccessKey: process.env.TENDERLY_ACCESS_KEY ?? "",
    tenderlyAccountSlug: process.env.TENDERLY_ACCOUNT_SLUG ?? "",
    tenderlyProjectSlug: process.env.TENDERLY_PROJECT_SLUG ?? "",
    tenderlyApiUrl: process.env.TENDERLY_API_URL ?? "https://api.tenderly.co/api/v1"
  },
  notifications: {
    publicAppUrl: process.env.NEXORA_PUBLIC_APP_URL ?? process.env.FRONTEND_PUBLIC_URL ?? "https://nexorafi.app",
    email: {
      provider: process.env.NEXORA_EMAIL_PROVIDER ?? "resend",
      from: process.env.NEXORA_EMAIL_FROM ?? "",
      resendApiKey: process.env.RESEND_API_KEY ?? ""
    },
    whatsapp: {
      enabled: (process.env.NEXORA_WHATSAPP_ENABLED ?? "false").toLowerCase() === "true",
      provider: process.env.NEXORA_WHATSAPP_PROVIDER ?? "twilio",
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
      authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
      from: process.env.TWILIO_WHATSAPP_FROM ?? ""
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
      webhookSecret: process.env.NEXORA_TELEGRAM_WEBHOOK_SECRET ?? process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
    }
  }
};

function loadLocalEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = unquoteEnvValue(trimmed.slice(index + 1).trim());
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function unquoteEnvValue(value: string) {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) return value;
  return value.slice(1, -1);
}

function normalizeCircleAccountType(value: string | undefined): "EOA" | "SCA" {
  return value?.toUpperCase() === "SCA" ? "SCA" : "EOA";
}

function normalizeOptionalPositiveNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function normalizeCircleGatewaySellerMode(value: string | undefined): "testnet" | "mainnet" {
  return value?.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

function defaultCircleGatewayFacilitatorUrl(mode: string | undefined) {
  return normalizeCircleGatewaySellerMode(mode) === "mainnet"
    ? "https://gateway-api.circle.com"
    : "https://gateway-api-testnet.circle.com";
}
