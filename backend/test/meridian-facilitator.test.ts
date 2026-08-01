import assert from "node:assert/strict";
import test from "node:test";

// Config reads env at module load, and meridianConfigured() gates the settle
// relay. Set the key BEFORE importing the module so the configured path is live.
process.env.MERIDIAN_PUBLIC_KEY = process.env.MERIDIAN_PUBLIC_KEY ?? "pk_test_meridian";
process.env.MERIDIAN_SELLER_ADDRESS = process.env.MERIDIAN_SELLER_ADDRESS ?? "0x2222222222222222222222222222222222222222";
process.env.BOTCHAIN_TESTNET_POLICY_REGISTRY_ADDRESS = process.env.BOTCHAIN_TESTNET_POLICY_REGISTRY_ADDRESS ?? "0x3333333333333333333333333333333333333333";
process.env.BOTCHAIN_TESTNET_REPUTATION_ADDRESS = process.env.BOTCHAIN_TESTNET_REPUTATION_ADDRESS ?? "0x4444444444444444444444444444444444444444";
process.env.BOTCHAIN_POLICY_RELAYER_PRIVATE_KEY = process.env.BOTCHAIN_POLICY_RELAYER_PRIVATE_KEY ?? `0x${"55".repeat(32)}`;
process.env.NEXORA_ENABLE_BOTCHAIN_MAINNET = "false";

const {
  buildMeridianPaymentRequirements,
  isMeridianNetwork,
  meridianAmountToBaseUnits,
  meridianNetworkConfig,
  settleMeridianPayment,
  supportedMeridianKinds,
  verifyMeridianPayment
} = await import("../src/x402/meridian-facilitator.js");

const NETWORK = "bot-chain-testnet" as const;
const cfg = meridianNetworkConfig(NETWORK);

// A well-formed payload for the testnet network. Helper so each test tweaks one
// field to prove a single invariant.
function validPayload(overrides: Record<string, unknown> = {}) {
  const base = {
    x402Version: 1 as const,
    scheme: "exact" as const,
    network: NETWORK,
    payload: {
      signature: "0x" + "ab".repeat(65),
      owner: "0x1111111111111111111111111111111111111111",
      permit: {
        permitted: {token: cfg.asset, amount: "1000000"},
        nonce: "42",
        deadline: String(Math.floor(Date.now() / 1000) + 300)
      },
      witness: {to: cfg.facilitator, validAfter: "0"}
    }
  };
  return {...base, ...overrides};
}

const requirements = buildMeridianPaymentRequirements({
  network: NETWORK,
  amountBaseUnits: "1000000",
  resource: "https://api.example.com/paid"
});

test("isMeridianNetwork recognizes BotChain networks only", () => {
  assert.equal(isMeridianNetwork("bot-chain-testnet"), true);
  assert.equal(isMeridianNetwork("bot-chain"), true);
  assert.equal(isMeridianNetwork("eip155:968"), true);
  assert.equal(isMeridianNetwork("eip155:677"), true);
  assert.equal(isMeridianNetwork("arc-testnet"), false);
  assert.equal(isMeridianNetwork(undefined), false);
});

test("buildMeridianPaymentRequirements targets the facilitator, not a seller wallet", () => {
  assert.equal(requirements.payTo, cfg.facilitator);
  assert.equal(requirements.asset, cfg.asset);
  assert.equal(requirements.network, NETWORK);
  assert.equal(requirements.maxAmountRequired, "1000000");
  assert.equal(requirements.extra.name, "USDT");
  assert.equal(requirements.extra.creditedRecipient, process.env.MERIDIAN_SELLER_ADDRESS);
});

test("buildMeridianPaymentRequirements rejects non-integer or zero amounts", () => {
  assert.throws(() => buildMeridianPaymentRequirements({network: NETWORK, amountBaseUnits: "0", resource: "r"}));
  assert.throws(() => buildMeridianPaymentRequirements({network: NETWORK, amountBaseUnits: "1.5", resource: "r"}));
});

test("meridianAmountToBaseUnits scales by configured decimals (never assumes 6)", () => {
  const scaled = meridianAmountToBaseUnits(NETWORK, 1);
  assert.equal(scaled, (10n ** BigInt(cfg.assetDecimals)).toString());
  assert.throws(() => meridianAmountToBaseUnits(NETWORK, 0));
  assert.throws(() => meridianAmountToBaseUnits(NETWORK, -1));
});

test("supportedMeridianKinds advertises the Permit2 settlement path when configured", () => {
  const kinds = supportedMeridianKinds();
  assert.ok(Array.isArray(kinds));
  assert.ok(kinds.some((k) => k.network === NETWORK));
  assert.ok(!kinds.some((k) => k.network === "bot-chain"));
});

test("settle relays a valid payload and maps a successful Meridian response", async () => {
  let sentUrl = "";
  let sentBody: Record<string, unknown> = {};
  const result = await settleMeridianPayment(
    {paymentPayload: validPayload(), paymentRequirements: requirements},
    {
      fetchImpl: async (url, init) => {
        sentUrl = url;
        sentBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({success: true, transaction: "0xdeadbeef"}),
          text: async () => ""
        };
      }
    }
  );
  assert.equal(result.success, true);
  assert.equal(result.transaction, "0xdeadbeef");
  assert.equal(result.network, NETWORK);
  assert.match(sentUrl, /\/settle$/);
  // The relay must forward server-rebuilt requirements, not blindly echo input.
  const sentRequirements = sentBody.paymentRequirements as {
    payTo: string;
    extra: {creditedRecipient: string};
    platform?: string;
    platformFeeBps?: number;
  };
  assert.equal(sentRequirements.payTo, cfg.facilitator);
  assert.equal(sentRequirements.extra.creditedRecipient, process.env.MERIDIAN_SELLER_ADDRESS);
  assert.equal("platform" in sentRequirements, false);
  assert.equal("platformFeeBps" in sentRequirements, false);
});

test("settle rejects a payload whose witness.to is not the facilitator (fund redirection)", async () => {
  const bad = validPayload({
    payload: {
      ...validPayload().payload,
      witness: {to: "0x9999999999999999999999999999999999999999", validAfter: "0"}
    }
  });
  let relayed = false;
  const result = await settleMeridianPayment(
    {paymentPayload: bad as never, paymentRequirements: requirements},
    {fetchImpl: async () => { relayed = true; throw new Error("must not reach network"); }}
  );
  assert.equal(relayed, false);
  assert.equal(result.success, false);
  assert.match(String(result.errorReason), /authorization is invalid/i);
});

test("settle rejects a permit amount below the required amount", async () => {
  const short = validPayload();
  short.payload.permit.permitted.amount = "999999";
  let relayed = false;
  const result = await settleMeridianPayment(
    {paymentPayload: short as never, paymentRequirements: requirements},
    {fetchImpl: async () => { relayed = true; throw new Error("must not reach network"); }}
  );
  assert.equal(relayed, false);
  assert.equal(result.success, false);
  assert.match(String(result.errorReason), /amount does not match/i);
});

test("verify accepts documented BOT testnet alias and CAIP-2 network ids", () => {
  const alias = verifyMeridianPayment({paymentPayload: validPayload(), paymentRequirements: requirements});
  assert.equal(alias.isValid, true, alias.invalidReason);
  const caip = verifyMeridianPayment({
    paymentPayload: {...validPayload(), network: "eip155:968"},
    paymentRequirements: {...requirements, network: "eip155:968"}
  });
  assert.equal(caip.isValid, true, caip.invalidReason);
});

test("settle rejects a permit token that does not match the payment asset", async () => {
  const wrongToken = validPayload();
  wrongToken.payload.permit.permitted.token = "0x0000000000000000000000000000000000000001";
  let relayed = false;
  const result = await settleMeridianPayment(
    {paymentPayload: wrongToken as never, paymentRequirements: requirements},
    {fetchImpl: async () => { relayed = true; throw new Error("must not reach network"); }}
  );
  assert.equal(relayed, false);
  assert.equal(result.success, false);
  assert.match(String(result.errorReason), /token does not match/i);
});

test("settle maps a failed Meridian HTTP response to an error result", async () => {
  const result = await settleMeridianPayment(
    {paymentPayload: validPayload(), paymentRequirements: requirements},
    {
      fetchImpl: async () => ({
        ok: false,
        status: 402,
        json: async () => ({success: false, errorReason: "insufficient balance"}),
        text: async () => ""
      })
    }
  );
  assert.equal(result.success, false);
  assert.equal(result.errorReason, "The BOT Chain wallet does not have enough USDT or gas for this payment.");
});

test("settle reports an unreachable service instead of throwing", async () => {
  const result = await settleMeridianPayment(
    {paymentPayload: validPayload(), paymentRequirements: requirements},
    {fetchImpl: async () => { throw new Error("network down"); }}
  );
  assert.equal(result.success, false);
  assert.match(String(result.errorReason), /temporarily unreachable/);
});
