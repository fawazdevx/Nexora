import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const operator = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const publisher = "0x3333333333333333333333333333333333333333";
const serviceUrl = "https://agents.circle.com/services/market-data";

type CircleCliRunner = (args: string[]) => Promise<{stdout: string; stderr: string}>;
type DiscoveryFetcher = (url: string) => Promise<unknown>;
type BackendModules = Awaited<ReturnType<typeof loadBackend>>;

let tempDir = "";
let backend: BackendModules;

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-circle-marketplace-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  process.env.NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED = "true";
  backend = await loadBackend();
});

test.beforeEach(async () => {
  await backend.updateStore((store) => {
    store.agents = [];
    store.payments = [];
    store.paymentIntents = [];
    store.approvalRequests = [];
    store.notifications = [];
  });
});

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("circleAgentMarketplaceReadiness reports missing CLI without throwing", async () => {
  const readiness = await backend.circleAgentMarketplaceReadiness({
    enabled: true,
    runner: async () => {
      const error = new Error("spawn circle ENOENT") as Error & {code?: string};
      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "cli_missing");
  assert.equal(readiness.requiredEnv.includes("NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED"), true);
});

test("circleAgentMarketplaceReadiness classifies empty wallet status failures as not logged in", async () => {
  const readiness = await backend.circleAgentMarketplaceReadiness({
    enabled: true,
    runner: async (args) => {
      if (args[0] === "--version") return {stdout: "", stderr: ""};
      if (args[0] === "wallet" && args[1] === "status") {
        const error = new Error("Command failed: circle wallet status") as Error & {code?: number; stdout?: string; stderr?: string};
        error.code = 1;
        error.stdout = "";
        error.stderr = "";
        throw error;
      }
      throw new Error(`unexpected circle command: ${args.join(" ")}`);
    }
  });

  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "not_logged_in");
  assert.equal(readiness.message, "Connect your Circle agent wallet to enable real service payments.");
  assert.doesNotMatch(readiness.message, /CLI|Command failed|backend|shell|network|session/i);
});

test("buildCircleCliEnv suppresses Node deprecation warnings from Circle CLI", async () => {
  const env = backend.buildCircleCliEnv({
    ...process.env,
    NODE_OPTIONS: "--throw-deprecation --max-http-header-size=262144 --trace-warnings"
  });

  assert.equal(env.NODE_NO_WARNINGS, "1");
  assert.match(env.NODE_OPTIONS ?? "", /--no-deprecation/);
  assert.match(env.NODE_OPTIONS ?? "", /--max-http-header-size=262144/);
  assert.doesNotMatch(env.NODE_OPTIONS ?? "", /--throw-deprecation/);
  assert.doesNotMatch(env.NODE_OPTIONS ?? "", /--trace-warnings/);
});

test("circleAgentMarketplaceReadiness reports blank version failures with actionable status text", async () => {
  const readiness = await backend.circleAgentMarketplaceReadiness({
    enabled: true,
    runner: async (args) => {
      if (args[0] === "--version") {
        const error = new Error("Command failed: circle --version") as Error & {code?: number; stdout?: string; stderr?: string};
        error.code = 1;
        error.stdout = "";
        error.stderr = "";
        throw error;
      }
      throw new Error(`unexpected circle command: ${args.join(" ")}`);
    }
  });

  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "wallet_status_error");
  assert.equal(readiness.message, "Circle payments are temporarily unavailable. Please try again shortly.");
  assert.doesNotMatch(readiness.message, /CLI|Command failed|circle --version|backend|shell|network|session/i);
});

test("circleAgentMarketplaceReadiness prefers wallet login status when version probing is noisy", async () => {
  const readiness = await backend.circleAgentMarketplaceReadiness({
    enabled: true,
    runner: async (args) => {
      if (args[0] === "--version") {
        const error = new Error("Command failed: circle --version") as Error & {code?: number; stdout?: string; stderr?: string};
        error.code = 1;
        error.stdout = "";
        error.stderr = "";
        throw error;
      }
      if (args[0] === "wallet" && args[1] === "status") {
        const error = new Error("Error: Not logged in. Run 'circle wallet login <email> --type agent' to authenticate.") as Error & {code?: number; stdout?: string; stderr?: string};
        error.code = 1;
        error.stdout = "";
        error.stderr = "Not logged in";
        throw error;
      }
      throw new Error(`unexpected circle command: ${args.join(" ")}`);
    }
  });

  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "not_logged_in");
  assert.equal(readiness.message, "Connect your Circle agent wallet to enable real service payments.");
  assert.doesNotMatch(readiness.message, /CLI|Command failed|circle --version|backend|shell|network|session/i);
});

test("Circle marketplace search rejects blank CLI output with public-safe copy", async () => {
  await assert.rejects(
    () => backend.searchCircleAgentServices("market", {
      runner: async (args) => {
        if (args.slice(0, 2).join(" ") === "services search") return {stdout: "", stderr: ""};
        throw new Error(`unexpected circle command: ${args.join(" ")}`);
      },
      discoveryFetch: async () => {
        throw new Error("offline");
      }
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error ? error.message : "", "Circle service search is temporarily unavailable. Please try again shortly.");
      assert.doesNotMatch(error instanceof Error ? error.message : "", /CLI|Command failed|backend|shell|network|server|circle services/i);
      return true;
    }
  );
});

test("Circle marketplace search falls back to Circle Discovery API when CLI discovery is unavailable", async () => {
  const runner: CircleCliRunner = async (args) => {
    if (args.slice(0, 2).join(" ") === "services search") {
      const error = new Error("Command failed: circle services search market --output json") as Error & {stdout?: string; stderr?: string};
      error.stdout = "";
      error.stderr = "";
      throw error;
    }
    throw new Error(`unexpected circle command: ${args.join(" ")}`);
  };
  const discoveryFetch: DiscoveryFetcher = async () => ({
    x402Version: 2,
    items: [discoveryService()]
  });

  const search = await backend.searchCircleAgentServices("market", {runner, discoveryFetch});

  assert.equal(search.services[0]?.name, "AIsa API");
  assert.equal(search.services[0]?.url, serviceUrl);
  assert.equal(search.services[0]?.priceUsdc, 0.00044);
  assert.equal(search.services[0]?.publisherAddress, publisher);
  assert.equal(search.services[0]?.acceptedChains.includes("BASE"), true);
});

test("Circle marketplace search falls back to Circle Discovery API when CLI returns no services", async () => {
  const runner: CircleCliRunner = async (args) => {
    if (args.slice(0, 2).join(" ") === "services search") return {stdout: JSON.stringify({services: []}), stderr: ""};
    throw new Error(`unexpected circle command: ${args.join(" ")}`);
  };
  const discoveryFetch: DiscoveryFetcher = async () => ({
    x402Version: 2,
    items: [discoveryService()]
  });

  const search = await backend.searchCircleAgentServices("market", {runner, discoveryFetch});

  assert.equal(search.services[0]?.name, "AIsa API");
  assert.equal(search.services[0]?.priceUsdc, 0.00044);
});

test("Circle marketplace inspect falls back to Circle Discovery API when CLI inspect has no payable details", async () => {
  const runner: CircleCliRunner = async (args) => {
    if (args.slice(0, 2).join(" ") === "services inspect") {
      return {stdout: JSON.stringify({data: {status: "unavailable", url: serviceUrl}}), stderr: ""};
    }
    throw new Error(`unexpected circle command: ${args.join(" ")}`);
  };
  const discoveryFetch: DiscoveryFetcher = async () => ({
    x402Version: 2,
    items: [discoveryService()]
  });

  const inspection = await backend.inspectCircleAgentService(serviceUrl, {runner, discoveryFetch});

  assert.equal(inspection.service.name, "AIsa API");
  assert.equal(inspection.service.priceUsdc, 0.00044);
  assert.equal(inspection.service.publisherAddress, publisher);
  assert.equal(inspection.service.acceptedChains.includes("BASE"), true);
});

test("Circle marketplace search and inspect normalize current CLI JSON", async () => {
  const runner = fakeCircleRunner({
    search: {
      services: [{
        name: "Market Data",
        description: "Realtime crypto market data",
        url: serviceUrl,
        price: "$0.005",
        accepts: [{network: "base", scheme: "exact"}]
      }]
    },
    inspect: {
      name: "Market Data",
      description: "Realtime crypto market data",
      url: serviceUrl,
      price: "0.005",
      payTo: publisher,
      accepts: [{network: "base", chain: "BASE", scheme: "exact"}],
      inputSchema: {type: "object", properties: {symbol: {type: "string"}}}
    }
  });

  const search = await backend.searchCircleAgentServices("market", {runner});
  assert.equal(search.services[0]?.name, "Market Data");
  assert.equal(search.services[0]?.priceUsdc, 0.005);
  assert.equal(search.services[0]?.acceptedChains.includes("BASE"), true);

  const inspection = await backend.inspectCircleAgentService(serviceUrl, {runner});
  assert.equal(inspection.service.url, serviceUrl);
  assert.equal(inspection.service.priceUsdc, 0.005);
  assert.equal(inspection.service.publisherAddress, publisher);
  assert.equal(inspection.service.acceptedChains.includes("BASE"), true);
});

test("preflightCircleAgentPayment blocks Circle payments that exceed existing agent policy", async () => {
  await seedAgent({transactionCapUsdc: 0.01, dailyLimitUsdc: 1});
  const runner = fakeCircleRunner({
    inspect: {
      name: "Expensive Service",
      url: serviceUrl,
      price: "0.25",
      payTo: publisher,
      accepts: [{chain: "BASE"}]
    }
  });

  const guard = await backend.preflightCircleAgentPayment({
    operatorAddress: operator,
    agentId: "agent-1",
    walletAddress: wallet,
    serviceUrl,
    chain: "BASE",
    data: {query: "btc"}
  }, {runner});

  assert.equal(guard.allowed, false);
  assert.equal(guard.decision, "block");
  assert.equal(guard.policy.reason, "This purchase exceeds the agent transaction cap.");
  assert.equal(guard.payment.service.priceUsdc, 0.25);
});

test("createCircleAgentPaymentIntent stores Circle intake for approval without spending", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  const calls: string[] = [];
  const runner = fakeCircleRunner({
    inspect: {
      name: "Market Data",
      description: "Realtime crypto market data",
      url: serviceUrl,
      price: "0.005",
      payTo: publisher,
      accepts: [{chain: "BASE", scheme: "exact"}],
      inputSchema: {type: "object", properties: {symbol: {type: "string"}}}
    },
    onCall: (args) => calls.push(args.slice(0, 2).join(" "))
  });

  const intent = await backend.createCircleAgentPaymentIntent({
    operatorAddress: operator,
    agentId: "agent-1",
    walletAddress: wallet,
    serviceUrl,
    chain: "BASE",
    data: {symbol: "BTC"}
  }, {runner});

  assert.equal(intent.status, "pending_approval");
  assert.equal(intent.source.provider, "circle_agent_marketplace");
  assert.equal(intent.normalized.serviceName, "Circle: Market Data");
  assert.equal(intent.normalized.amountUsdc, 0.005);
  assert.equal(intent.normalized.payTo, publisher);
  assert.equal(intent.normalized.chain, "BASE");
  assert.equal(intent.policy.allowed, true);
  assert.equal(intent.approval.required, true);
  assert.equal(intent.execution.paymentId, null);
  assert.deepEqual(calls, ["services inspect"]);

  const snapshotResponse = await backend.handleAppRequest({
    method: "GET",
    url: `http://localhost/api/app?operator=${operator}`
  });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = snapshotResponse.body as {paymentIntents?: Array<{id: string; status: string}>; payments?: unknown[]};
  assert.equal(snapshot.paymentIntents?.some((item) => item.id === intent.id && item.status === "pending_approval"), true);
  assert.equal(snapshot.payments?.length, 0);
});

test("approved Circle payment intent executes once, writes receipt, memory, and automation event", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  await backend.updateStore((store) => {
    store.automationRecipes.push({
      id: "large-circle-receipt",
      operatorAddress: operator,
      agentId: "agent-1",
      name: "Large Circle receipt",
      description: "Notify for Circle receipts",
      trigger: "large_receipt",
      action: "notify",
      params: {minAmountUsdc: 0.001, windowHours: 24, cooldownHours: 0},
      active: true,
      runCount: 0,
      lastTriggeredAt: null,
      lastRunAt: null,
      lastRunReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  const runner = fakeCircleRunner({
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

  const intent = await backend.createCircleAgentPaymentIntent({
    operatorAddress: operator,
    agentId: "agent-1",
    walletAddress: wallet,
    serviceUrl,
    chain: "BASE",
    data: {symbol: "BTC"}
  }, {runner});

  await assert.rejects(
    () => backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner}),
    /approved before execution/
  );

  const approved = await backend.approveCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, note: "Approved for market data"});
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.decidedBy, operator);

  const executed = await backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner});
  assert.equal(executed.intent.status, "settled");
  assert.equal(executed.intent.execution.paymentId, executed.receipt.id);
  assert.equal(executed.receipt.status, "settled");
  assert.equal(executed.receipt.txHash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(executed.result, {symbol: "BTC", price: 65000});

  await assert.rejects(
    () => backend.executeCircleAgentPaymentIntent(intent.id, {operatorAddress: operator, confirmed: true}, {runner}),
    /already executed/
  );

  const receiptResponse = await backend.handleAppRequest({
    method: "GET",
    url: `http://localhost/api/public/receipts/${executed.receipt.id}`
  });
  assert.equal(receiptResponse.status, 200);
  const receiptBody = receiptResponse.body as {receipt?: {kind?: string; title?: string; amountUsdc?: number}};
  assert.equal(receiptBody.receipt?.kind, "circle_agent_marketplace_payment");
  assert.equal(receiptBody.receipt?.title, "Circle: Market Data");
  assert.equal(receiptBody.receipt?.amountUsdc, 0.005);

  const memoryResponse = await backend.handleAppRequest({
    method: "GET",
    url: `http://localhost/api/agents/memory?operator=${operator}`
  });
  assert.equal(memoryResponse.status, 200);
  const memory = memoryResponse.body as {summary?: {settledPayments: number}; recentMemories?: Array<{paymentId: string; serviceName: string}>};
  assert.equal(memory.summary?.settledPayments, 1);
  assert.equal(memory.recentMemories?.some((item) => item.paymentId === executed.receipt.id && item.serviceName === "Circle: Market Data"), true);

  const snapshotResponse = await backend.handleAppRequest({
    method: "GET",
    url: `http://localhost/api/app?operator=${operator}`
  });
  const snapshot = snapshotResponse.body as {
    reputation?: {successfulPayments: number};
    automationRuns?: Array<{status: string; summary: string}>;
    paymentIntents?: Array<{id: string; status: string; receiptId?: string | null}>;
  };
  assert.equal(snapshot.reputation?.successfulPayments, 1);
  assert.equal(snapshot.automationRuns?.some((run) => run.status === "matched" && run.summary.includes("Circle: Market Data")), true);
  assert.equal(snapshot.paymentIntents?.some((item) => item.id === intent.id && item.status === "settled" && item.receiptId === executed.receipt.id), true);
});

test("payCircleAgentService calls real Circle pay path through runner and stores a Nexora receipt", async () => {
  await seedAgent({transactionCapUsdc: 1, dailyLimitUsdc: 5});
  const runner = fakeCircleRunner({
    inspect: {
      name: "Market Data",
      description: "Realtime crypto market data",
      url: serviceUrl,
      price: "0.005",
      payTo: publisher,
      accepts: [{chain: "BASE"}]
    },
    pay: {
      status: "success",
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      response: {symbol: "BTC", price: 65000}
    }
  });

  const result = await backend.payCircleAgentService({
    operatorAddress: operator,
    agentId: "agent-1",
    walletAddress: wallet,
    serviceUrl,
    chain: "BASE",
    data: {symbol: "BTC"},
    confirmed: true
  }, {runner});

  assert.equal(result.status, "settled");
  assert.equal(result.receipt.serviceName, "Circle: Market Data");
  assert.equal(result.receipt.txHash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(result.result, {symbol: "BTC", price: 65000});

  const receiptResponse = await backend.handleAppRequest({
    method: "GET",
    url: `http://localhost/api/public/receipts/${result.receipt.id}`
  });
  assert.equal(receiptResponse.status, 200);
  const receiptBody = receiptResponse.body as {receipt?: {title?: string; amountUsdc?: number}};
  assert.equal(receiptBody.receipt?.title, "Circle: Market Data");
  assert.equal(receiptBody.receipt?.amountUsdc, 0.005);
});

function fakeCircleRunner(outputs: {search?: unknown; inspect?: unknown; pay?: unknown; onCall?: (args: string[]) => void}): CircleCliRunner {
  return async (args: string[]) => {
    outputs.onCall?.(args);
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "--version") return {stdout: "circle/1.0.0\n", stderr: ""};
    if (command === "services search") return {stdout: JSON.stringify(outputs.search ?? {services: []}), stderr: ""};
    if (command === "services inspect") return {stdout: JSON.stringify(outputs.inspect ?? {}), stderr: ""};
    if (command === "services pay") return {stdout: JSON.stringify(outputs.pay ?? {}), stderr: ""};
    throw new Error(`unexpected circle command: ${args.join(" ")}`);
  };
}

function discoveryService() {
  return {
    resource: serviceUrl,
    type: "http",
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      payTo: publisher,
      amount: "440",
      maxTimeoutSeconds: 604900,
      extra: {name: "GatewayWalletBatched", version: "1"}
    }],
    metadata: {
      provider: {
        name: "AIsa API",
        description: "Prediction market odds and trades from Polymarket",
        category: "PREDICTION_MARKETS",
        tags: ["x402", "paid-api", "prediction-markets"]
      },
      path: "/apis/v2/polymarket/markets",
      method: "GET",
      description: "Get Markets",
      input: {type: "http", method: "GET", queryParams: {type: "object"}}
    }
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
  const [circle, router, store] = await Promise.all([
    import("../src/circle/agent-marketplace.js"),
    import("../src/router.js"),
    import("../src/store.js")
  ]);
  return {
    circleAgentMarketplaceReadiness: circle.circleAgentMarketplaceReadiness,
    approveCircleAgentPaymentIntent: circle.approveCircleAgentPaymentIntent,
    buildCircleCliEnv: circle.buildCircleCliEnv,
    createCircleAgentPaymentIntent: circle.createCircleAgentPaymentIntent,
    executeCircleAgentPaymentIntent: circle.executeCircleAgentPaymentIntent,
    inspectCircleAgentService: circle.inspectCircleAgentService,
    payCircleAgentService: circle.payCircleAgentService,
    preflightCircleAgentPayment: circle.preflightCircleAgentPayment,
    searchCircleAgentServices: circle.searchCircleAgentServices,
    handleAppRequest: router.handleAppRequest,
    updateStore: store.updateStore
  };
}
