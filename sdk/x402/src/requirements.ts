import {
  BOTCHAIN_TESTNET_USDT,
  MERIDIAN_BOTCHAIN_TESTNET_FACILITATOR,
  type MeridianPaymentRequirementsConfig,
  type NexoraX402Config,
  type PaymentRequirements,
  type X402Network,
  type X402Version
} from "./types.js";

const caip2Networks: Partial<Record<X402Network, X402Network>> = {
  "arc-testnet": "eip155:5042002",
  arc: "eip155:5042002",
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
  "arbitrum-sepolia": "eip155:421614",
  arbitrum: "eip155:42161",
  "bot-chain-testnet": "eip155:968",
  "bot-chain": "eip155:677"
};

export function createPaymentRequirements(config: NexoraX402Config): PaymentRequirements {
  assertHttpUrl(config.facilitatorUrl, "facilitatorUrl");
  assertAddress(config.payTo, "payTo");
  assertAddress(config.asset, "asset");

  const maxAmountRequired = config.amountAtomic ?? usdcToAtomic(config.price ?? "0");
  if (BigInt(maxAmountRequired) <= 0n) throw new Error("price or amountAtomic must be greater than zero");

  const botchain = config.network === "bot-chain-testnet" || config.network === "bot-chain"
    || config.network === "eip155:968" || config.network === "eip155:677";
  const x402Version = config.x402Version ?? (botchain ? 1 : 2);
  if (botchain && x402Version !== 1) {
    throw new Error("BOT Chain Meridian routes currently require x402Version 1");
  }

  return {
    scheme: "exact",
    network: config.network ?? "arc-testnet",
    maxAmountRequired,
    resource: config.resource ?? "nexora-protected-resource",
    description: config.description,
    mimeType: config.mimeType ?? "application/json",
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 120,
    asset: config.asset,
    outputSchema: config.outputSchema,
    extra: {
      name: botchain ? "USDT" : "USDC",
      version: botchain ? "1" : "2",
      x402Version,
      ...config.extra
    }
  };
}

/**
 * Builds BOT Chain requirements with Meridian's facilitator as `payTo`.
 * The seller wallet is configured server-side in Nexora and must never replace
 * the facilitator in the signed Permit2 witness.
 */
export function createMeridianPaymentRequirements(config: MeridianPaymentRequirementsConfig): PaymentRequirements {
  const network = config.network ?? "bot-chain-testnet";
  if (network !== "bot-chain-testnet") {
    throw new Error("BOT Chain mainnet Meridian requirements are not enabled by this SDK release");
  }
  return createPaymentRequirements({
    facilitatorUrl: config.facilitatorUrl,
    payTo: config.facilitator ?? MERIDIAN_BOTCHAIN_TESTNET_FACILITATOR,
    asset: config.asset ?? BOTCHAIN_TESTNET_USDT,
    price: config.price,
    amountAtomic: config.amountAtomic,
    network,
    x402Version: 1,
    resource: config.resource,
    description: config.description,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    outputSchema: config.outputSchema,
    extra: config.extra
  });
}

export function paymentRequiredResponse(paymentRequirements: PaymentRequirements) {
  return paymentRequiredResponseForVersion(paymentRequirements, 1);
}

export function paymentRequiredResponseForVersion(paymentRequirements: PaymentRequirements, version: 1 | 2) {
  if (version === 2) {
    return {
      x402Version: 2 as const,
      error: "PAYMENT-SIGNATURE header is required",
      resource: {
        url: paymentRequirements.resource,
        description: paymentRequirements.description,
        mimeType: paymentRequirements.mimeType
      },
      accepts: [{
        scheme: paymentRequirements.scheme,
        network: networkForX402Version(paymentRequirements.network, version),
        amount: paymentRequirements.maxAmountRequired,
        payTo: paymentRequirements.payTo,
        maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
        asset: paymentRequirements.asset,
        outputSchema: paymentRequirements.outputSchema,
        extra: paymentRequirements.extra
      }]
    };
  }
  return {
    x402Version: 1 as const,
    accepts: [paymentRequirements],
    error: "X-PAYMENT header is required"
  };
}

export function networkForX402Version(network: X402Network, version: X402Version): X402Network {
  if (version === 1 || network.startsWith("eip155:")) return network;
  return caip2Networks[network] ?? network;
}

export function usdcToAtomic(value: string) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("USDC price must be a decimal string with up to 6 decimals");
  }
  const [whole, decimal = ""] = normalized.split(".");
  return `${whole}${decimal.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "");
}

function assertAddress(value: string, label: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`${label} must be an EVM address`);
}

function assertHttpUrl(value: string, label: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${label} must be an http(s) URL`);
}
