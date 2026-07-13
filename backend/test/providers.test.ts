import assert from "node:assert/strict";
import test from "node:test";
import {buildServiceManifest, executeBuiltInService} from "../src/marketplace/services.js";
import {normalizeDefiLlamaPools, summarizeDefiLlamaVaultQuery} from "../src/providers/defillama.js";
import {normalizePreflightResult, prepareTransactionPreflightArgs, runAgentTransactionPreflight} from "../src/providers/preflight.js";
import {normalizeTenderlyResponse, tenderlyReadiness, tenderlySimulationFromArgs} from "../src/providers/tenderly.js";
import {normalizeCounterpartyScreeningReport, normalizeWalletApprovalExposureReport, scanWalletApprovalExposure} from "../src/providers/wallet-risk.js";

test("normalizeDefiLlamaPools returns liquid stablecoin yield opportunities sorted by APY", () => {
  const payload = {
    status: "success",
    data: [
      {
        chain: "Ethereum",
        project: "maple",
        symbol: "USDC",
        tvlUsd: 3_000_000,
        apyBase: 4.5,
        apyReward: 0,
        apy: 4.5,
        stablecoin: true,
        exposure: "single",
        ilRisk: "no",
        pool: "maple-usdc",
        underlyingTokens: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
        poolMeta: "USDC lending"
      },
      {
        chain: "Base",
        project: "morpho-blue",
        symbol: "USDC",
        tvlUsd: 7_500_000,
        apyBase: 6.25,
        apyReward: null,
        apy: 6.25,
        stablecoin: true,
        exposure: "single",
        ilRisk: "no",
        pool: "morpho-usdc",
        underlyingTokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
        poolMeta: null
      },
      {
        chain: "Ethereum",
        project: "lido",
        symbol: "STETH",
        tvlUsd: 10_000_000,
        apy: 2.2,
        stablecoin: false,
        pool: "lido-steth"
      },
      {
        chain: "Arbitrum",
        project: "tiny-vault",
        symbol: "USDC",
        tvlUsd: 50_000,
        apy: 40,
        stablecoin: true,
        pool: "tiny-usdc"
      }
    ]
  };

  const opportunities = normalizeDefiLlamaPools(payload, {limit: 4, minTvlUsd: 100_000});

  assert.equal(opportunities.length, 2);
  assert.equal(opportunities[0].id, "defillama:morpho-usdc");
  assert.equal(opportunities[0].provider, "defillama");
  assert.equal(opportunities[0].risk, "low");
  assert.equal(opportunities[0].automationEnabled, false);
  assert.equal(opportunities[0].notes.includes("DeFiLlama mainnet market data only; execution must be handled by a separate approved adapter."), true);
  assert.equal(opportunities[1].id, "defillama:maple-usdc");
});

test("tenderlySimulationFromArgs normalizes transaction-like args", () => {
  const request = tenderlySimulationFromArgs({
    chainId: 5042002,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    data: "0xabcdef",
    value: "0"
  });

  assert.deepEqual(request, {
    chainId: 5042002,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    input: "0xabcdef",
    value: "0",
    gas: "8000000",
    blockNumber: "latest"
  });
});

test("tenderlyReadiness is explicit when credentials are absent", () => {
  const readiness = tenderlyReadiness({
    accessKey: "",
    accountSlug: "",
    projectSlug: "",
    apiUrl: "https://api.tenderly.co/api/v1"
  });

  assert.equal(readiness.configured, false);
  assert.equal(readiness.status, "not_configured");
  assert.equal(readiness.requiredEnv.includes("TENDERLY_ACCESS_KEY"), true);
});

test("normalizeTenderlyResponse preserves a live failed simulation verdict", () => {
  const request = tenderlySimulationFromArgs({
    chainId: 84532,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    data: "0x",
    value: "0",
    gas: "120000"
  });
  const result = normalizeTenderlyResponse({
    simulation: {
      status: false,
      error_message: "execution reverted",
      transaction: {
        status: false,
        gas_used: 21344
      }
    }
  }, request, tenderlyReadiness({
    accessKey: "test-key",
    accountSlug: "acct",
    projectSlug: "project",
    apiUrl: "https://api.tenderly.co/api/v1"
  }));

  assert.equal(result.status, "failed");
  assert.equal(result.decision, "block");
  assert.equal(result.provider, "tenderly");
  assert.equal(result.errorMessage, "execution reverted");
  assert.equal(result.gasUsed, 21344);
});

test("prepareTransactionPreflightArgs accepts json transaction payloads from marketplace input", () => {
  const request = prepareTransactionPreflightArgs({
    transaction: JSON.stringify({
      chainId: 5042002,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: "0xabcdef",
      value: "0",
      gas: "180000"
    })
  });

  assert.deepEqual(request, {
    chainId: 5042002,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    input: "0xabcdef",
    value: "0",
    gas: "180000",
    blockNumber: "latest"
  });
});

test("runAgentTransactionPreflight never returns an approval when no live provider is available", async () => {
  const result = await runAgentTransactionPreflight({
    transaction: {
      chainId: 999999,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      input: "0x",
      value: "0",
      gas: "180000"
    }
  }, {
    tenderly: {
      accessKey: "",
      accountSlug: "",
      projectSlug: "",
      apiUrl: "https://api.tenderly.co/api/v1"
    },
    rpcUrls: {}
  });

  assert.equal(result.status, "provider_unavailable");
  assert.equal(result.decision, "manual_review");
  assert.equal(result.live, false);
});

test("normalizePreflightResult maps successful live RPC checks to allow", () => {
  const result = normalizePreflightResult({
    provider: "rpc",
    request: {
      chainId: 5042002,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      input: "0x",
      value: "0",
      gas: "180000",
      blockNumber: "latest"
    },
    callSucceeded: true,
    gasEstimate: 42000n
  });

  assert.equal(result.status, "ok");
  assert.equal(result.decision, "allow");
  assert.equal(result.live, true);
  assert.equal(result.gasUsed, 42000);
});

test("agent transaction preflight manifest requires structured transaction input", () => {
  const manifest = buildServiceManifest({
    name: "Agent Transaction Preflight",
    endpointHash: "agent-transaction-preflight-v1",
    manifestKind: "agent_transaction_preflight"
  });

  assert.equal(manifest.kind, "agent_transaction_preflight");
  assert.equal(manifest.inputSchema[0]?.name, "transaction");
  assert.equal(manifest.outputSchema.includes("decision"), true);
  assert.equal(manifest.description.includes("live transaction preflight"), true);
});

test("wallet approval report manifest exposes live exposure fields", () => {
  const manifest = buildServiceManifest({
    name: "Wallet Risk + Approval Scan",
    endpointHash: "wallet-risk-approval-scan-v1",
    manifestKind: "wallet_risk_approval_scan"
  });

  assert.equal(manifest.kind, "wallet_risk_approval_scan");
  assert.equal(manifest.outputSchema.includes("exposure"), true);
  assert.equal(manifest.outputSchema.includes("providerStatus"), true);
  assert.equal(manifest.outputSchema.includes("metrics"), true);
  assert.equal(manifest.outputSchema.includes("chains"), true);
});

test("counterparty screening manifest exposes manual-review telemetry fields", () => {
  const manifest = buildServiceManifest({
    name: "Counterparty Compliance Screen",
    endpointHash: "counterparty-compliance-screen-v1",
    manifestKind: "counterparty_compliance_screen"
  });

  assert.equal(manifest.kind, "counterparty_compliance_screen");
  assert.equal(manifest.outputSchema.includes("decision"), true);
  assert.equal(manifest.outputSchema.includes("live"), true);
  assert.equal(manifest.outputSchema.includes("localActivity"), true);
});

test("vault APY monitor manifest exposes market-data monitoring fields", () => {
  const manifest = buildServiceManifest({
    name: "Vault APY Monitor",
    endpointHash: "vault-apy-monitor-v1",
    manifestKind: "vault_apy_monitor"
  });

  assert.equal(manifest.kind, "vault_apy_monitor");
  assert.equal(manifest.outputSchema.includes("candidates"), true);
  assert.equal(manifest.outputSchema.includes("monitoring"), true);
  assert.equal(manifest.outputSchema.includes("risks"), true);
});

test("agent transaction preflight marketplace handler refuses demo fallback when providers are unavailable", async () => {
  const result = await executeBuiltInService("agent_transaction_preflight", {
    transaction: JSON.stringify({
      chainId: 999999,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: "0x",
      value: "0",
      gas: "180000"
    })
  }) as Record<string, unknown>;

  assert.equal(result.status, "provider_unavailable");
  assert.equal(result.decision, "manual_review");
  assert.equal(result.live, false);
});

test("normalizeWalletApprovalExposureReport reports active USDC allowance exposure from live chain snapshots", () => {
  const report = normalizeWalletApprovalExposureReport({
    wallet: "0x1111111111111111111111111111111111111111",
    chains: [
      {
        key: "base-sepolia",
        name: "Base Sepolia",
        chainId: 84532,
        status: "live",
        live: true,
        nativeBalance: 0.25,
        usdcBalance: 150,
        transactionCount: 12,
        scannedFromBlock: 100n,
        scannedToBlock: 250n,
        approvals: [
          {
            chainKey: "base-sepolia",
            chainName: "Base Sepolia",
            chainId: 84532,
            token: "USDC",
            tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            owner: "0x1111111111111111111111111111111111111111",
            spender: "0x2222222222222222222222222222222222222222",
            spenderLabel: "x402 ledger",
            allowanceRaw: "25000000",
            allowanceUsdc: 25,
            latestApprovalRaw: "25000000",
            latestApprovalUsdc: 25,
            latestApprovalTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            latestApprovalBlock: 240,
            isUnlimited: false,
            active: true
          }
        ],
        errorMessage: null
      }
    ]
  });

  assert.equal(report.status, "ok");
  assert.equal(report.live, true);
  assert.equal(report.metrics.totalActiveApprovals, 1);
  assert.equal(report.exposure.finiteExposureUsdc, 25);
  assert.equal(report.approvals[0]?.spenderLabel, "x402 ledger");
  assert.equal(report.providerStatus.approvals, "live");
});

test("scanWalletApprovalExposure scans full historical approval logs in chunks", async () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const spender = "0x2222222222222222222222222222222222222222";
  const getLogRanges: Array<{fromBlock: bigint; toBlock: bigint}> = [];
  const client = {
    async getBlockNumber() {
      return 250n;
    },
    async getBalance() {
      return 1000000000000000000n;
    },
    async getTransactionCount() {
      return 4;
    },
    async readContract(request: {functionName: string; args: unknown[]}) {
      if (request.functionName === "balanceOf") return 150000000n;
      if (request.functionName === "allowance") return request.args[1] === spender ? 25000000n : 0n;
      throw new Error(`unexpected readContract ${request.functionName}`);
    },
    async getLogs(request: {fromBlock: bigint; toBlock: bigint}) {
      getLogRanges.push({fromBlock: request.fromBlock, toBlock: request.toBlock});
      if (request.fromBlock <= 200n && request.toBlock >= 200n) {
        return [{
          args: {spender, value: 25000000n},
          transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          blockNumber: 200n,
          logIndex: 7
        }];
      }
      return [];
    }
  };

  const result = await scanWalletApprovalExposure(owner, {
    chains: [{
      key: "base-sepolia",
      name: "Base Sepolia",
      chainId: 84532,
      rpcUrl: "http://127.0.0.1:9",
      usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      approvalHistoryStartBlock: 0,
      approvalLogChunkSize: 100,
      knownSpenders: [{address: spender, label: "x402 ledger"}]
    }],
    createClient: () => client
  });

  assert.deepEqual(getLogRanges, [
    {fromBlock: 0n, toBlock: 99n},
    {fromBlock: 100n, toBlock: 199n},
    {fromBlock: 200n, toBlock: 250n}
  ]);
  assert.equal(result.providerStatus.coverage, "full_historical_rpc_approval_logs_plus_current_allowance");
  assert.equal(result.providerStatus.note.includes("full historical USDC Approval logs"), true);
  assert.equal(result.chains[0]?.scannedFromBlock, 0);
  assert.equal(result.chains[0]?.scannedToBlock, 250);
  assert.equal(result.approvals[0]?.allowanceUsdc, 25);
  assert.equal(result.approvals[0]?.spenderLabel, "x402 ledger");
});

test("normalizeCounterpartyScreeningReport uses chain telemetry but keeps compliance in manual review without KYT provider", () => {
  const report = normalizeCounterpartyScreeningReport({
    counterparty: "0x3333333333333333333333333333333333333333 vendor payout",
    wallet: "0x3333333333333333333333333333333333333333",
    chains: [
      {
        key: "arc-testnet",
        name: "Arc Testnet",
        chainId: 5042002,
        status: "live",
        live: true,
        nativeBalance: 1.5,
        usdcBalance: 42,
        transactionCount: 8,
        isContract: false,
        errorMessage: null
      }
    ],
    localActivity: {
      settledPayments: 2,
      failedPayments: 0,
      publishedServices: 1,
      lastSeenAt: "2026-07-09T00:00:00.000Z"
    },
    complianceProviderConfigured: false
  });

  assert.equal(report.status, "ok");
  assert.equal(report.decision, "manual_review");
  assert.equal(report.live, true);
  assert.equal(report.providerStatus.sanctions, "not_configured");
  assert.equal(report.metrics.transactionCount, 8);
  assert.equal(report.localActivity.settledPayments, 2);
});

test("summarizeDefiLlamaVaultQuery returns USDC yield risk monitor metadata from market data", () => {
  const opportunities = normalizeDefiLlamaPools({
    data: [
      {
        chain: "Base",
        project: "morpho-blue",
        symbol: "USDC",
        tvlUsd: 7_500_000,
        apy: 6.25,
        stablecoin: true,
        exposure: "single",
        ilRisk: "no",
        pool: "morpho-usdc",
        underlyingTokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]
      }
    ]
  }, {limit: 5, minTvlUsd: 100_000});

  const report = summarizeDefiLlamaVaultQuery("USDC yield risk", opportunities);

  assert.equal(report.status, "ok");
  assert.equal(report.providerStatus.vaultData, "live");
  assert.equal(report.monitoring.asset, "USDC");
  assert.equal(report.candidates[0]?.provider, "defillama");
  assert.equal(report.risks.some((item: string) => item.includes("market data")), true);
});
