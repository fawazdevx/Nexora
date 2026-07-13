import assert from "node:assert/strict";
import test from "node:test";
import {handleAppRequest} from "../src/router.js";
import {buildArcStressPlan, normalizeArcStressConfig, summarizeArcStressRun} from "../src/stress/arc.js";

test("normalizeArcStressConfig keeps Arc stress runs disabled and dry-run by default", () => {
  const config = normalizeArcStressConfig({
    ARC_CHAIN_ID: "5042002",
    ARC_RPC_URL: "https://rpc.testnet.arc.network"
  });

  assert.equal(config.enabled, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.chainId, 5042002);
  assert.equal(config.targetTps, 2);
  assert.equal(config.maxConcurrency, 10);
  assert.equal(config.durationSeconds, 300);
  assert.equal(config.maxTx, 1000);
  assert.equal(config.canSendTransactions, false);
  assert.equal(config.requiredEnv.includes("ARC_STRESS_ENABLED"), true);
  assert.equal(config.requiredEnv.includes("ARC_STRESS_DURATION_SECONDS"), true);
  assert.equal(config.requiredEnv.includes("ARC_STRESS_PRIVATE_KEY"), true);
  assert.equal(config.requiredEnv.includes("ARC_STRESS_TRANSFER_USDC"), true);
});

test("buildArcStressPlan caps requested throughput and produces a mixed workload", () => {
  const config = normalizeArcStressConfig({
    ARC_STRESS_ENABLED: "true",
    ARC_STRESS_DRY_RUN: "false",
    ARC_STRESS_PRIVATE_KEY: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ARC_STRESS_TARGET_TPS: "20",
    ARC_STRESS_MAX_CONCURRENCY: "50",
    ARC_STRESS_MAX_TX: "250"
  });
  const plan = buildArcStressPlan({
    config,
    requestedAgents: 100,
    requestedTransactions: 5000,
    requestedDurationSeconds: 600
  });

  assert.equal(plan.agents, 100);
  assert.equal(plan.totalOperations, 250);
  assert.equal(plan.durationSeconds, 600);
  assert.equal(plan.targetTps, 20);
  assert.equal(plan.maxConcurrency, 50);
  assert.equal(plan.actions.some((action) => action.kind === "native_transfer"), true);
  assert.equal(plan.actions.some((action) => action.kind === "transaction_preflight"), true);
  assert.equal(plan.actions.some((action) => action.kind === "indexer_status"), true);
});

test("summarizeArcStressRun reports confirmation latency and failure counts", () => {
  const summary = summarizeArcStressRun({
    id: "run-1",
    status: "running",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:01:00.000Z",
    config: normalizeArcStressConfig({}),
    plan: {
      agents: 5,
      totalOperations: 3,
      durationSeconds: 60,
      targetTps: 1,
      maxConcurrency: 2,
      dryRun: true,
      actions: [
        {id: "a", kind: "native_transfer", agentIndex: 0, scheduledAtMs: 0},
        {id: "b", kind: "transaction_preflight", agentIndex: 1, scheduledAtMs: 1000},
        {id: "c", kind: "indexer_status", agentIndex: 2, scheduledAtMs: 2000}
      ]
    },
    events: [
      {id: "a", kind: "native_transfer", status: "confirmed", startedAt: 0, completedAt: 900, confirmationMs: 700},
      {id: "b", kind: "transaction_preflight", status: "succeeded", startedAt: 0, completedAt: 80},
      {id: "c", kind: "indexer_status", status: "failed", startedAt: 0, completedAt: 50, errorMessage: "RPC error"}
    ]
  });

  assert.equal(summary.totalOperations, 3);
  assert.equal(summary.confirmedTransactions, 1);
  assert.equal(summary.failedOperations, 1);
  assert.equal(summary.averageConfirmationMs, 700);
  assert.equal(summary.averageOperationMs, 343.333333);
});

test("stress API exposes readiness with safe defaults", async () => {
  const response = await handleAppRequest({
    method: "GET",
    url: "http://localhost/api/stress/arc"
  });

  assert.equal(response.status, 200);
  const body = response.body as {readiness?: {chainId?: number; dryRun?: boolean; requiredEnv?: string[]}};
  assert.equal(body.readiness?.chainId, 5042002);
  assert.equal(body.readiness?.dryRun, true);
  assert.equal(body.readiness?.requiredEnv?.includes("ARC_STRESS_ENABLED"), true);
});

test("stress API starts a bounded dry-run and exposes the latest run", async () => {
  const start = await handleAppRequest({
    method: "POST",
    url: "http://localhost/api/stress/arc/start",
    headers: adminHeaders(),
    body: {agents: 3, transactions: 2, durationSeconds: 10}
  });

  assert.equal(start.status, 200);
  const startBody = start.body as {run?: {id?: string; config?: {privateKey?: string | null}; plan?: {totalOperations?: number; agents?: number}}};
  assert.equal(typeof startBody.run?.id, "string");
  assert.equal(startBody.run?.config?.privateKey, null);
  assert.equal(startBody.run?.plan?.totalOperations, 2);
  assert.equal(startBody.run?.plan?.agents, 3);

  const latest = await handleAppRequest({
    method: "GET",
    url: "http://localhost/api/stress/arc"
  });

  assert.equal(latest.status, 200);
  const latestBody = latest.body as {latest?: {run?: {id?: string}; summary?: {totalOperations?: number}} | null};
  assert.equal(latestBody.latest?.run?.id, startBody.run?.id);
  assert.equal(latestBody.latest?.summary?.totalOperations, 2);
});

function adminHeaders() {
  return process.env.NEXORA_ADMIN_SECRET ? {"x-admin-secret": process.env.NEXORA_ADMIN_SECRET} : undefined;
}
