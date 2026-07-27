import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

// Task 4 — Discoverability. Covers the x402 discovery document projection and,
// crucially, a round-trip interop proof: a document emitted by Nexora's public
// discovery endpoint is fed back through Nexora's OWN inbound Circle normalizer
// (inspectCircleAgentService), and the payable details must survive intact.

const publisher = "0x3333333333333333333333333333333333333333";
const usdc = "0x6666666666666666666666666666666666666666";
const baseUrl = "https://nexorafi.app";

type BackendModules = Awaited<ReturnType<typeof loadBackend>>;

let tempDir = "";
let backend: BackendModules;

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-discovery-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  process.env.NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED = "true";
  process.env.USDC_ADDRESS = usdc;
  process.env.NEXORA_PUBLIC_APP_URL = baseUrl;
  backend = await loadBackend();
});

test.beforeEach(async () => {
  await backend.updateStore((store) => {
    store.services = [];
    store.payments = [];
  });
});

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("discovery document lists a published service as an x402 resource", async () => {
  await seedService({id: "svc-alpha", name: "Alpha Analyzer", pricePerUnitUsdc: 0.25});

  const doc = await backend.discoveryDocument(baseUrl);
  assert.equal(doc.x402Version, 1);
  assert.equal(doc.facilitator, "Nexora");
  assert.equal(doc.network, "arc-testnet");
  assert.equal(doc.asset, usdc);
  assert.equal(doc.resources.length, 1);

  const [resource] = doc.resources;
  assert.equal(resource.name, "Alpha Analyzer");
  assert.equal(resource.resource, `${baseUrl}/api/marketplace/services/svc-alpha/execute`);
  assert.equal(resource.accepts.length, 1);
  assert.equal(resource.accepts[0].scheme, "exact");
  assert.equal(resource.accepts[0].asset, usdc);
  assert.equal(resource.accepts[0].payTo, publisher);
  // 0.25 USDC in 6-decimal base units.
  assert.equal(resource.accepts[0].maxAmountRequired, "250000");
});

test("query filters the discovery document by name and description", async () => {
  await seedService({id: "svc-alpha", name: "Alpha Analyzer", pricePerUnitUsdc: 0.25});
  await seedService({id: "svc-beta", name: "Beta Screener", pricePerUnitUsdc: 0.1});

  const doc = await backend.discoveryDocument(baseUrl, "beta");
  assert.equal(doc.resources.length, 1);
  assert.equal(doc.resources[0].metadata.serviceId, "svc-beta");
});

test("the discovery endpoint returns the document unauthenticated", async () => {
  await seedService({id: "svc-alpha", name: "Alpha Analyzer", pricePerUnitUsdc: 0.25});

  const response = await backend.handleAppRequest({
    method: "GET",
    url: "http://localhost/.well-known/x402"
  });
  assert.equal(response.status, 200);
  const body = response.body as {resources?: Array<{metadata?: {serviceId?: string}}>};
  assert.equal(body.resources?.some((item) => item.metadata?.serviceId === "svc-alpha"), true);
});

test("round-trip: Nexora's own inbound normalizer recovers a Nexora-emitted resource", async () => {
  await seedService({id: "svc-alpha", name: "Alpha Analyzer", pricePerUnitUsdc: 0.25});
  const doc = await backend.discoveryDocument(baseUrl);
  const target = doc.resources[0].resource;

  // Feed the emitted document straight into inspectCircleAgentService via a
  // stubbed discovery fetcher. This exercises the real inbound normalizer, so a
  // pass proves the emitted shape is round-trip compatible with what Nexora
  // ingests from Circle-style discovery.
  const {service} = await backend.inspectCircleAgentService(target, {
    enabled: true,
    runner: async () => {
      throw new Error("force discovery fallback");
    },
    discoveryFetch: async () => doc
  });

  assert.equal(service.url, target);
  assert.equal(service.priceUsdc, 0.25);
  assert.equal(service.publisherAddress, publisher);
  // arc-testnet normalizes to the ARC chain label on the inbound path.
  assert.equal(service.acceptedChains.includes("ARC"), true);
});

let chainServiceIdSeq = 100;

async function seedService(input: {id: string; name: string; pricePerUnitUsdc: number}) {
  await backend.updateStore((store) => {
    store.services.push({
      id: input.id,
      // Visibility requires a non-null chainServiceId (isVisibleService).
      chainServiceId: chainServiceIdSeq++,
      publisherAddress: publisher,
      name: input.name,
      endpointHash: `endpoint-${input.id}`,
      pricePerUnitUsdc: input.pricePerUnitUsdc,
      active: true,
      featured: false,
      createdAt: new Date().toISOString(),
      manifest: {
        kind: "generic",
        version: "1.0.0",
        description: `${input.name} description`,
        inputSchema: [],
        outputSchema: [],
        revenueMode: "per_execution",
        platformFeeBps: 0
      }
    });
  });
}

async function loadBackend() {
  const [circle, services, router, store] = await Promise.all([
    import("../src/circle/agent-marketplace.js"),
    import("../src/marketplace/services.js"),
    import("../src/router.js"),
    import("../src/store.js")
  ]);
  return {
    inspectCircleAgentService: circle.inspectCircleAgentService,
    discoveryDocument: services.discoveryDocument,
    handleAppRequest: router.handleAppRequest,
    updateStore: store.updateStore
  };
}
