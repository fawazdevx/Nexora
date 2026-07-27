import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test, {mock} from "node:test";

// Adversarial coverage for the money paths: intent lifecycle races, spend-window
// double-spend, settle-while-pending, expired-approval execution, concurrent
// daily-limit TOCTOU, and concurrent x402 request-hash replay. The Circle intent
// flow is driveable with a fake CLI runner; the x402 authorize path needs the
// viem public client stubbed so the ledger treasury check runs without a chain.

const operator = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const publisher = "0x3333333333333333333333333333333333333333";
const treasury = "0x4444444444444444444444444444444444444444";
const ledger = "0x5555555555555555555555555555555555555555";
const usdc = "0x6666666666666666666666666666666666666666";
const serviceUrl = "https://agents.circle.com/services/market-data";

type CircleCliRunner = (args: string[]) => Promise<{stdout: string; stderr: string}>;
type BackendModules = Awaited<ReturnType<typeof loadBackend>>;

let tempDir = "";
let backend: BackendModules;

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-money-adversarial-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  process.env.NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED = "true";
  process.env.X402_LEDGER_ADDRESS = ledger;
  process.env.TREASURY_ADDRESS = treasury;
  process.env.USDC_ADDRESS = usdc;

  // Stub the viem public client so authorizeX402's on-chain ledger treasury
  // check resolves to the configured treasury without hitting a real RPC.
  const realViem = await import("viem");
  mock.module("viem", {
    exports: {
      ...realViem,
      createPublicClient: () => ({
        readContract: async () => treasury,
        getTransactionReceipt: async () => ({logs: []})
      })
    }
  });

  backend = await loadBackend();
});

test.beforeEach(async () => {
  await backend.updateStore((store) => {
    store.agents = [];
    store.services = [];
    store.payments = [];
    store.paymentIntents = [];
    store.approvalRequests = [];
    store.notifications = [];
  });
});

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("settle-while-pending: an unapproved intent cannot be executed", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  const runner = payRunner();
  const intent = await createIntent(runner, {symbol: "BTC"});
  assert.equal(intent.status, "pending_approval");

  // Executing before approval must be rejected, and must not spend or settle.
  await assert.rejects(
    () => backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner}),
    /approved before execution/
  );

  const stored = await readIntent(intent.id);
  assert.equal(stored?.status, "pending_approval");
  assert.equal(await settledPaymentCount(), 0);
});

test("double-execute race: an approved intent settles at most once", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  const runner = payRunner();
  const intent = await createIntent(runner, {symbol: "BTC"});
  await backend.approveCircleAgentPaymentIntent(intent.id, {operatorAddress: operator});

  // Fire two executions concurrently against the same approved intent. The
  // executing-status guard should let exactly one through.
  const results = await Promise.allSettled([
    backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner}),
    backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner})
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one execution should succeed");
  assert.equal(rejected.length, 1, "the losing execution should be rejected");

  const stored = await readIntent(intent.id);
  assert.equal(stored?.status, "settled");
  // The core money invariant: no matter the race outcome, only one settled
  // payment is recorded for a single intent.
  assert.equal(await settledPaymentCount(), 1);
});

test("expired-approval execution: an approved-but-expired intent will not spend", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  const runner = payRunner();
  const intent = await createIntent(runner, {symbol: "BTC"});
  await backend.approveCircleAgentPaymentIntent(intent.id, {operatorAddress: operator});

  // Force the approval window into the past.
  await backend.updateStore((store) => {
    const stored = store.paymentIntents.find((item) => item.id === intent.id);
    if (stored) stored.approval.expiresAt = new Date(Date.now() - 60_000).toISOString();
  });

  await assert.rejects(
    () => backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner}),
    /expired/
  );

  const stored = await readIntent(intent.id);
  assert.equal(stored?.status, "expired");
  assert.equal(await settledPaymentCount(), 0);
});

test("cannot approve an expired intent", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  const runner = payRunner();
  const intent = await createIntent(runner, {symbol: "BTC"});
  await backend.updateStore((store) => {
    const stored = store.paymentIntents.find((item) => item.id === intent.id);
    if (stored) stored.approval.expiresAt = new Date(Date.now() - 60_000).toISOString();
  });

  await assert.rejects(
    () => backend.approveCircleAgentPaymentIntent(intent.id, {operatorAddress: operator}),
    /expired/
  );
  const stored = await readIntent(intent.id);
  assert.equal(stored?.status, "expired");
});

test("concurrent requestHash replay: the same authorization hash settles at most once", async () => {
  // authorizeX402 checks the request hash against a pre-write store snapshot,
  // then does async work (ledger check, policy eval) before writing. Two
  // concurrent authorizations of the same hash must still net exactly one
  // authorized payment — the write-time guard is what enforces that.
  await seedAgent({transactionCapUsdc: 100, dailyLimitUsdc: 100});
  await backend.updateStore((store) => {
    store.services.push({
      id: "svc-x402",
      chainServiceId: 1,
      publisherAddress: publisher,
      name: "x402 Service",
      endpointHash: "0x" + "0".repeat(64),
      pricePerUnitUsdc: 0.01,
      active: true,
      featured: false,
      createdAt: new Date().toISOString(),
      manifest: {
        kind: "generic",
        version: "1.0.0",
        description: "d",
        inputSchema: [],
        outputSchema: [],
        revenueMode: "per_execution",
        platformFeeBps: 0
      }
    });
  });

  const requestHash = "0x" + "9".repeat(64);
  const authorize = () => backend.authorizeX402({serviceId: "svc-x402", payer: operator, requestHash, units: 1});
  const results = await Promise.allSettled([authorize(), authorize()]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(fulfilled, 1, "exactly one authorization should succeed for a given request hash");

  const store = await backend.readStore();
  const authorizedWithHash = store.payments.filter(
    (p: {requestHash: string; status: string}) => p.requestHash === requestHash && p.status === "authorized"
  ).length;
  assert.equal(authorizedWithHash, 1, "a replayed request hash must not double-authorize");
});

test("double-spend across the daily limit: concurrent executions must not overspend", async () => {
  // Two units at 0.005 = 0.010 total. A 0.008 daily limit permits exactly one.
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 0.008});
  const runner = payRunner();

  // Two distinct intents (distinct requestHash), both approved while spend is 0.
  const a = await createIntent(runner, {symbol: "BTC"});
  const b = await createIntent(runner, {symbol: "ETH"});
  await backend.approveCircleAgentPaymentIntent(a.id, {operatorAddress: operator});
  await backend.approveCircleAgentPaymentIntent(b.id, {operatorAddress: operator});

  const results = await Promise.allSettled([
    backend.executeCircleAgentPaymentIntent(a.id, {operatorAddress: operator, confirmed: true}, {runner}),
    backend.executeCircleAgentPaymentIntent(b.id, {operatorAddress: operator, confirmed: true}, {runner})
  ]);

  const settledTotal = await settledSpendUsdc();
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  // Money invariant: settled spend must never exceed the daily limit, and at
  // most one of the two 0.005 payments should clear a 0.008 cap.
  assert.ok(settledTotal <= 0.008 + 1e-9, `settled spend ${settledTotal} exceeded daily limit 0.008`);
  assert.equal(fulfilled <= 1, true, "at most one execution should settle under the daily cap");
});

async function createIntent(runner: CircleCliRunner, data: Record<string, unknown>) {
  return backend.createCircleAgentPaymentIntent({
    operatorAddress: operator,
    agentId: "agent-1",
    walletAddress: wallet,
    serviceUrl,
    chain: "BASE_SEPOLIA",
    data
  }, {runner});
}

async function readIntent(id: string) {
  const store = await backend.readStore();
  return store.paymentIntents.find((item: {id: string}) => item.id === id) ?? null;
}

async function settledPaymentCount() {
  const store = await backend.readStore();
  return store.payments.filter((p: {status: string}) => p.status === "settled").length;
}

async function settledSpendUsdc() {
  const store = await backend.readStore();
  return store.payments
    .filter((p: {status: string}) => p.status === "settled")
    .reduce((sum: number, p: {amountUsdc: number}) => sum + p.amountUsdc, 0);
}

function payRunner(): CircleCliRunner {
  return fakeCircleRunner({
    inspect: {
      name: "Market Data",
      description: "Realtime crypto market data",
      url: serviceUrl,
      price: "0.005",
      payTo: publisher,
      accepts: [{chain: "BASE_SEPOLIA", scheme: "exact"}]
    },
    pay: {
      status: "success",
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      response: {symbol: "BTC", price: 65000}
    }
  });
}

function fakeCircleRunner(outputs: {search?: unknown; inspect?: unknown; pay?: unknown}): CircleCliRunner {
  return async (args: string[]) => {
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "--version") return {stdout: "circle/1.0.0\n", stderr: ""};
    if (command === "wallet status") return {stdout: JSON.stringify({authenticated: true}), stderr: ""};
    if (command === "services search") return {stdout: JSON.stringify(outputs.search ?? {services: []}), stderr: ""};
    if (command === "services inspect") return {stdout: JSON.stringify(outputs.inspect ?? {}), stderr: ""};
    if (command === "services pay") return {stdout: JSON.stringify(outputs.pay ?? {}), stderr: ""};
    throw new Error(`unexpected circle command: ${args.join(" ")}`);
  };
}

async function seedAgent(input: {transactionCapUsdc: number; dailyLimitUsdc: number}) {
  await backend.updateStore((store) => {
    store.agents.push({
      id: "agent-1",
      operatorAddress: operator,
      arcName: "policy-agent",
      address: wallet,
      circleWalletStatus: "ready",
      circleWalletSetId: null,
      circleWalletId: null,
      circleAccountType: null,
      settlementMode: null,
      chainWallets: [{
        chainId: 84532,
        chain: "Base Sepolia",
        circleBlockchain: "BASE-SEPOLIA",
        address: wallet,
        circleWalletId: "circle-wallet-base-sepolia",
        status: "ready",
        updatedAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      policy: {
        dailyLimitUsdc: input.dailyLimitUsdc,
        transactionCapUsdc: input.transactionCapUsdc,
        contractAllowlist: [],
        recipientAllowlist: [],
        active: true,
        v2: {
          weeklyLimitUsdc: 0,
          monthlyLimitUsdc: 0,
          maxUnitsPerRequest: 0,
          cooldownSeconds: 0,
          expiresAt: null,
          serviceAllowlist: [],
          requireOnchainPolicy: false
        }
      }
    });
  });
}

async function loadBackend() {
  const [circle, facilitator, store] = await Promise.all([
    import("../src/circle/agent-marketplace.js"),
    import("../src/x402/facilitator.js"),
    import("../src/store.js")
  ]);
  return {
    approveCircleAgentPaymentIntent: circle.approveCircleAgentPaymentIntent,
    createCircleAgentPaymentIntent: circle.createCircleAgentPaymentIntent,
    executeCircleAgentPaymentIntent: circle.executeCircleAgentPaymentIntent,
    authorizeX402: facilitator.authorizeX402,
    updateStore: store.updateStore,
    readStore: store.readStore
  };
}
