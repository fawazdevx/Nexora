import assert from "node:assert/strict";
import test from "node:test";
import {evaluateAgentPolicy} from "../src/policies/engine.js";
import type {AgentWalletRecord, PaymentRecord, ServiceRecord} from "../src/store.js";

// Minimal fixtures. The remediation contract only reads price, units, policy
// caps, and settled agent payments, so everything else is filled with inert
// placeholder values.
function buildService(pricePerUnitUsdc: number, overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: "svc_remediation",
    chainServiceId: 1,
    publisherAddress: "0x3333333333333333333333333333333333333333",
    name: "Remediation Test Service",
    endpointHash: "0x" + "0".repeat(64),
    pricePerUnitUsdc,
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    manifest: {
      kind: "generic",
      version: "1.0.0",
      description: "test",
      inputSchema: [],
      outputSchema: [],
      revenueMode: "per_execution",
      platformFeeBps: 0
    },
    ...overrides
  };
}

function buildAgent(policy: Partial<AgentWalletRecord["policy"]>): Pick<AgentWalletRecord, "id" | "address" | "policy"> {
  return {
    id: "agent_remediation",
    address: "0x2222222222222222222222222222222222222222",
    policy: {
      dailyLimitUsdc: 0,
      transactionCapUsdc: 0,
      contractAllowlist: [],
      recipientAllowlist: [],
      active: true,
      ...policy
    }
  };
}

const noPayments: PaymentRecord[] = [];

test("blocks with a retryable transaction-cap remediation and whole-unit suggestion", () => {
  const service = buildService(0.25); // 4 units = 1.00 USDC
  const agent = buildAgent({transactionCapUsdc: 0.7, dailyLimitUsdc: 100});
  const result = evaluateAgentPolicy({agent, service, units: 4, payments: noPayments});

  assert.equal(result.allowed, false);
  assert.ok(result.remediation, "remediation should be present on a block");
  assert.equal(result.remediation?.code, "transaction_cap_exceeded");
  assert.equal(result.remediation?.retryable, true);
  // 0.7 cap at 0.25/unit clamps down to 2 whole units (0.50 USDC).
  assert.equal(result.remediation?.suggestedMaxUnits, 2);
  assert.equal(result.remediation?.suggestedMaxAmountUsdc, 0.5);
  assert.equal(result.remediation?.limitingFactor, "Agent transaction cap");
});

test("marks a block non-retryable when even a single unit exceeds every cap", () => {
  const service = buildService(5); // one unit already 5.00 USDC
  const agent = buildAgent({transactionCapUsdc: 1, dailyLimitUsdc: 100});
  const result = evaluateAgentPolicy({agent, service, units: 1, payments: noPayments});

  assert.equal(result.allowed, false);
  assert.equal(result.remediation?.code, "transaction_cap_exceeded");
  assert.equal(result.remediation?.retryable, false);
  assert.equal(result.remediation?.suggestedMaxUnits, null);
  assert.equal(result.remediation?.suggestedMaxAmountUsdc, null);
});

test("picks the daily limit as the binding factor when it is tighter than the txn cap", () => {
  const service = buildService(1); // 1.00 USDC per unit
  const agent = buildAgent({transactionCapUsdc: 100, dailyLimitUsdc: 3});
  const settled: PaymentRecord[] = [
    {
      id: "p1",
      serviceId: service.id,
      serviceName: service.name,
      payer: "0x1111111111111111111111111111111111111111",
      agentId: agent.id,
      publisherAddress: service.publisherAddress,
      amountUsdc: 2,
      units: 2,
      requestHash: "0x" + "1".repeat(64),
      status: "settled",
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString()
    }
  ];
  const result = evaluateAgentPolicy({agent, service, units: 3, payments: settled});

  assert.equal(result.allowed, false);
  // Only 1.00 USDC of daily headroom remains, so daily limit binds.
  assert.equal(result.remediation?.code, "daily_limit_exceeded");
  assert.equal(result.remediation?.limitingFactor, "Agent daily limit");
  assert.equal(result.remediation?.suggestedMaxUnits, 1);
  assert.equal(result.remediation?.suggestedMaxAmountUsdc, 1);
});

test("max-units block suggests the configured cap and is retryable", () => {
  const service = buildService(0.1);
  const agent = buildAgent({
    transactionCapUsdc: 100,
    dailyLimitUsdc: 100,
    v2: {
      weeklyLimitUsdc: 0,
      monthlyLimitUsdc: 0,
      maxUnitsPerRequest: 5,
      cooldownSeconds: 0,
      expiresAt: null,
      serviceAllowlist: [],
      requireOnchainPolicy: false
    }
  });
  const result = evaluateAgentPolicy({agent, service, units: 12, payments: noPayments});

  assert.equal(result.allowed, false);
  assert.equal(result.remediation?.code, "max_units_exceeded");
  assert.equal(result.remediation?.retryable, true);
  assert.equal(result.remediation?.suggestedMaxUnits, 5);
});

test("non-amount blocks are not retryable and carry no unit suggestion", () => {
  const agent = buildAgent({transactionCapUsdc: 100, dailyLimitUsdc: 100, active: false});
  const result = evaluateAgentPolicy({agent, service: buildService(0.1), units: 1, payments: noPayments});

  assert.equal(result.allowed, false);
  assert.equal(result.remediation?.code, "policy_inactive");
  assert.equal(result.remediation?.retryable, false);
  assert.equal(result.remediation?.suggestedMaxUnits, null);
});

test("a compliant request passes with no remediation", () => {
  const service = buildService(0.25);
  const agent = buildAgent({transactionCapUsdc: 1, dailyLimitUsdc: 100});
  const result = evaluateAgentPolicy({agent, service, units: 2, payments: noPayments});

  assert.equal(result.allowed, true);
  assert.equal(result.remediation, undefined);
});

test("the suggested unit count from a block actually passes on re-evaluation (auto-retry invariant)", () => {
  const service = buildService(0.25);
  const agent = buildAgent({transactionCapUsdc: 0.7, dailyLimitUsdc: 100});
  const blockedResult = evaluateAgentPolicy({agent, service, units: 4, payments: noPayments});

  assert.equal(blockedResult.allowed, false);
  const retryUnits = blockedResult.remediation?.suggestedMaxUnits;
  assert.equal(typeof retryUnits, "number");

  // This mirrors the opt-in auto-retry path in authorizeX402: re-run the same
  // evaluation at the suggested unit count and confirm it clears the policy.
  const retry = evaluateAgentPolicy({agent, service, units: retryUnits as number, payments: noPayments});
  assert.equal(retry.allowed, true);
});
