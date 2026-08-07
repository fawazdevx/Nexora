import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {privateKeyToAccount} from "viem/accounts";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const originalFetch = globalThis.fetch;
let tempDir = "";
let backend: typeof import("../src/router.js");

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-notification-auth-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  process.env.NEXORA_REQUIRE_SIGNED_AUTH = "false";
  process.env.NEXORA_AUTH_SECRET = "notification-auth-test-secret";
  process.env.RESEND_API_KEY = "re_test";
  process.env.NEXORA_EMAIL_FROM = "Nexora <notifications@nexora.test>";
  globalThis.fetch = async () => new Response(JSON.stringify({id: "email-test-id"}), {
    status: 200,
    headers: {"content-type": "application/json"}
  });
  backend = await import("../src/router.js");
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await rm(tempDir, {recursive: true, force: true});
});

test("email verification requests always require a session signed by the operator wallet", async () => {
  const unauthenticated = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/request",
    body: {operatorAddress: account.address, email: "secure@example.com"}
  });
  assert.equal(unauthenticated.status, 400);
  assert.match(String((unauthenticated.body as {error?: unknown}).error), /authentication required/);

  const nonceResponse = await backend.handleAppRequest({
    method: "POST",
    url: "/api/auth/nonce",
    body: {address: account.address}
  });
  const nonce = (nonceResponse.body as {nonce: string}).nonce;
  const signature = await account.signMessage({message: nonce});
  const authResponse = await backend.handleAppRequest({
    method: "POST",
    url: "/api/auth/verify",
    body: {address: account.address, nonce, signature}
  });
  const token = (authResponse.body as {token: string}).token;

  const authenticated = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/request",
    headers: {authorization: `Bearer ${token}`},
    body: {operatorAddress: account.address, email: "secure@example.com"}
  });
  assert.equal(authenticated.status, 200);
});
