import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-policy-chain-routing-"));
const arcPolicyRegistry = "0x1111111111111111111111111111111111111111";
const basePolicyRegistry = "0x2222222222222222222222222222222222222222";
const arbitrumPolicyRegistry = "0x3333333333333333333333333333333333333333";
const botTestnetPolicyRegistry = "0x4444444444444444444444444444444444444444";
const botMainnetPolicyRegistry = "0x5555555555555555555555555555555555555555";

process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.CIRCLE_API_KEY = "";
process.env.ARC_CHAIN_ID = "";
process.env.BASE_SEPOLIA_CHAIN_ID = "";
process.env.ARB_SEPOLIA_CHAIN_ID = "";
process.env.BOTCHAIN_TESTNET_CHAIN_ID = "";
process.env.BOTCHAIN_MAINNET_CHAIN_ID = "";
process.env.POLICY_REGISTRY_ADDRESS = arcPolicyRegistry;
process.env.BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS = basePolicyRegistry;
process.env.ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS = arbitrumPolicyRegistry;
process.env.BOTCHAIN_TESTNET_POLICY_REGISTRY_ADDRESS = botTestnetPolicyRegistry;
process.env.BOTCHAIN_MAINNET_POLICY_REGISTRY_ADDRESS = botMainnetPolicyRegistry;
process.env.NEXORA_ENABLE_BOTCHAIN_MAINNET = "true";

const [{chainContext, agentChainContexts}, {config}, {handleAppRequest}, {requiredChainId}] = await Promise.all([
  import("../src/chains.js"),
  import("../src/config.js"),
  import("../src/router.js"),
  import("../src/security.js")
]);

test.after(async () => {
  await rm(tempDirectory, {recursive: true, force: true});
});

test("canonical chain IDs survive empty environment values", () => {
  assert.equal(config.arc.chainId, 5042002);
  assert.equal(config.base.sepoliaChainId, 84532);
  assert.equal(config.arbitrum.sepoliaChainId, 421614);
  assert.equal(config.botchain.testnetChainId, 968);
  assert.equal(config.botchain.mainnetChainId, 677);
});

test("policy request validation accepts every enabled Nexora chain ID", () => {
  for (const chainId of [5042002, 84532, 421614, 968, 677]) {
    assert.equal(requiredChainId(chainId), chainId);
  }
  assert.throws(() => requiredChainId(0), /chainId must be a positive integer/);
  assert.throws(() => requiredChainId(1.5), /chainId must be a positive integer/);
});

test("Circle agent provisioning remains Arc-first and excludes external BOT wallets", () => {
  assert.deepEqual(
    agentChainContexts().map((context) => context.chainId),
    [5042002, 84532, 421614]
  );
});

test("Arc, Base, and Arbitrum policy registration requests pass chain validation", async () => {
  for (const route of [
    {chainId: 5042002, policyRegistry: arcPolicyRegistry},
    {chainId: 84532, policyRegistry: basePolicyRegistry},
    {chainId: 421614, policyRegistry: arbitrumPolicyRegistry}
  ]) {
    const response = await handleAppRequest({
      method: "POST",
      url: "http://localhost/api/agents/missing-agent/policies/register",
      body: {
        operatorAddress: "0x6666666666666666666666666666666666666666",
        chainId: route.chainId,
        policyRegistry: route.policyRegistry,
        dailyLimitUsdc: 100,
        transactionCapUsdc: 10,
        contractAllowlist: [],
        recipientAllowlist: []
      }
    });
    assert.equal(response.status, 400);
    assert.equal(
      (response.body as {error?: string}).error,
      "Circle API key is required for agent policy registration"
    );
  }
});

for (const route of [
  {
    name: "BOT Chain Testnet",
    chainId: 968,
    operatorAddress: "0x7777777777777777777777777777777777777777",
    policyRegistry: botTestnetPolicyRegistry
  },
  {
    name: "BOT Chain",
    chainId: 677,
    operatorAddress: "0x8888888888888888888888888888888888888888",
    policyRegistry: botMainnetPolicyRegistry
  }
]) {
  test(`${route.name} policy saves complete after the onchain transaction`, async () => {
    const context = chainContext(route.chainId);
    assert.equal(context.policyRegistry, route.policyRegistry);

    const profileResponse = await handleAppRequest({
      method: "POST",
      url: "http://localhost/api/agents/external-eoa",
      body: {
        operatorAddress: route.operatorAddress,
        chainId: route.chainId,
        policyRegistry: route.policyRegistry
      }
    });
    assert.equal(profileResponse.status, 200);
    const profile = profileResponse.body as {id: string};

    const txHash = `0x${(route.chainId === 968 ? "ab" : "cd").repeat(32)}`;
    const policyResponse = await handleAppRequest({
      method: "POST",
      url: `http://localhost/api/agents/${encodeURIComponent(profile.id)}/policies`,
      body: {
        operatorAddress: route.operatorAddress,
        chainId: route.chainId,
        dailyLimitUsdc: 100,
        transactionCapUsdc: 10,
        contractAllowlist: [],
        recipientAllowlist: [],
        txHash
      }
    });
    assert.equal(policyResponse.status, 200);
    assert.equal(
      (policyResponse.body as {policy?: {txHash?: string}}).policy?.txHash,
      txHash
    );
  });
}

test("BOT policy configuration mismatch is rejected before signing", async () => {
  const response = await handleAppRequest({
    method: "POST",
    url: "http://localhost/api/agents/external-eoa",
    body: {
      operatorAddress: "0x9999999999999999999999999999999999999999",
      chainId: 968,
      policyRegistry: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  });
  assert.equal(response.status, 400);
  assert.match(
    (response.body as {error?: string}).error ?? "",
    /does not match Nexora's configured proxy on BOT Chain Testnet/
  );
});
