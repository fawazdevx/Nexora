import {keccak256, stringToHex} from "viem";
import {config} from "../config.js";
import {
  buildMeridianPaymentRequirements,
  meridianNetworkConfig,
  normalizeMeridianNetwork
} from "../x402/meridian-facilitator.js";

export function createVComputePaymentQuote(input: {
  network?: string | null;
  jobType: string;
  units: number;
  provider?: string | null;
}) {
  const network = normalizeMeridianNetwork(input.network ?? "bot-chain-testnet");
  if (!network) throw new Error("Unsupported BOT Chain network");
  if (!Number.isSafeInteger(input.units) || input.units <= 0 || input.units > config.botchain.vcomputeMaxUnits) {
    throw new Error(`vCompute units must be between 1 and ${config.botchain.vcomputeMaxUnits}`);
  }
  const jobType = input.jobType.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(jobType)) {
    throw new Error("vCompute jobType must be a short lowercase identifier");
  }
  const provider = input.provider?.trim() || config.botchain.vcomputeProviderUrl || "provider-selected-at-execution";
  const net = meridianNetworkConfig(network);
  const amountBaseUnits = BigInt(Math.round(
    input.units * config.botchain.vcomputeUnitPriceUsdt * 10 ** net.assetDecimals
  ));
  if (amountBaseUnits <= 0n) throw new Error("vCompute quote amount is below the token precision");
  const serviceId = keccak256(stringToHex(`vcompute:${provider}:${jobType}`));
  const resource = `nexora://botchain/vcompute/${jobType}/${serviceId}`;
  const paymentRequirements = buildMeridianPaymentRequirements({
    network,
    amountBaseUnits: amountBaseUnits.toString(),
    resource,
    description: `BOT Chain vCompute ${jobType} job (${input.units} units)`
  });

  return {
    network,
    chainId: net.chainId,
    serviceId,
    job: {
      type: jobType,
      units: input.units,
      provider,
      providerConfigured: Boolean(config.botchain.vcomputeProviderUrl)
    },
    pricing: {
      asset: net.assetSymbol,
      unitPrice: config.botchain.vcomputeUnitPriceUsdt,
      amountBaseUnits: amountBaseUnits.toString(),
      marketplaceFeeBps: config.meridian.marketplaceFeeBps
    },
    policy: {
      maxUnitsPerRequest: input.units,
      requireServiceAllowlist: true,
      serviceId
    },
    paymentRequirements
  };
}
