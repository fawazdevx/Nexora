import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-code-marketplace-"));
process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.NEXORA_MARKETPLACE_PUBLISHER_ADDRESS = "0x1111111111111111111111111111111111111111";

const {canonicalMarketplaceCatalog} = await import("../src/marketplace/services.js");
const {parseReconcileArguments} = await import("../src/reconcile-canonical-marketplace.js");
const {readStore, storageFriendlyError} = await import("../src/store.js");

test.after(async () => {
  await rm(tempDirectory, {recursive: true, force: true});
});

test("a clean private store does not inject Marketplace seed records", async () => {
  const store = await readStore();
  assert.deepEqual(store.services, []);

  const catalog = await canonicalMarketplaceCatalog();
  assert.equal(catalog.services.length, 6);
  assert.ok(catalog.services.every((service) => service.routes.length === 0));
});

test("reconciliation CLI accepts only an explicit chain and transaction hash", () => {
  const txHash = `0x${"ab".repeat(32)}`;
  assert.deepEqual(parseReconcileArguments(["--chain", "5042002", "--tx", txHash]), {
    chainId: 5042002,
    txHash
  });
  assert.throws(() => parseReconcileArguments(["--chain", "5042002", "--tx", "0x1234"]), /32-byte transaction hash/);
  assert.throws(() => parseReconcileArguments(["--private-key", "secret"]), /Unknown argument/);
});

test("a generic Viem footer is not misclassified as malformed authorization data", () => {
  const message = storageFriendlyError(new Error("ContractFunctionExecutionError: execution reverted\nVersion: viem@2.51.0"));
  assert.match(message, /payment contract rejected/i);
  assert.doesNotMatch(message, /authorization value was malformed/i);
});
