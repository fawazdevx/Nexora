import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {privateKeyToAccount, type PrivateKeyAccount} from "viem/accounts";

const accountA = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const accountB = privateKeyToAccount("0x8b3a350cf5c34c9194ca3a545d1f33f2d663f312c3dc3b08246c4f6c6f8f9f2d");
const operatorA = accountA.address;
const operatorB = accountB.address;

type SentEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

let tempDir = "";
let backend: typeof import("../src/router.js");
let storeModule: typeof import("../src/store.js");
let sentEmails: SentEmail[] = [];
let failEmailDelivery = false;
let authHeadersA: Record<string, string>;
let authHeadersB: Record<string, string>;
const originalFetch = globalThis.fetch;

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-email-verification-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  process.env.NEXORA_REQUIRE_SIGNED_AUTH = "false";
  process.env.NEXORA_AUTH_SECRET = "email-verification-test-secret";
  process.env.RESEND_API_KEY = "re_test";
  process.env.NEXORA_EMAIL_FROM = "Nexora <notifications@nexora.test>";

  globalThis.fetch = async (input, init) => {
    if (String(input) !== "https://api.resend.com/emails") {
      throw new Error(`Unexpected fetch target: ${String(input)}`);
    }
    if (failEmailDelivery) {
      return new Response(JSON.stringify({message: "provider unavailable"}), {
        status: 503,
        headers: {"content-type": "application/json"}
      });
    }
    sentEmails.push(JSON.parse(String(init?.body)) as SentEmail);
    return new Response(JSON.stringify({id: "email-test-id"}), {
      status: 200,
      headers: {"content-type": "application/json"}
    });
  };

  backend = await import("../src/router.js");
  storeModule = await import("../src/store.js");
  authHeadersA = await authenticatedHeaders(accountA);
  authHeadersB = await authenticatedHeaders(accountB);
});

test.beforeEach(async () => {
  sentEmails = [];
  failEmailDelivery = false;
  await storeModule.updateStore((store) => {
    store.notificationPreferences = [];
    store.emailVerificationChallenges = [];
    store.notificationDeliveries = [];
  });
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  await rm(tempDir, {recursive: true, force: true});
});

test("email OTP request and verification bind the normalized address to the wallet", async () => {
  const requested = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/request",
    headers: authHeadersA,
    body: {
      operatorAddress: operatorA,
      email: "Owner@Example.com"
    }
  });

  assert.equal(requested.status, 200);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "owner@example.com");
  assert.match(sentEmails[0].subject, /Verify your Nexora notification email/);
  const code = sentEmails[0].text.match(/Verification code: (\d{6})/)?.[1];
  assert.ok(code);

  let store = await storeModule.readStore();
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, null);

  const verified = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/verify",
    headers: authHeadersA,
    body: {
      operatorAddress: operatorA,
      email: "owner@example.com",
      code
    }
  });

  assert.equal(verified.status, 200);
  assert.deepEqual(
    verified.body && typeof verified.body === "object"
      ? {
          verified: (verified.body as {verified?: unknown}).verified,
          email: (verified.body as {email?: unknown}).email
        }
      : null,
    {verified: true, email: "owner@example.com"}
  );

  store = await storeModule.readStore();
  const preferences = storeModule.preferencesForOperator(store, operatorA);
  assert.equal(preferences.email, "owner@example.com");
  assert.ok(preferences.emailVerifiedAt);
  assert.equal(preferences.channels.email, true);
  assert.equal(store.emailVerificationChallenges.length, 0);

  const partialUpdate = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/preferences",
    headers: authHeadersA,
    body: {
      operatorAddress: operatorA,
      events: {policyAlerts: false}
    }
  });
  assert.equal(partialUpdate.status, 200);
  store = await storeModule.readStore();
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, "owner@example.com");
});

test("a verified email cannot be requested by another operator", async () => {
  const requested = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/request",
    headers: authHeadersA,
    body: {operatorAddress: operatorA, email: "exclusive@example.com"}
  });
  const code = sentEmails[0].text.match(/Verification code: (\d{6})/)?.[1];
  assert.equal(requested.status, 200);
  assert.ok(code);
  assert.equal((await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/verify",
    headers: authHeadersA,
    body: {operatorAddress: operatorA, email: "exclusive@example.com", code}
  })).status, 200);

  const conflict = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/request",
    headers: authHeadersB,
    body: {operatorAddress: operatorB, email: "EXCLUSIVE@example.com"}
  });

  assert.equal(conflict.status, 409);
  assert.match(String((conflict.body as {error?: unknown}).error), /already linked to another Nexora account/);
  assert.equal(sentEmails.length, 1);
});

test("a provider failure removes the unusable OTP challenge", async () => {
  failEmailDelivery = true;
  const response = await backend.handleAppRequest({
    method: "POST",
    url: "/api/notifications/email/request",
    headers: authHeadersA,
    body: {operatorAddress: operatorA, email: "failed@example.com"}
  });

  assert.equal(response.status, 400);
  const store = await storeModule.readStore();
  assert.equal(store.emailVerificationChallenges.length, 0);
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, null);
});

async function authenticatedHeaders(account: PrivateKeyAccount) {
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
  return {authorization: `Bearer ${(authResponse.body as {token: string}).token}`};
}
