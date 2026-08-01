import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaymentRequirements,
  createMeridianPaymentRequirements,
  encodeX402Header,
  networkForX402Version,
  NexoraX402Client,
  parsePaymentSignatureHeader,
  paymentRequiredResponseForVersion,
  withNexoraX402
} from "../dist/index.js";

const config = {
  facilitatorUrl: "https://facilitator.example",
  payTo: "0x1111111111111111111111111111111111111111",
  asset: "0x2222222222222222222222222222222222222222",
  price: "0.05",
  network: "base-sepolia"
};

test("creates v1 and v2 payment challenges with the correct network format", () => {
  const requirements = createPaymentRequirements(config);
  assert.equal(paymentRequiredResponseForVersion(requirements, 1).accepts[0].network, "base-sepolia");
  assert.equal(paymentRequiredResponseForVersion(requirements, 2).accepts[0].network, "eip155:84532");
  assert.equal(networkForX402Version("arbitrum-sepolia", 2), "eip155:421614");
});

test("round-trips both payment header formats", () => {
  const payload = {x402Version: 2, scheme: "exact", network: "eip155:84532", payload: {authorization: {nonce: "0x1"}}};
  const encoded = encodeX402Header(payload);
  assert.deepEqual(parsePaymentSignatureHeader(encoded), payload);
  assert.deepEqual(parsePaymentSignatureHeader(JSON.stringify(payload)), payload);
});

test("Next middleware returns a decodable v2 PAYMENT-REQUIRED header", async () => {
  const route = withNexoraX402({...config, x402Version: 2, settle: false}, async () => Response.json({ok: true}));
  const response = await route(new Request("https://seller.example/paid"));
  assert.equal(response.status, 402);
  const header = response.headers.get("PAYMENT-REQUIRED");
  assert.ok(header);
  assert.equal(parsePaymentSignatureHeader(header)?.x402Version, 2);
});

test("facilitator client uses collision-free Nexora API endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({isValid: true, success: true, kinds: []}), {
      status: 200,
      headers: {"content-type": "application/json"}
    });
  };
  try {
    const client = new NexoraX402Client("https://facilitator.example/");
    const payload = {x402Version: 1, scheme: "exact", network: "arc-testnet", payload: {signature: "0x", authorization: {from: config.payTo, to: config.payTo, value: "1", validAfter: "0", validBefore: "1", nonce: `0x${"0".repeat(64)}`}}};
    const requirements = createPaymentRequirements({...config, amountAtomic: "1", x402Version: 1});
    await client.supported();
    await client.verify(payload, requirements);
    await client.settle(payload, requirements);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(urls, [
    "https://facilitator.example/api/x402/supported",
    "https://facilitator.example/api/x402/verify",
    "https://facilitator.example/api/x402/facilitator-settle"
  ]);
});

test("BOT Chain requirements use documented testnet identity and Permit2-compatible x402 v1", () => {
  const bot = createMeridianPaymentRequirements({
    facilitatorUrl: "https://facilitator.example",
    amountAtomic: "10000",
    resource: "https://seller.example/paid"
  });
  assert.equal(bot.network, "bot-chain-testnet");
  assert.equal(bot.extra.name, "USDT");
  assert.equal(bot.extra.version, "1");
  assert.equal(bot.extra.x402Version, 1);
  assert.equal(bot.payTo, "0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A");
  assert.equal(bot.asset, "0x75edC9335175Fc0552D51D48439F229c10420fe3");
  assert.throws(() => createPaymentRequirements({...config, network: "bot-chain-testnet", x402Version: 2}), /require x402Version 1/);
});

test("BOT Chain mainnet requirements use chain 677 defaults and marketplace attribution", () => {
  const bot = createMeridianPaymentRequirements({
    facilitatorUrl: "https://facilitator.example",
    network: "bot-chain",
    amountAtomic: "250000",
    resource: "https://seller.example/mainnet-paid",
    creditedRecipient: "0x3333333333333333333333333333333333333333"
  });
  assert.equal(bot.network, "bot-chain");
  assert.equal(bot.payTo, "0x8E7769D440b3460b92159Dd9C6D17302b036e2d6");
  assert.equal(bot.asset, "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C");
  assert.equal(bot.extra.creditedRecipient, "0x3333333333333333333333333333333333333333");
  assert.equal(networkForX402Version("bot-chain", 2), "eip155:677");
});

test("Meridian marketplace attribution rejects an invalid credited recipient", () => {
  const base = {
    facilitatorUrl: "https://facilitator.example",
    amountAtomic: "10000",
    resource: "https://seller.example/paid"
  };
  assert.throws(
    () => createMeridianPaymentRequirements({...base, creditedRecipient: "not-an-address"}),
    /creditedRecipient must be an EVM address/
  );
});

test("Circle Agent Stack helpers preserve approval and external receipt routes", async () => {
  const calls = [];
  const client = new NexoraX402Client("https://facilitator.example", {
    authorizationToken: "signed-session",
    fetch: async (url, init) => {
      calls.push({url: String(url), method: init?.method, authorization: new Headers(init?.headers).get("authorization")});
      return new Response(JSON.stringify({id: "intent-1", intentId: "intent-1", status: "approved", approved: true, expiresAt: null, payment: {}}), {
        status: 200,
        headers: {"content-type": "application/json"}
      });
    }
  });
  await client.createCirclePaymentIntent({
    operatorAddress: config.payTo,
    agentId: "agent-1",
    walletAddress: config.payTo,
    serviceUrl: "https://service.example/paid",
    chain: "BASE_SEPOLIA",
    data: {query: "btc"}
  });
  await client.circlePaymentIntentAuthorization("intent-1", config.payTo);
  await client.completeCirclePaymentIntent("intent-1", {
    operatorAddress: config.payTo,
    paymentResponse: {success: true, transaction: `0x${"ab".repeat(32)}`}
  });

  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "POST"]);
  assert.ok(calls[1].url.includes("/api/payment-intents/intent-1/authorization?"));
  assert.ok(calls[2].url.endsWith("/api/payment-intents/intent-1/external-receipt"));
  assert.ok(calls.every((call) => call.authorization === "Bearer signed-session"));
});
