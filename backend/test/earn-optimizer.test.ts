import assert from "node:assert/strict";
import test from "node:test";
import {
  scoreOptimizerStrategies,
  selectOptimizerDecision,
  type EarnStrategySnapshot
} from "../src/earn/optimizer.js";

function strategy(input: Partial<EarnStrategySnapshot> & Pick<EarnStrategySnapshot, "strategyId" | "protocol">): EarnStrategySnapshot {
  const comparisonApyBps = input.comparisonApyBps ?? input.expectedApyBps ?? null;
  return {
    strategyId: input.strategyId,
    adapter: input.adapter ?? "0x1111111111111111111111111111111111111111",
    protocol: input.protocol,
    active: input.active ?? true,
    current: input.current ?? false,
    expectedApyBps: input.expectedApyBps ?? null,
    comparisonApyBps,
    yieldSource: input.yieldSource ?? (comparisonApyBps === null ? "unavailable" : "configured"),
    totalAssetsUsdc: input.totalAssetsUsdc ?? 1_000,
    underlyingVault: input.underlyingVault ?? null,
    underlyingVaultAssetsUsdc: input.underlyingVaultAssetsUsdc ?? null,
    assetsPerShare: input.assetsPerShare ?? null,
    telemetryStatus: input.telemetryStatus ?? "live",
    riskScoreBps: "riskScoreBps" in input ? input.riskScoreBps ?? null : 3_000,
    riskConfigured: input.riskConfigured ?? true,
    liquidityScoreBps: input.liquidityScoreBps ?? 8_000,
    optimizerScore: "optimizerScore" in input ? input.optimizerScore ?? null : 5_000,
    eligibleForAutomaticRouting: input.eligibleForAutomaticRouting ?? true
  };
}

test("optimizer stays when XyloNet is the only approved route", () => {
  const decision = selectOptimizerDecision([
    strategy({strategyId: 1, protocol: "XyloNet", current: true})
  ], 1, 50);

  assert.equal(decision.action, "stay");
  assert.equal(decision.selectedStrategyId, 1);
  assert.match(decision.reason, /only approved strategy/i);
});

test("optimizer requires comparable yield telemetry from two adapters", () => {
  const decision = selectOptimizerDecision([
    strategy({strategyId: 1, protocol: "XyloNet", current: true, expectedApyBps: null}),
    strategy({strategyId: 2, protocol: "Future lending market", expectedApyBps: 600})
  ], 1, 50);

  assert.equal(decision.action, "stay");
  assert.match(decision.reason, /comparable yield, liquidity, and risk telemetry/i);
});

test("optimizer recommends a sufficiently better approved strategy", () => {
  const decision = selectOptimizerDecision([
    strategy({strategyId: 1, protocol: "XyloNet", current: true, expectedApyBps: 400, optimizerScore: 5_000}),
    strategy({strategyId: 2, protocol: "Future lending market", expectedApyBps: 500, optimizerScore: 5_100})
  ], 1, 50);

  assert.equal(decision.action, "rebalance");
  assert.equal(decision.selectedStrategyId, 2);
  assert.match(decision.reason, /100 bps/i);
});

test("optimizer ignores unavailable adapter telemetry", () => {
  const decision = selectOptimizerDecision([
    strategy({strategyId: 1, protocol: "XyloNet", current: true, expectedApyBps: 400}),
    strategy({
      strategyId: 2,
      protocol: "Unavailable market",
      expectedApyBps: 2_000,
      telemetryStatus: "unavailable"
    })
  ], 1, 50);

  assert.equal(decision.action, "stay");
  assert.equal(decision.selectedStrategyId, 1);
});

test("conservative profile rejects a high-risk route despite higher APY", () => {
  const strategies = scoreOptimizerStrategies([
    strategy({strategyId: 1, protocol: "XyloNet", current: true, expectedApyBps: 400, optimizerScore: 5_500}),
    strategy({
      strategyId: 2,
      protocol: "High variance vault",
      expectedApyBps: 1_200,
      riskScoreBps: 7_500
    })
  ], "conservative");
  const decision = selectOptimizerDecision(strategies, 1, 100, "conservative");

  assert.equal(decision.action, "stay");
  assert.equal(decision.selectedStrategyId, 1);
  assert.equal(strategies[1]?.eligibleForAutomaticRouting, false);
});

test("growth profile can select a reviewed higher-risk route", () => {
  const strategies = scoreOptimizerStrategies([
    strategy({strategyId: 1, protocol: "XyloNet", current: true, expectedApyBps: 400}),
    strategy({
      strategyId: 2,
      protocol: "Reviewed growth vault",
      expectedApyBps: 3_000,
      riskScoreBps: 7_500
    })
  ], "growth");
  const decision = selectOptimizerDecision(strategies, 1, 25, "growth");

  assert.equal(decision.action, "rebalance");
  assert.equal(decision.selectedStrategyId, 2);
});

test("missing risk metadata prevents automatic migration", () => {
  const strategies = scoreOptimizerStrategies([
    strategy({strategyId: 1, protocol: "XyloNet", current: true, expectedApyBps: 400}),
    strategy({
      strategyId: 2,
      protocol: "Unreviewed vault",
      expectedApyBps: 900,
      riskScoreBps: null,
      riskConfigured: false
    })
  ], "balanced");
  const decision = selectOptimizerDecision(strategies, 1, 50);

  assert.equal(decision.action, "stay");
  assert.equal(decision.selectedStrategyId, 1);
  assert.equal(strategies[1]?.eligibleForAutomaticRouting, false);
});
