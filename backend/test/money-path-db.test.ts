import assert from "node:assert/strict";
import test, {mock} from "node:test";

// DB-mode adversarial coverage for the money path (task 3). In file mode the
// in-process cache + write queue serialize every write, so the invariants hold
// incidentally. In DB mode payments/intents live in their own tables and the
// global app_store lock is gone, so the invariants must be enforced by Postgres
// directly: the partial unique index for request-hash replay, and a per-agent
// advisory lock (withAgentSpendLock) for the daily-limit check-then-settle.
//
// These require a real Postgres. When TEST_DATABASE_URL is unset the whole
// suite skips cleanly (no Postgres reachable in the default dev/CI sandbox).
// Run locally/CI with:  TEST_DATABASE_URL=postgres://... npm test

const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const describe = databaseUrl ? test : test.skip;

const operator = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const publisher = "0x3333333333333333333333333333333333333333";
const treasury = "0x4444444444444444444444444444444444444444";
const ledger = "0x5555555555555555555555555555555555555555";
const usdc = "0x6666666666666666666666666666666666666666";
const serviceUrl = "https://agents.circle.com/services/market-data";

type CircleCliRunner = (args: string[]) => Promise<{stdout: string; stderr: string}>;
type BackendModules = Awaited<ReturnType<typeof loadBackend>>;

let backend: BackendModules;

test.before(async () => {
  if (!databaseUrl) return;
  process.env.DATABASE_URL = databaseUrl;
  process.env.NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED = "true";
  process.env.X402_LEDGER_ADDRESS = ledger;
  process.env.TREASURY_ADDRESS = treasury;
  process.env.USDC_ADDRESS = usdc;

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
  if (!databaseUrl) return;
  // Truncate the money-path tables and reset the blob so each case starts clean.
  const {Pool} = await import("pg");
  const pool = new Pool({connectionString: databaseUrl});
  try {
    await pool.query("truncate table payments, payment_intents");
    await pool.query("delete from app_store");
  } finally {
    await pool.end();
  }
  await backend.updateStore((store) => {
    store.agents = [];
    store.services = [];
    store.payments = [];
    store.paymentIntents = [];
    store.approvalRequests = [];
    store.notifications = [];
  });
});

describe("DB replay: a settled request hash is enforced unique by the partial index", async () => {
  await seedX402Service();
  const requestHash = "0x" + "9".repeat(64);
  const authorize = () => backend.authorizeX402({serviceId: "svc-x402", payer: operator, requestHash, units: 1});
  const results = await Promise.allSettled([authorize(), authorize(), authorize()]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(fulfilled, 1, "exactly one authorization should win the request hash");

  const store = await backend.readStore();
  const active = store.payments.filter(
    (p: {requestHash: string; status: string}) =>
      p.requestHash === requestHash && (p.status === "authorized" || p.status === "settled")
  ).length;
  assert.equal(active, 1, "the partial unique index must reject a second active row");
});

describe("DB daily-limit: concurrent same-agent executions serialize under the advisory lock", async () => {
  // 0.005 per call, 0.008 daily cap → at most one of two may settle.
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 0.008});
  const runner = payRunner();
  const a = await createIntent(runner, {symbol: "BTC"});
  const b = await createIntent(runner, {symbol: "ETH"});
  await backend.approveCircleAgentPaymentIntent(a.id, {operatorAddress: operator});
  await backend.approveCircleAgentPaymentIntent(b.id, {operatorAddress: operator});

  const results = await Promise.allSettled([
    backend.executeCircleAgentPaymentIntent(a.id, {operatorAddress: operator, confirmed: true}, {runner}),
    backend.executeCircleAgentPaymentIntent(b.id, {operatorAddress: operator, confirmed: true}, {runner})
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const settledTotal = await settledSpendUsdc();
  assert.ok(settledTotal <= 0.008 + 1e-9, `settled spend ${settledTotal} exceeded daily limit 0.008`);
  assert.equal(fulfilled <= 1, true, "at most one execution may settle under the daily cap");
});

async function createIntent(runner: CircleCliRunner, data: Record<string, unknown>) {
  return backend.createCircleAgentPaymentIntent({
    operatorAddress: operator,
    agentId: "agent-1",
    walletAddress: wallet,
    serviceUrl,
    chain: "BASE",
    data
  }, {runner});
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
      accepts: [{chain: "BASE", scheme: "exact"}]
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
    if (command === "services search") return {stdout: JSON.stringify(outputs.search ?? {services: []}), stderr: ""};
    if (command === "services inspect") return {stdout: JSON.stringify(outputs.inspect ?? {}), stderr: ""};
    if (command === "services pay") return {stdout: JSON.stringify(outputs.pay ?? {}), stderr: ""};
    throw new Error(`unexpected circle command: ${args.join(" ")}`);
  };
}

async function seedX402Service() {
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
