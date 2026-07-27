import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-market-routes-"));
process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");

const {listServices, publishServiceRoutes} = await import("../src/marketplace/services.js");

test.after(async () => {
  await rm(tempDirectory, {recursive: true, force: true});
});

test("batch route persistence stores each chain-scoped service id in one update", async () => {
  const publisherAddress = "0x1111111111111111111111111111111111111111";
  const routes = await publishServiceRoutes([
    {
      publisherAddress,
      name: "First report",
      endpointHash: "first-report-v1",
      pricePerUnitUsdc: 0.01,
      chainServiceId: 1,
      settlementChainId: 84532,
      manifestKind: "generic"
    },
    {
      publisherAddress,
      name: "Second report",
      endpointHash: "second-report-v1",
      pricePerUnitUsdc: 0.02,
      chainServiceId: 2,
      settlementChainId: 84532,
      manifestKind: "generic"
    }
  ]);

  assert.deepEqual(routes.map((route) => route.id), ["84532:1", "84532:2"]);
  const stored = (await listServices()).filter((service) => service.publisherAddress.toLowerCase() === publisherAddress.toLowerCase());
  assert.deepEqual(stored.map((service) => service.id).sort(), ["84532:1", "84532:2"]);
});

test("batch route persistence rejects unsupported settlement chains atomically", async () => {
  await assert.rejects(
    publishServiceRoutes([{
      publisherAddress: "0x1111111111111111111111111111111111111111",
      name: "Unsupported report",
      endpointHash: "unsupported-report-v1",
      pricePerUnitUsdc: 0.01,
      chainServiceId: 3,
      settlementChainId: 968,
      manifestKind: "generic"
    }]),
    /not enabled for Nexora marketplace settlement/
  );
  const stored = (await listServices()).filter((service) => service.id === "968:3");
  assert.equal(stored.length, 0);
});
