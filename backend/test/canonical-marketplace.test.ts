import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {encodeAbiParameters, encodeEventTopics, parseAbi, parseUnits, type Address, type Hex} from "viem";

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-canonical-marketplace-"));
const publisher = "0x1111111111111111111111111111111111111111";
const legacyPublisher = "0x3333333333333333333333333333333333333333";
const ledger = "0x2222222222222222222222222222222222222222";
const transactionHash = `0x${"ab".repeat(32)}`;

process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.NEXORA_MARKETPLACE_PUBLISHER_ADDRESS = publisher;
process.env.X402_LEDGER_ADDRESS = ledger;
process.env.ARC_CHAIN_ID = "5042002";

const {publishServiceRoutes, publishVerifiedService, reconcileCanonicalMarketplaceRoutes} = await import("../src/marketplace/services.js");
const {readStore} = await import("../src/store.js");

const eventAbi = parseAbi([
  "event ServicePublished(uint256 indexed serviceId,address indexed publisher,uint256 pricePerUnit,string endpointHash)"
]);

test.after(async () => {
  await rm(tempDirectory, {recursive: true, force: true});
});

test("canonical reconciliation verifies a receipt, preserves other publishers, and is idempotent", async () => {
  await publishServiceRoutes([{
    publisherAddress: legacyPublisher,
    name: "Legacy Website Analyzer",
    endpointHash: "website-analyzer-v1",
    pricePerUnitUsdc: 0.025,
    chainServiceId: 7,
    settlementChainId: 5042002,
    manifestKind: "website_analyzer"
  }]);

  const clientFactory = () => ({
    async getTransactionReceipt() {
      return {
        status: "success" as const,
        logs: [servicePublishedLog({serviceId: 12n, publisher, endpointHash: "website-analyzer-v1", price: parseUnits("0.025", 6)})]
      };
    },
    async readContract() {
      return [publisher, "website-analyzer-v1", parseUnits("0.025", 6), true] as const;
    }
  });

  const first = await reconcileCanonicalMarketplaceRoutes({
    publisherAddress: publisher,
    settlementChainId: 5042002,
    txHash: transactionHash
  }, {clientFactory});
  assert.equal(first.imported, 1);
  assert.equal(first.archived, 0);
  assert.deepEqual(first.routeIds, ["5042002:12"]);

  const stored = await readStore();
  const canonical = stored.services.find((service) => service.id === "5042002:12");
  const legacy = stored.services.find((service) => service.id === "5042002:7");
  assert.equal(canonical?.txHash, transactionHash);
  assert.equal(canonical?.publisherAddress.toLowerCase(), publisher.toLowerCase());
  assert.equal(legacy?.archivedAt, null);
  assert.equal(legacy?.archiveReason, null);

  const replay = await reconcileCanonicalMarketplaceRoutes({
    publisherAddress: publisher,
    settlementChainId: 5042002,
    txHash: transactionHash
  }, {clientFactory});
  assert.equal(replay.imported, 0);
  assert.equal(replay.archived, 0);
  assert.deepEqual(replay.routeIds, ["5042002:12"]);
});

test("canonical reconciliation rejects a publication with a non-canonical price", async () => {
  await assert.rejects(
    reconcileCanonicalMarketplaceRoutes({
      publisherAddress: publisher,
      settlementChainId: 5042002,
      txHash: `0x${"cd".repeat(32)}`
    }, {
      clientFactory: () => ({
        async getTransactionReceipt() {
          return {
            status: "success" as const,
            logs: [servicePublishedLog({serviceId: 13n, publisher, endpointHash: "github-repo-analyzer-v1", price: 1n})]
          };
        },
        async readContract() {
          throw new Error("readContract must not be reached for an invalid receipt");
        }
      })
    }),
    /does not match the canonical catalog/
  );
});

test("generic publication is stored only after receipt and active-service verification", async () => {
  const routeTxHash = `0x${"ef".repeat(32)}`;
  const service = await publishVerifiedService({
    publisherAddress: legacyPublisher,
    name: "Publisher Risk API",
    endpointHash: "publisher-risk-api-v1",
    pricePerUnitUsdc: 0.03,
    chainServiceId: 21,
    settlementChainId: 5042002,
    manifestKind: "generic",
    txHash: routeTxHash
  }, {
    clientFactory: () => ({
      async getTransactionReceipt() {
        return {
          status: "success" as const,
          logs: [servicePublishedLog({
            serviceId: 21n,
            publisher: legacyPublisher,
            endpointHash: "publisher-risk-api-v1",
            price: parseUnits("0.03", 6)
          })]
        };
      },
      async readContract() {
        return [legacyPublisher, "publisher-risk-api-v1", parseUnits("0.03", 6), true] as const;
      }
    })
  });

  assert.equal(service.id, "5042002:21");
  assert.equal(service.publisherAddress.toLowerCase(), legacyPublisher.toLowerCase());
  assert.equal(service.txHash, routeTxHash);
});

test("generic publication rejects a receipt from a different publisher", async () => {
  await assert.rejects(
    publishVerifiedService({
      publisherAddress: legacyPublisher,
      name: "Spoofed API",
      endpointHash: "spoofed-api-v1",
      pricePerUnitUsdc: 0.03,
      chainServiceId: 22,
      settlementChainId: 5042002,
      manifestKind: "generic",
      txHash: `0x${"12".repeat(32)}`
    }, {
      clientFactory: () => ({
        async getTransactionReceipt() {
          return {
            status: "success" as const,
            logs: [servicePublishedLog({
              serviceId: 22n,
              publisher,
              endpointHash: "spoofed-api-v1",
              price: parseUnits("0.03", 6)
            })]
          };
        },
        async readContract() {
          throw new Error("readContract must not run for an unmatched receipt");
        }
      })
    }),
    /does not contain the submitted Marketplace publication/
  );
});

function servicePublishedLog(input: {serviceId: bigint; publisher: string; endpointHash: string; price: bigint}) {
  return {
    address: ledger as Address,
    topics: encodeEventTopics({
      abi: eventAbi,
      eventName: "ServicePublished",
      args: {serviceId: input.serviceId, publisher: input.publisher as Address}
    }),
    data: encodeAbiParameters(
      [{name: "pricePerUnit", type: "uint256"}, {name: "endpointHash", type: "string"}],
      [input.price, input.endpointHash]
    ) as Hex
  };
}
