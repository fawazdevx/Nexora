import assert from "node:assert/strict";
import test from "node:test";
import {encodeAbiParameters, keccak256, type Hex} from "viem";

// Config reads env at load; set a settlement contract for base-sepolia BEFORE
// importing so settlementConfigured() is true on that network.
const CONTRACT = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";
const SELLER = "0x3333333333333333333333333333333333333333";
const PAYER = "0x1111111111111111111111111111111111111111";
process.env.BASE_SEPOLIA_X402_SETTLEMENT_ADDRESS = CONTRACT;
process.env.BASE_SEPOLIA_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
process.env.NEXORA_FEE_BPS = "250";
process.env.ARC_X402_SETTLEMENT_ADDRESS = "";

const {
  buildSettlementRequirements,
  expectedSettlementNonce,
  settlementConfigured,
  verifySettlementTx
} = await import("../src/x402/settlement.js");

const NETWORK = "base-sepolia";
const SALT = ("0x" + "ab".repeat(32)) as Hex;

test("settlementConfigured reflects whether a contract is set for the network", () => {
  assert.equal(settlementConfigured(NETWORK), true);
  assert.equal(settlementConfigured("arc-testnet"), false); // no ARC_X402_SETTLEMENT_ADDRESS set
  assert.equal(settlementConfigured("bogus"), false);
});

test("expectedSettlementNonce matches the contract's keccak256(abi.encode(seller,maxFeeBps,salt))", () => {
  // Independent recomputation of the exact contract formula. If these ever
  // diverge, every settlement would revert with NonceMismatch on-chain.
  const manual = keccak256(
    encodeAbiParameters(
      [{type: "address"}, {type: "uint16"}, {type: "bytes32"}],
      [SELLER as `0x${string}`, 250, SALT]
    )
  );
  assert.equal(expectedSettlementNonce(SELLER, 250, SALT), manual);
});

test("buildSettlementRequirements binds seller + live fee into the nonce and points payTo at the contract", async () => {
  const reqs = await buildSettlementRequirements({
    network: NETWORK,
    amountBaseUnits: "1000000",
    resource: "https://api.example.com/paid",
    seller: SELLER,
    salt: SALT
  }, {feeBpsReader: async () => 250});
  assert.equal(reqs.payTo.toLowerCase(), CONTRACT.toLowerCase());
  assert.equal(reqs.extra.seller, SELLER);
  assert.equal(reqs.extra.maxFeeBps, 250);
  assert.equal(reqs.extra.settlement, "nexora-x402-settlement");
  // The advertised nonce is exactly what the contract will recompute.
  assert.equal(reqs.extra.nonce, expectedSettlementNonce(SELLER, 250, SALT));
});

test("buildSettlementRequirements rejects a fee ceiling below the current facilitator fee", async () => {
  await assert.rejects(buildSettlementRequirements({
    network: NETWORK, amountBaseUnits: "1000000", resource: "r", seller: SELLER, salt: SALT, maxFeeBps: 100
  }, {feeBpsReader: async () => 250}), /below the current facilitator fee/);
});

test("buildSettlementRequirements rejects zero/invalid amount and unknown network", async () => {
  await assert.rejects(buildSettlementRequirements(
    {network: NETWORK, amountBaseUnits: "0", resource: "r", seller: SELLER, salt: SALT},
    {feeBpsReader: async () => 250}
  ));
  await assert.rejects(buildSettlementRequirements(
    {network: "bogus", amountBaseUnits: "1", resource: "r", seller: SELLER, salt: SALT},
    {feeBpsReader: async () => 250}
  ));
});

test("buildSettlementRequirements uses a changed on-chain fee instead of stale environment configuration", async () => {
  const reqs = await buildSettlementRequirements({
    network: NETWORK,
    amountBaseUnits: "1000000",
    resource: "r",
    seller: SELLER,
    salt: SALT
  }, {feeBpsReader: async () => 300});
  assert.equal(reqs.extra.maxFeeBps, 300);
  assert.equal(reqs.extra.nonce, expectedSettlementNonce(SELLER, 300, SALT));
});

test("verifySettlementTx confirms a matching SettlementCompleted event", async () => {
  const nonce = expectedSettlementNonce(SELLER, 250, SALT);
  // Real event topic0 for SettlementCompleted(bytes32,address,address,uint256,uint256).
  const topic0 = keccak256(new TextEncoder().encode("SettlementCompleted(bytes32,address,address,uint256,uint256)")) as Hex;
  const pad = (addr: string) => ("0x" + "0".repeat(24) + addr.slice(2)) as Hex;
  const result = await verifySettlementTx(
    {network: NETWORK, txHash: "0x" + "9".repeat(64), expectedNonce: nonce, seller: SELLER},
    {
      clientFactory: () => ({
        getTransactionReceipt: async () => ({
          status: "success" as const,
          logs: [{
            address: CONTRACT,
            topics: [topic0, nonce, pad(PAYER), pad(SELLER)],
            // grossAmount=1_000_000, platformFee=25_000
            data: ("0x" + (1_000_000).toString(16).padStart(64, "0") + (25_000).toString(16).padStart(64, "0")) as Hex
          }]
        })
      })
    }
  );
  assert.equal(result.verified, true, result.reason ?? "");
  assert.equal(result.seller?.toLowerCase(), SELLER.toLowerCase());
  assert.equal(result.grossAmountUsdc, 1);
  assert.equal(result.platformFeeUsdc, 0.025);
});

test("verifySettlementTx rejects a reverted tx", async () => {
  const result = await verifySettlementTx(
    {network: NETWORK, txHash: "0x" + "9".repeat(64), expectedNonce: expectedSettlementNonce(SELLER, 250, SALT), seller: SELLER},
    {clientFactory: () => ({getTransactionReceipt: async () => ({status: "reverted" as const, logs: []})})}
  );
  assert.equal(result.verified, false);
  assert.match(String(result.reason), /reverted/);
});

test("verifySettlementTx rejects when no matching event is present", async () => {
  const result = await verifySettlementTx(
    {network: NETWORK, txHash: "0x" + "9".repeat(64), expectedNonce: expectedSettlementNonce(SELLER, 250, SALT), seller: SELLER},
    {clientFactory: () => ({getTransactionReceipt: async () => ({status: "success" as const, logs: []})})}
  );
  assert.equal(result.verified, false);
  assert.match(String(result.reason), /not found/);
});
