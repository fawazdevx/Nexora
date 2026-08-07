import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const operatorA = "0x1111111111111111111111111111111111111111";
const operatorB = "0x2222222222222222222222222222222222222222";

type StoreModule = typeof import("../src/store.js");

let tempDir = "";
let storeModule: StoreModule;

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-notification-bindings-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  storeModule = await import("../src/store.js");
});

test.beforeEach(async () => {
  await storeModule.updateStore((store) => {
    store.notificationPreferences = [];
    store.emailVerificationChallenges = [];
    store.notificationDeliveries = [];
  });
});

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("one normalized email address can belong to only one operator wallet", async () => {
  await verifyEmail(operatorA, "Owner@Example.com");

  await assert.rejects(
    () => storeModule.beginEmailNotificationVerification({
      operatorAddress: operatorB,
      email: "owner@example.com",
      codeHash: verificationHash("operator-b"),
      expiresAt: futureTimestamp()
    }),
    (error: unknown) => {
      assert.equal((error as {status?: number}).status, 409);
      assert.match((error as Error).message, /already linked to another Nexora account/);
      return true;
    }
  );

  const store = await storeModule.readStore();
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, "owner@example.com");
  assert.equal(storeModule.preferencesForOperator(store, operatorB).email, null);
});

test("clearing or replacing an email releases the previous address", async () => {
  await verifyEmail(operatorA, "first@example.com", "first");
  await verifyEmail(operatorA, "second@example.com", "second");
  const claimed = await verifyEmail(operatorB, "first@example.com", "reclaimed");

  assert.equal(claimed.email, "first@example.com");
  assert.ok(claimed.emailVerifiedAt);
});

test("concurrent claims for one email allow exactly one operator", async () => {
  const hashA = verificationHash("race-a");
  const hashB = verificationHash("race-b");
  await Promise.all([
    storeModule.beginEmailNotificationVerification({
      operatorAddress: operatorA,
      email: "race@example.com",
      codeHash: hashA,
      expiresAt: futureTimestamp()
    }),
    storeModule.beginEmailNotificationVerification({
      operatorAddress: operatorB,
      email: "race@example.com",
      codeHash: hashB,
      expiresAt: futureTimestamp()
    })
  ]);

  const results = await Promise.allSettled([
    storeModule.completeEmailNotificationVerification({
      operatorAddress: operatorA,
      email: "race@example.com",
      codeHash: hashA
    }),
    storeModule.completeEmailNotificationVerification({
      operatorAddress: operatorB,
      email: "race@example.com",
      codeHash: hashB
    })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("email addresses cannot be assigned through generic preferences", async () => {
  await assert.rejects(
    () => storeModule.updateNotificationPreferences({
      operatorAddress: operatorA,
      email: "owner@example.com"
    }),
    (error: unknown) => {
      assert.equal((error as {status?: number}).status, 400);
      assert.match((error as Error).message, /one-time code/);
      return true;
    }
  );
});

test("a replacement email does not release the verified address until its code succeeds", async () => {
  await verifyEmail(operatorA, "current@example.com", "current");
  const replacementHash = verificationHash("replacement");
  await storeModule.beginEmailNotificationVerification({
    operatorAddress: operatorA,
    email: "replacement@example.com",
    codeHash: replacementHash,
    expiresAt: futureTimestamp()
  });

  let store = await storeModule.readStore();
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, "current@example.com");

  await assert.rejects(
    () => verifyEmail(operatorB, "current@example.com", "conflict"),
    /already linked to another Nexora account/
  );

  await storeModule.completeEmailNotificationVerification({
    operatorAddress: operatorA,
    email: "replacement@example.com",
    codeHash: replacementHash
  });
  const rebound = await verifyEmail(operatorB, "current@example.com", "rebound");
  assert.equal(rebound.email, "current@example.com");

  store = await storeModule.readStore();
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, "replacement@example.com");
});

test("incorrect email codes are limited and never bind the address", async () => {
  await storeModule.beginEmailNotificationVerification({
    operatorAddress: operatorA,
    email: "attempts@example.com",
    codeHash: verificationHash("correct"),
    expiresAt: futureTimestamp(),
    maxAttempts: 2
  });

  await assert.rejects(
    () => storeModule.completeEmailNotificationVerification({
      operatorAddress: operatorA,
      email: "attempts@example.com",
      codeHash: verificationHash("wrong-1")
    }),
    /1 attempt remaining/
  );
  await assert.rejects(
    () => storeModule.completeEmailNotificationVerification({
      operatorAddress: operatorA,
      email: "attempts@example.com",
      codeHash: verificationHash("wrong-2")
    }),
    /Too many incorrect codes/
  );

  const store = await storeModule.readStore();
  assert.equal(storeModule.preferencesForOperator(store, operatorA).email, null);
  assert.equal(store.emailVerificationChallenges.length, 0);
});

test("email OTP requests are throttled per operator even when the target changes", async () => {
  await storeModule.beginEmailNotificationVerification({
    operatorAddress: operatorA,
    email: "first@example.com",
    codeHash: verificationHash("first"),
    expiresAt: futureTimestamp(),
    minResendIntervalMs: 60_000
  });

  await assert.rejects(
    () => storeModule.beginEmailNotificationVerification({
      operatorAddress: operatorA,
      email: "second@example.com",
      codeHash: verificationHash("second"),
      expiresAt: futureTimestamp(),
      minResendIntervalMs: 60_000
    }),
    (error: unknown) => {
      assert.equal((error as {status?: number}).status, 429);
      assert.match((error as Error).message, /before requesting another verification code/);
      return true;
    }
  );
});

test("Telegram chat IDs cannot be assigned through generic preferences", async () => {
  await assert.rejects(
    () => storeModule.updateNotificationPreferences({
      operatorAddress: operatorA,
      telegram: "123456789"
    }),
    (error: unknown) => {
      assert.equal((error as {status?: number}).status, 400);
      assert.match((error as Error).message, /Nexora bot link flow/);
      return true;
    }
  );
});

test("one Telegram chat can belong to only one operator and can be rebound after disconnect", async () => {
  await storeModule.beginTelegramNotificationLink({
    operatorAddress: operatorA,
    code: "code-a",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  await storeModule.completeTelegramNotificationLink({
    operatorAddress: operatorA,
    code: "code-a",
    chatId: "123456789",
    username: "owner"
  });

  await storeModule.beginTelegramNotificationLink({
    operatorAddress: operatorB,
    code: "code-b",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  await assert.rejects(
    () => storeModule.completeTelegramNotificationLink({
      operatorAddress: operatorB,
      code: "code-b",
      chatId: "123456789",
      username: "other"
    }),
    (error: unknown) => {
      assert.equal((error as {status?: number}).status, 409);
      assert.match((error as Error).message, /Telegram account is already linked/);
      return true;
    }
  );

  await storeModule.updateNotificationPreferences({
    operatorAddress: operatorA,
    telegram: null,
    channels: {telegram: false}
  });
  const rebound = await storeModule.completeTelegramNotificationLink({
    operatorAddress: operatorB,
    code: "code-b",
    chatId: "123456789",
    username: "other"
  });

  assert.equal(rebound.telegram, "123456789");
  assert.equal(rebound.channels.telegram, true);
});

async function verifyEmail(operatorAddress: string, email: string, seed = email) {
  const codeHash = verificationHash(seed);
  await storeModule.beginEmailNotificationVerification({
    operatorAddress,
    email,
    codeHash,
    expiresAt: futureTimestamp(),
    minResendIntervalMs: 0
  });
  return storeModule.completeEmailNotificationVerification({
    operatorAddress,
    email,
    codeHash
  });
}

function verificationHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function futureTimestamp() {
  return new Date(Date.now() + 60_000).toISOString();
}
