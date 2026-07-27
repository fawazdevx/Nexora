import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {privateKeyToAccount} from "viem/accounts";
import type {Address, Hex} from "viem";

// Task 6 — multi-chain EIP-3009 self-facilitation (Base + Arbitrum + Arc).
// The correctness-critical piece is the per-network EIP-712 domain: signatures
// verify only when domain name/version match the deployed USDC exactly. These
// values were read on-chain (base-sepolia signs as "USDC", arbitrum-sepolia as
// "USD Coin"). This suite signs real EIP-3009 authorizations and asserts the
// facilitator's verify accepts the right domain and rejects the wrong one — no
// RPC or on-chain settlement involved (verify is pure signature math + store).

const payerKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payer = privateKeyToAccount(payerKey);
const publisher = "0x3333333333333333333333333333333333333333" as Address;

// USDC addresses per network — must match config defaults so requiredNetwork
// accepts requirements.asset. Domain names are the on-chain-verified values.
const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const arbSepoliaUsdc = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address;

let tempDir = "";
type Backend = Awaited<ReturnType<typeof loadBackend>>;
let backend: Backend;

test.before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nexora-x402-multichain-"));
  process.env.DATABASE_URL = "";
  process.env.NEXORA_STORE_PATH = join(tempDir, "store.json");
  backend = await loadBackend();
});

test.after(async () => {
  await rm(tempDir, {recursive: true, force: true});
});

test("supportedX402 advertises Arc, Base, and Arbitrum self-facilitation kinds", () => {
  const supported = backend.supportedX402();
  const networks = supported.kinds.map((k) => k.network);
  assert.ok(networks.includes("arc-testnet"));
  assert.ok(networks.includes("base-sepolia"));
  assert.ok(networks.includes("arbitrum-sepolia"));
  // Every advertised kind carries a valid asset address (isAddress filter).
  for (const kind of supported.kinds) {
    assert.match(kind.asset, /^0x[a-fA-F0-9]{40}$/);
    assert.equal(kind.settlement, "erc3009-transferWithAuthorization");
  }
});

test("verify accepts a real base-sepolia signature signed with the USDC domain", async () => {
  const {payload, requirements} = await signAuthorization({
    network: "base-sepolia",
    asset: baseSepoliaUsdc,
    chainId: 84532,
    domainName: "USDC",
    nonce: `0x${"1".repeat(64)}`
  });
  const result = await backend.verifyFacilitatorPayment({paymentPayload: payload, paymentRequirements: requirements});
  assert.equal(result.isValid, true, result.isValid ? "" : `unexpected: ${JSON.stringify(result)}`);
  assert.equal(result.payer?.toLowerCase(), payer.address.toLowerCase());
});

test("verify accepts a real arbitrum-sepolia signature signed with the 'USD Coin' domain", async () => {
  const {payload, requirements} = await signAuthorization({
    network: "arbitrum-sepolia",
    asset: arbSepoliaUsdc,
    chainId: 421614,
    domainName: "USD Coin",
    nonce: `0x${"2".repeat(64)}`
  });
  const result = await backend.verifyFacilitatorPayment({paymentPayload: payload, paymentRequirements: requirements});
  assert.equal(result.isValid, true, result.isValid ? "" : `unexpected: ${JSON.stringify(result)}`);
});

test("verify rejects an arbitrum-sepolia signature signed with the WRONG domain name", async () => {
  // Signing arbitrum-sepolia with "USDC" (the base-sepolia name) must fail —
  // this is exactly the bug the on-chain domain lookup prevents.
  const {payload, requirements} = await signAuthorization({
    network: "arbitrum-sepolia",
    asset: arbSepoliaUsdc,
    chainId: 421614,
    domainName: "USDC",
    nonce: `0x${"3".repeat(64)}`
  });
  const result = await backend.verifyFacilitatorPayment({paymentPayload: payload, paymentRequirements: requirements});
  assert.equal(result.isValid, false);
  assert.match(String(result.invalidReason), /signature/i);
});

test("verify rejects an unsupported network", async () => {
  const {payload, requirements} = await signAuthorization({
    network: "polygon",
    asset: baseSepoliaUsdc,
    chainId: 137,
    domainName: "USDC",
    nonce: `0x${"4".repeat(64)}`
  });
  // An unconfigured network is rejected at parse time (requiredNetwork throws),
  // which is the correct fail-closed behavior — never settle an unknown chain.
  await assert.rejects(
    backend.verifyFacilitatorPayment({paymentPayload: payload, paymentRequirements: requirements}),
    /unsupported x402 network/
  );
});

// Build and sign a genuine EIP-3009 TransferWithAuthorization for the given
// network/domain, returning the x402 payload + requirements the facilitator expects.
async function signAuthorization(input: {
  network: string;
  asset: Address;
  chainId: number;
  domainName: string;
  nonce: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const validAfter = "0";
  const validBefore = String(now + 3600);
  const value = "1000000";
  const signature = (await payer.signTypedData({
    domain: {name: input.domainName, version: "2", chainId: input.chainId, verifyingContract: input.asset},
    types: {
      TransferWithAuthorization: [
        {name: "from", type: "address"},
        {name: "to", type: "address"},
        {name: "value", type: "uint256"},
        {name: "validAfter", type: "uint256"},
        {name: "validBefore", type: "uint256"},
        {name: "nonce", type: "bytes32"}
      ]
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: payer.address,
      to: publisher,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: input.nonce as Hex
    }
  })) as Hex;

  return {
    payload: {
      x402Version: 1,
      scheme: "exact",
      network: input.network,
      payload: {
        signature,
        authorization: {from: payer.address, to: publisher, value, validAfter, validBefore, nonce: input.nonce}
      }
    },
    requirements: {
      scheme: "exact",
      network: input.network,
      maxAmountRequired: value,
      resource: "https://api.example.com/paid",
      payTo: publisher,
      asset: input.asset
    }
  };
}

async function loadBackend() {
  const mod = await import("../src/x402/protocol-facilitator.js");
  return {
    supportedX402: mod.supportedX402,
    verifyFacilitatorPayment: mod.verifyFacilitatorPayment
  };
}
