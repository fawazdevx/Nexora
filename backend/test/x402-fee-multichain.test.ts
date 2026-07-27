import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

// Task: multi-chain marketplace fee settlement. A service now records the EVM
// chain its ledger lives on (settlementChainId); the backend must resolve the
// correct per-chain RPC/ledger/USDC when verifying a settlement, instead of
// always assuming Arc. Each chain also has its own serviceId counter, so the
// stored service id must be chain-scoped to avoid Arc#1 / Base#1 collisions.
//
// Config reads env at module load, so the chain addresses are set BEFORE import.

const arcChainId = 5042002;
const baseSepoliaChainId = 84532;
const arbSepoliaChainId = 421614;

const arcLedger = "0xa42fE5CCbF8a96547990df45eDbdb83ebe36589a";
const baseLedger = "0x12B6fF427abA4f0438EA6B5af7E1e49e55DeaB2D";
const arbLedger = "0x195f70790d977983586d90f2000725B6e26684eE";
const treasury = "0x1BF4885B90A5e861F9a130a62b3B88bC97F93eF0";
const arcUsdc = "0x3600000000000000000000000000000000000000";
const baseUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const arbUsdc = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

process.env.DATABASE_URL = "";
process.env.USDC_ADDRESS = arcUsdc;
process.env.X402_LEDGER_ADDRESS = arcLedger;
process.env.TREASURY_ADDRESS = treasury;
process.env.BASE_SEPOLIA_X402_LEDGER_ADDRESS = baseLedger;
process.env.BASE_SEPOLIA_USDC_ADDRESS = baseUsdc;
process.env.ARB_SEPOLIA_X402_LEDGER_ADDRESS = arbLedger;
process.env.ARB_SEPOLIA_USDC_ADDRESS = arbUsdc;

const tempDir = await mkdtemp(join(tmpdir(), "nexora-fee-mc-"));
process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");

const facilitator = await import("../src/x402/facilitator.js");
const store = await import("../src/store.js");
const services = await import("../src/marketplace/services.js");

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("settlement context resolves the right ledger/USDC/RPC per chain", () => {
  const arc = facilitator.settlementContextForChainId(arcChainId);
  assert.equal(arc.ledger.toLowerCase(), arcLedger.toLowerCase());
  assert.equal(arc.usdc.toLowerCase(), arcUsdc.toLowerCase());
  assert.equal(arc.supportsMemo, true);

  const base = facilitator.settlementContextForChainId(baseSepoliaChainId);
  assert.equal(base.ledger.toLowerCase(), baseLedger.toLowerCase());
  assert.equal(base.usdc.toLowerCase(), baseUsdc.toLowerCase());
  assert.equal(base.chainId, baseSepoliaChainId);
  assert.equal(base.supportsMemo, false);

  const arb = facilitator.settlementContextForChainId(arbSepoliaChainId);
  assert.equal(arb.ledger.toLowerCase(), arbLedger.toLowerCase());
  assert.equal(arb.usdc.toLowerCase(), arbUsdc.toLowerCase());
  assert.equal(arb.chainId, arbSepoliaChainId);
  assert.equal(arb.supportsMemo, false);
});

test("all chains share the configured treasury (verified on-chain)", () => {
  for (const chainId of [arcChainId, baseSepoliaChainId, arbSepoliaChainId]) {
    assert.equal(
      facilitator.settlementContextForChainId(chainId).treasury.toLowerCase(),
      treasury.toLowerCase()
    );
  }
});

test("null settlementChainId remains an Arc legacy route and unknown chains fail closed", () => {
  const legacy = facilitator.settlementContextForChainId(null);
  assert.equal(legacy.chainId, arcChainId);
  assert.equal(legacy.ledger.toLowerCase(), arcLedger.toLowerCase());
  assert.throws(
    () => facilitator.settlementContextForChainId(999999),
    /not enabled for Nexora marketplace settlement/
  );
});

test("publishing the same chainServiceId on two chains does not collide", async () => {
  const arcService = await services.publishService({
    publisherAddress: "0x3333333333333333333333333333333333333333",
    name: "Arc Report",
    endpointHash: "endpoint-arc-1",
    pricePerUnitUsdc: 0.5,
    chainServiceId: 1,
    settlementChainId: arcChainId
  });
  const baseService = await services.publishService({
    publisherAddress: "0x3333333333333333333333333333333333333333",
    name: "Base Report",
    endpointHash: "endpoint-base-1",
    pricePerUnitUsdc: 0.5,
    chainServiceId: 1,
    settlementChainId: baseSepoliaChainId
  });

  // Same on-chain serviceId (1) on different chains must be distinct records.
  assert.notEqual(arcService.id, baseService.id);
  assert.equal(arcService.settlementChainId, arcChainId);
  assert.equal(baseService.settlementChainId, baseSepoliaChainId);

  const all = await services.listServices();
  const arcFound = all.find((s) => s.id === arcService.id);
  const baseFound = all.find((s) => s.id === baseService.id);
  assert.ok(arcFound, "arc service persisted");
  assert.ok(baseFound, "base service persisted");
  assert.equal(baseFound?.settlementChainId, baseSepoliaChainId);
});

test("the same logical service remains visible once per settlement chain", async () => {
  const publisherAddress = "0x4444444444444444444444444444444444444444";
  const common = {
    publisherAddress,
    name: "Multichain Report",
    endpointHash: "multichain-report-v1",
    pricePerUnitUsdc: 0.25
  };
  await services.publishService({...common, chainServiceId: 12, settlementChainId: arcChainId});
  await services.publishService({...common, chainServiceId: 8, settlementChainId: baseSepoliaChainId});
  await services.publishService({...common, chainServiceId: 5, settlementChainId: arbSepoliaChainId});

  const routes = (await services.listServices()).filter(
    (service) => service.publisherAddress.toLowerCase() === publisherAddress.toLowerCase()
      && service.endpointHash === common.endpointHash
  );
  assert.deepEqual(
    routes.map((service) => service.settlementChainId).sort((a, b) => Number(a) - Number(b)),
    [baseSepoliaChainId, arbSepoliaChainId, arcChainId].sort((a, b) => a - b)
  );
});

test("new on-chain services must declare a supported settlement chain", async () => {
  await assert.rejects(
    services.publishService({
      publisherAddress: "0x5555555555555555555555555555555555555555",
      name: "Missing Route",
      endpointHash: "missing-route-v1",
      pricePerUnitUsdc: 0.1,
      chainServiceId: 2
    }),
    /settlementChainId is required/
  );
  await assert.rejects(
    services.publishService({
      publisherAddress: "0x5555555555555555555555555555555555555555",
      name: "Unsupported Route",
      endpointHash: "unsupported-route-v1",
      pricePerUnitUsdc: 0.1,
      chainServiceId: 2,
      settlementChainId: 999999
    }),
    /not enabled for Nexora marketplace settlement/
  );
});

test("a legacy service chain id (null/undefined) resolves to the Arc settlement context", () => {
  // Legacy records predate settlementChainId. The resolver must treat both null
  // and undefined as Arc so their fee verification keeps working unchanged.
  const fromNull = facilitator.settlementContextForChainId(null);
  const fromUndefined = facilitator.settlementContextForChainId(undefined);
  assert.equal(fromNull.chainId, arcChainId);
  assert.equal(fromNull.label, "Arc Testnet");
  assert.equal(fromNull.supportsMemo, true);
  assert.equal(fromUndefined.chainId, arcChainId);
});
