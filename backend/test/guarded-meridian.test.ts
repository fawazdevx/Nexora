import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-guarded-meridian-"));
process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.MERIDIAN_PUBLIC_KEY = "pk_test_guarded";
process.env.MERIDIAN_SELLER_ADDRESS = "0x2222222222222222222222222222222222222222";

const {readStore, updateStore} = await import("../src/store.js");
const {
  buildMeridianPaymentRequirements,
  meridianNetworkConfig,
  settleGuardedMeridianPayment
} = await import("../src/x402/meridian-facilitator.js");

const network = "bot-chain-testnet" as const;
const config = meridianNetworkConfig(network);
const requirements = buildMeridianPaymentRequirements({
  network,
  amountBaseUnits: "1000000",
  resource: "https://api.example.com/guarded"
});

test.beforeEach(async () => {
  await updateStore((store) => {
    store.payments = [];
    store.notifications = [];
  });
});

test.after(async () => {
  await rm(tempDirectory, {recursive: true, force: true});
});

test("guarded Meridian blocks policy failures before relay and records a receipt", async () => {
  let relayed = false;
  const result = await settleGuardedMeridianPayment(
    {paymentPayload: validPayload("41"), paymentRequirements: requirements},
    {
      canSpend: async () => false,
      recordAccounting: async () => [],
      fetchImpl: async () => {
        relayed = true;
        throw new Error("must not relay");
      }
    }
  );

  assert.equal(result.success, false);
  assert.equal(relayed, false);
  assert.match(String(result.errorReason), /policy blocked/i);
  const store = await readStore();
  assert.equal(store.payments.length, 1);
  assert.equal(store.payments[0]?.status, "policy_blocked");
  assert.equal(store.payments[0]?.external?.provider, "meridian");
});

test("guarded Meridian settles once, records accounting, and replays the receipt", async () => {
  let relays = 0;
  let accountingCalls = 0;
  const dependencies = {
    canSpend: async () => true,
    recordAccounting: async () => {
      accountingCalls += 1;
      return [`0x${"ab".repeat(32)}`];
    },
    fetchImpl: async () => {
      relays += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({success: true, transaction: `0x${"cd".repeat(32)}`}),
        text: async () => ""
      };
    }
  };
  const input = {paymentPayload: validPayload("42"), paymentRequirements: requirements};
  const first = await settleGuardedMeridianPayment(input, dependencies);
  const replay = await settleGuardedMeridianPayment(input, dependencies);

  assert.equal(first.success, true);
  assert.equal(first.policy?.accountingStatus, "recorded");
  assert.equal(replay.success, true);
  assert.equal(replay.replay, true);
  assert.equal(relays, 1);
  assert.equal(accountingCalls, 1);
  assert.equal((await readStore()).payments.length, 1);
});

test("guarded Meridian locks later payments while policy accounting is pending", async () => {
  const dependencies = {
    canSpend: async () => true,
    recordAccounting: async () => {
      throw new Error("temporary RPC failure");
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({success: true, transaction: `0x${"ef".repeat(32)}`}),
      text: async () => ""
    })
  };
  const first = await settleGuardedMeridianPayment(
    {paymentPayload: validPayload("43"), paymentRequirements: requirements},
    dependencies
  );
  const second = await settleGuardedMeridianPayment(
    {paymentPayload: validPayload("44"), paymentRequirements: requirements},
    dependencies
  );

  assert.equal(first.success, true);
  assert.equal(first.policy?.accountingStatus, "pending");
  assert.equal(second.success, false);
  assert.match(String(second.errorReason), /waiting for policy accounting/i);
});

function validPayload(nonce: string) {
  return {
    x402Version: 1 as const,
    scheme: "exact" as const,
    network,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      owner: "0x1111111111111111111111111111111111111111",
      permit: {
        permitted: {token: config.asset, amount: "1000000"},
        nonce,
        deadline: String(Math.floor(Date.now() / 1_000) + 300)
      },
      witness: {to: config.facilitator, validAfter: "0"}
    }
  };
}
