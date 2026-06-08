import type {NexoraX402Config, PaymentRequirements} from "./types.js";

export function createPaymentRequirements(config: NexoraX402Config): PaymentRequirements {
  assertHttpUrl(config.facilitatorUrl, "facilitatorUrl");
  assertAddress(config.payTo, "payTo");
  assertAddress(config.asset, "asset");

  const maxAmountRequired = config.amountAtomic ?? usdcToAtomic(config.price ?? "0");
  if (BigInt(maxAmountRequired) <= 0n) throw new Error("price or amountAtomic must be greater than zero");

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
      name: "USDC",
      version: "2",
      ...config.extra
    }
  };
}

export function paymentRequiredResponse(paymentRequirements: PaymentRequirements) {
  return {
    x402Version: 1,
    accepts: [paymentRequirements],
    error: "X-PAYMENT header is required"
  };
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
