import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const publisher = "0x1111111111111111111111111111111111111111";
const payer = "0x2222222222222222222222222222222222222222";
const gatewayWallet = "0x3333333333333333333333333333333333333333";
const usdc = "0x4444444444444444444444444444444444444444";
const transaction = `0x${"ab".repeat(32)}`;
const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-gateway-seller-"));

process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.NEXORA_MARKETPLACE_PUBLISHER_ADDRESS = publisher;
process.env.NEXORA_PUBLIC_API_URL = "https://api.nexora.test";
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

const {
  circleGatewaySellerCatalog,
  executeCircleGatewaySellerRequest,
  resetCircleGatewaySellerCacheForTests,
  resolveCircleGatewaySellerRuntime
} = await import("../src/circle/gateway-seller.js");
const {handleAppRequest} = await import("../src/router.js");
const {inspectCircleAgentService} = await import("../src/circle/agent-marketplace.js");

test.after(async () => {
  globalThis.fetch = originalFetch;
  resetCircleGatewaySellerCacheForTests();
  await rm(tempDirectory, {recursive: true, force: true});
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

test("public catalog and routed seller endpoint expose the code-defined services", async () => {
  const catalog = circleGatewaySellerCatalog("https://api.nexora.test");
  assert.equal(catalog.ready, true);
  assert.equal(catalog.mode, "testnet");
  assert.equal(catalog.services.length, 6);
  assert.equal(catalog.services[0]?.resource, "https://api.nexora.test/api/circle/nanopayments/services/website-analyzer-v1");
  const inspected = await inspectCircleAgentService(catalog.services[0]?.resource ?? "", {
    enabled: true,
    trustedNexoraGatewayOrigin: "https://api.nexora.test"
  });
  assert.equal(inspected.service.priceUsdc, 0.025);
  assert.deepEqual(inspected.service.acceptedChains, ["ARC", "BASE_SEPOLIA", "ARB_SEPOLIA"]);

  const catalogResponse = await handleAppRequest({
    method: "GET",
    url: "https://api.nexora.test/api/marketplace/catalog",
    host: "api.nexora.test"
  });
  assert.equal(catalogResponse.status, 200);
  assert.equal((catalogResponse.body as {x402: {services: unknown[]}}).x402.services.length, 6);

  const discoveryResponse = await handleAppRequest({
    method: "GET",
    url: "https://api.nexora.test/.well-known/x402",
    host: "api.nexora.test"
  });
  assert.equal(discoveryResponse.status, 200);
  const discovery = discoveryResponse.body as {x402Version: number; resources: Array<{accepts: unknown[]}>};
  assert.equal(discovery.x402Version, 2);
  assert.equal(discovery.resources.length, 6);
  assert.equal(discovery.resources[0]?.accepts.length, 3);

  const unpaid = await handleAppRequest({
    method: "POST",
    url: "https://api.nexora.test/api/circle/nanopayments/services/contract-safety-check-v1",
    host: "api.nexora.test",
    body: {contract: "0x5555555555555555555555555555555555555555"}
  });
  assert.equal(unpaid.status, 402);
  assert.ok(unpaid.headers?.["payment-required"]);

  const required = JSON.parse(Buffer.from(unpaid.headers?.["payment-required"] ?? "", "base64").toString("utf8"));
  const paymentSignature = Buffer.from(JSON.stringify({
    x402Version: 2,
    accepted: required.accepts[0],
    payload: {signature: "0xtest"}
  })).toString("base64");
  const paid = await handleAppRequest({
    method: "POST",
    url: "https://api.nexora.test/api/circle/nanopayments/services/contract-safety-check-v1",
    host: "api.nexora.test",
    headers: {"payment-signature": paymentSignature},
    body: {contract: "0x5555555555555555555555555555555555555555"}
  });
  assert.equal(paid.status, 200);
  assert.ok(paid.headers?.["payment-response"]);
});

test("Gateway seller mainnet stays locked until both mainnet controls are enabled", () => {
  const locked = resolveCircleGatewaySellerRuntime({mode: "mainnet", enabled: true, agentMainnetsEnabled: false, networks: ""});
  assert.equal(locked.enabled, false);
  assert.equal(locked.mainnetLocked, true);

  const enabled = resolveCircleGatewaySellerRuntime({mode: "mainnet", enabled: true, agentMainnetsEnabled: true, networks: ""});
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.mainnetLocked, false);
  assert.deepEqual(enabled.networks.map((network) => network.network), ["eip155:8453", "eip155:42161"]);

  const invalid = resolveCircleGatewaySellerRuntime({
    mode: "testnet",
    enabled: true,
    agentMainnetsEnabled: false,
    networks: "eip155:8453"
  });
  assert.equal(invalid.enabled, false);
  assert.match(invalid.configurationError ?? "", /not allowed in this mode/);
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {"content-type": "application/json"}
  });
}
