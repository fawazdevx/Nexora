import assert from "node:assert/strict";
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
    store.notificationDeliveries = [];
  });
});

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("one normalized email address can belong to only one operator wallet", async () => {
  await storeModule.updateNotificationPreferences({
    operatorAddress: operatorA,
    email: "Owner@Example.com"
  });

  await assert.rejects(
    () => storeModule.updateNotificationPreferences({
      operatorAddress: operatorB,
      email: "owner@example.com"
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
  await storeModule.updateNotificationPreferences({
    operatorAddress: operatorA,
    email: "first@example.com"
  });
  await storeModule.updateNotificationPreferences({
    operatorAddress: operatorA,
    email: "second@example.com"
  });
  const claimed = await storeModule.updateNotificationPreferences({
    operatorAddress: operatorB,
    email: "first@example.com"
  });

  assert.equal(claimed.email, "first@example.com");
});

test("concurrent claims for one email allow exactly one operator", async () => {
  const results = await Promise.allSettled([
    storeModule.updateNotificationPreferences({
      operatorAddress: operatorA,
      email: "race@example.com"
    }),
    storeModule.updateNotificationPreferences({
      operatorAddress: operatorB,
      email: "race@example.com"
    })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
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
