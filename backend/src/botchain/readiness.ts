import {createPublicClient, http, isAddress, parseAbi, type Address} from "viem";
import {config} from "../config.js";
import {
  botchainPolicyRuntime,
  meridianNetworkConfig,
  normalizeMeridianNetwork,
  type MeridianNetwork
} from "../x402/meridian-facilitator.js";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);

export async function readBotChainReadiness(input: {
  address: string;
  network?: string | null;
}) {
  if (!isAddress(input.address)) throw new Error("A valid BOT Chain EOA address is required");
  const network = normalizeMeridianNetwork(input.network ?? "bot-chain-testnet");
  if (!network) throw new Error("Unsupported BOT Chain network");

  const runtime = botchainPolicyRuntime(network);
  const net = meridianNetworkConfig(network);
  const client = createPublicClient({
    transport: http(net.rpcUrl, {timeout: 20_000})
  });
  const [nativeBalance, tokenBalance, allowance, policyCode, reputationCode] = await Promise.all([
    client.getBalance({address: input.address as Address}),
    client.readContract({
      address: net.asset as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [input.address as Address]
    }),
    client.readContract({
      address: net.asset as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [input.address as Address, config.meridian.permit2 as Address]
    }),
    runtime.policyRegistry && isAddress(runtime.policyRegistry)
      ? client.getCode({address: runtime.policyRegistry as Address})
      : null,
    runtime.reputation && isAddress(runtime.reputation)
      ? client.getCode({address: runtime.reputation as Address})
      : null
  ]);

  return {
    network,
    label: net.label,
    chainId: net.chainId,
    address: input.address,
    asset: {
      address: net.asset,
      symbol: net.assetSymbol,
      decimals: net.assetDecimals,
      balanceBaseUnits: tokenBalance.toString(),
      permit2AllowanceBaseUnits: allowance.toString()
    },
    gas: {
      symbol: "BOT",
      balanceWei: nativeBalance.toString(),
      balance: Number(nativeBalance) / 10 ** 18
    },
    policy: {
      enabled: runtime.enabled,
      reservationsEnabled: runtime.reservationsEnabled,
      registry: runtime.policyRegistry || null,
      reputation: runtime.reputation || null,
      registryHasCode: Boolean(policyCode && policyCode !== "0x"),
      reputationHasCode: Boolean(reputationCode && reputationCode !== "0x")
    },
    paymaster: {
      enabled: config.botchain.paymasterEnabled && Boolean(runtime.paymasterUrl),
      configured: Boolean(runtime.paymasterUrl),
      scope: "policy_accounting",
      buyerGasSponsored: false
    },
    revenue: {
      creditedRecipient: config.meridian.sellerAddress || null,
      marketplaceFeeBps: config.meridian.marketplaceFeeBps,
      configurationSource: "meridian_command_centre",
      feeIncludedInPaymentRequirements: false
    },
    funding: {
      bridgeUrl: config.botchain.bridgeUrl,
      dexUrl: config.botchain.dexUrl,
      needsGas: nativeBalance === 0n,
      needsUsdt: tokenBalance === 0n,
      needsPermit2Approval: allowance === 0n
    }
  };
}
