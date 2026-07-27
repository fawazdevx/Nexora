import assert from "node:assert/strict";
import test from "node:test";

const publisher = "0x1111111111111111111111111111111111111111";
const payer = "0x2222222222222222222222222222222222222222";
const gatewayWallet = "0x3333333333333333333333333333333333333333";
const usdc = "0x4444444444444444444444444444444444444444";
const transaction = `0x${"ab".repeat(32)}`;

process.env.NEXORA_MARKETPLACE_PUBLISHER_ADDRESS = publisher;
process.env.CIRCLE_GATEWAY_FACILITATOR_URL = "https://gateway.example.test";
process.env.NEXORA_CIRCLE_GATEWAY_SELLER_ENABLED = "true";

const originalFetch = globalThis.fetch;
const requests: string[] = [];
globalThis.fetch = async (url, init) => {
  const target = String(url);
  requests.push(target);
  if (target.endsWith("/v1/x402/supported")) {
    return jsonResponse({
      kinds: [5042002, 84532, 421614].map((chainId) => ({
        x402Version: 2,
        scheme: "exact",
        network: `eip155:${chainId}`,
        extra: {
          verifyingContract: gatewayWallet,
          assets: [{symbol: "USDC", address: usdc}]
        }
      })),
      extensions: [],
      signers: {}
    });
  }
  if (target.endsWith("/v1/x402/verify")) return jsonResponse({isValid: true, payer});
  if (target.endsWith("/v1/x402/settle")) {
    assert.equal(init?.method, "POST");
    return jsonResponse({success: true, transaction, network: "eip155:5042002", payer});
  }
  throw new Error(`unexpected Circle request ${target}`);
};

const {executeCircleGatewaySellerRequest, resetCircleGatewaySellerCacheForTests} = await import("../src/circle/gateway-seller.js");

test.after(() => {
  globalThis.fetch = originalFetch;
  resetCircleGatewaySellerCacheForTests();
});

test("Circle Gateway seller returns a three-network 402 and executes after paid settlement", async () => {
  const endpointHash = "contract-safety-check-v1";
  const resourceUrl = `https://api.nexora.test/api/circle/nanopayments/services/${endpointHash}`;
  const unpaid = await executeCircleGatewaySellerRequest({
    endpointHash,
    args: {contract: "0x5555555555555555555555555555555555555555"},
    resourceUrl
  });
  assert.equal(unpaid.status, 402);
  const paymentRequired = JSON.parse(Buffer.from(unpaid.headers["payment-required"] ?? "", "base64").toString("utf8"));
  assert.equal(paymentRequired.x402Version, 2);
  assert.deepEqual(paymentRequired.accepts.map((item: {network: string}) => item.network), [
    "eip155:5042002",
    "eip155:84532",
    "eip155:421614"
  ]);
  assert.ok(paymentRequired.accepts.every((item: {amount: string}) => item.amount === "15000"));

  const selected = paymentRequired.accepts[0];
  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: selected,
    payload: {signature: "0xtest"}
  })).toString("base64");
  const paid = await executeCircleGatewaySellerRequest({
    endpointHash,
    args: {contract: "0x5555555555555555555555555555555555555555"},
    paymentSignature,
    resourceUrl
  });
  assert.equal(paid.status, 200);
  assert.equal((paid.body as {payment: {verified: boolean}}).payment.verified, true);
  assert.equal((paid.body as {service: {endpointHash: string}}).service.endpointHash, endpointHash);
  assert.ok(paid.headers["payment-response"]);
  assert.ok(requests.some((url) => url.endsWith("/v1/x402/verify")));
  assert.ok(requests.some((url) => url.endsWith("/v1/x402/settle")));
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {"content-type": "application/json"}
  });
}

