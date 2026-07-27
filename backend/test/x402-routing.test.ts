import assert from "node:assert/strict";
import test from "node:test";

process.env.MERIDIAN_PUBLIC_KEY = process.env.MERIDIAN_PUBLIC_KEY ?? "pk_test_routing";

const {handleAppRequest} = await import("../src/router.js");

test("canonical public settle path cannot fall through to Marketplace authorization settlement", async () => {
  const response = await handleAppRequest({
    method: "POST",
    url: "/x402/settle",
    host: "localhost",
    body: {}
  });
  assert.equal(response.status, 400);
  const error = String((response.body as {error?: unknown}).error ?? "");
  assert.match(error, /paymentPayload is required/);
  assert.doesNotMatch(error, /authorizationId is required/);
});

test("Marketplace settlement remains isolated on its authorization-id endpoint", async () => {
  const response = await handleAppRequest({
    method: "POST",
    url: "/api/x402/settle",
    host: "localhost",
    body: {}
  });
  assert.equal(response.status, 400);
  assert.match(String((response.body as {error?: unknown}).error ?? ""), /authorizationId is required/);
});
