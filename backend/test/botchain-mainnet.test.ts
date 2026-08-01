import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-botchain-mainnet-"));
process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.NEXORA_ENABLE_BOTCHAIN_MAINNET = "true";
process.env.MERIDIAN_PUBLIC_KEY = "pk_test_mainnet";
process.env.MERIDIAN_SELLER_ADDRESS = "0x1111111111111111111111111111111111111111";
process.env.NEXORA_BOTCHAIN_MARKETPLACE_FEE_BPS = "200";
process.env.BOTCHAIN_MAINNET_POLICY_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
process.env.BOTCHAIN_MAINNET_REPUTATION_ADDRESS = "0x4444444444444444444444444444444444444444";
process.env.BOTCHAIN_MAINNET_POLICY_RELAYER_PRIVATE_KEY = `0x${"55".repeat(32)}`;
process.env.BOTCHAIN_MAINNET_POLICY_RESERVATIONS_ENABLED = "true";

const {readStore, updateStore} = await import("../src/store.js");
const {
  buildMeridianPaymentRequirements,
  enabledMeridianNetworks,
  meridianNetworkConfig,
  reconcileMeridianPaymentRecord,
  settleGuardedMeridianPayment
} = await import("../src/x402/meridian-facilitator.js");
const {createVComputePaymentQuote} = await import("../src/botchain/vcompute.js");

const network = "bot-chain" as const;
const net = meridianNetworkConfig(network);
const requirements = buildMeridianPaymentRequirements({
  network,
  amountBaseUnits: "1000000",
  resource: "https://api.example.com/mainnet-service"
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

test("BOT mainnet is advertised only from complete separate configuration", () => {
  const mainnet = enabledMeridianNetworks().find((candidate) => candidate.network === network);
  assert.equal(mainnet?.chainId, 677);
  assert.equal(requirements.extra.creditedRecipient, process.env.MERIDIAN_SELLER_ADDRESS);
  assert.equal("platform" in requirements, false);
  assert.equal("platformFeeBps" in requirements, false);
});

test("BOT mainnet reserves before relay and finalizes accounting after settlement", async () => {
  const calls: string[] = [];
  const result = await settleGuardedMeridianPayment({
    paymentPayload: validPayload("101"),
    paymentRequirements: requirements
  }, {
    canSpend: async () => {
      calls.push("policy");
      return true;
    },
    reserveAccounting: async () => {
      calls.push("reserve");
      return [`0x${"11".repeat(32)}`];
    },
    fetchImpl: async () => {
      calls.push("relay");
      return {
        ok: true,
        status: 200,
        json: async () => ({success: true, transaction: `0x${"22".repeat(32)}`}),
        text: async () => ""
      };
    },
    recordAccounting: async () => {
      calls.push("finalize");
      return [`0x${"33".repeat(32)}`];
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, ["policy", "reserve", "relay", "finalize"]);
  const payment = (await readStore()).payments[0];
  assert.equal(payment?.status, "settled");
  assert.equal(payment?.platformFeeUsdc, 0.02);
  assert.equal(payment?.publisherNetUsdc, 0.98);
  assert.equal(payment?.external?.reservationStatus, "finalized");
  assert.equal(payment?.external?.accountingStatus, "recorded");
});

test("BOT mainnet cancels a reservation when Meridian rejects settlement", async () => {
  const calls: string[] = [];
  const result = await settleGuardedMeridianPayment({
    paymentPayload: validPayload("102"),
    paymentRequirements: requirements
  }, {
    canSpend: async () => true,
    reserveAccounting: async () => {
      calls.push("reserve");
      return [`0x${"44".repeat(32)}`];
    },
    fetchImpl: async () => {
      calls.push("relay");
      return {
        ok: false,
        status: 402,
        json: async () => ({success: false, errorReason: "insufficient balance"}),
        text: async () => ""
      };
    },
    cancelAccounting: async () => {
      calls.push("cancel");
      return [`0x${"55".repeat(32)}`];
    },
    recordAccounting: async () => {
      throw new Error("must not finalize a failed settlement");
    }
  });

  assert.equal(result.success, false);
  assert.deepEqual(calls, ["reserve", "relay", "cancel"]);
  const payment = (await readStore()).payments[0];
  assert.equal(payment?.status, "failed");
  assert.equal(payment?.external?.reservationStatus, "cancelled");
  assert.equal(payment?.external?.accountingStatus, "recorded");
});

test("pending BOT accounting can be reconciled without replaying Meridian settlement", async () => {
  let relays = 0;
  const result = await settleGuardedMeridianPayment({
    paymentPayload: validPayload("103"),
    paymentRequirements: requirements
  }, {
    canSpend: async () => true,
    reserveAccounting: async () => [`0x${"66".repeat(32)}`],
    fetchImpl: async () => {
      relays += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({success: true, transaction: `0x${"77".repeat(32)}`}),
        text: async () => ""
      };
    },
    recordAccounting: async () => {
      throw new Error("temporary BOT RPC failure");
    }
  });
  assert.equal(result.success, true);
  const pending = (await readStore()).payments[0];
  assert.equal(pending?.external?.accountingStatus, "pending");

  const reconciled = await reconcileMeridianPaymentRecord(pending!, {
    recordAccounting: async () => [`0x${"88".repeat(32)}`]
  });
  assert.equal(reconciled, true);
  assert.equal(relays, 1);
  const updated = (await readStore()).payments[0];
  assert.equal(updated?.external?.accountingStatus, "recorded");
  assert.equal(updated?.external?.reservationStatus, "finalized");
  assert.equal(updated?.external?.accountingAttempts, 2);
});

test("vCompute quotes bind chain 677, measured units, policy service ID, and Marketplace attribution", () => {
  const quote = createVComputePaymentQuote({
    network,
    jobType: "inference",
    units: 100,
    provider: "https://compute.example.com"
  });
  assert.equal(quote.chainId, 677);
  assert.equal(quote.job.units, 100);
  assert.equal(quote.policy.requireServiceAllowlist, true);
  assert.equal(quote.pricing.marketplaceFeeBps, 200);
  assert.equal(
    quote.paymentRequirements.extra.creditedRecipient,
    process.env.MERIDIAN_SELLER_ADDRESS
  );
  assert.equal(quote.paymentRequirements.network, network);
});

function validPayload(nonce: string) {
  return {
    x402Version: 1 as const,
    scheme: "exact" as const,
    network,
    payload: {
      signature: `0x${"99".repeat(65)}`,
      owner: "0x9999999999999999999999999999999999999999",
      permit: {
        permitted: {token: net.asset, amount: "1000000"},
        nonce,
        deadline: String(Math.floor(Date.now() / 1_000) + 300)
      },
      witness: {to: net.facilitator, validAfter: "0"}
    }
  };
}
