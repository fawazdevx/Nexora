import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXORA_REQUIRE_SIGNED_AUTH = "false";
process.env.USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
process.env.NEXORA_GATEWAY_MAX_TRANSFER_USDC = "100";

const {handleAppRequest} = await import("../src/router.js");

const operator = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";
const bytes32Address = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
const gatewayWallet = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const gatewayMinter = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const arcUsdc = "0x3600000000000000000000000000000000000000";
const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

test("Gateway balances use the aggregate source instead of summing domains", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as {sources?: Array<{domain?: number}>};
    if (url.endsWith("/deposits")) {
      return Response.json({
        token: "USDC",
        deposits: [{domain: 26, depositor: operator, amount: "1.25", status: "pending", transactionHash: `0x${"a".repeat(64)}`}]
      });
    }
    if (body.sources?.[0] && body.sources[0].domain === undefined) {
      return Response.json({token: "USDC", balances: [{depositor: operator, balance: "5.000000"}]});
    }
    return Response.json({
      token: "USDC",
      balances: [
        {domain: 26, depositor: operator, balance: "5.000000"},
        {domain: 3, depositor: operator, balance: "0"},
        {domain: 6, depositor: operator, balance: "0"}
      ]
    });
  };

  try {
    const response = await handleAppRequest({
      method: "GET",
      url: `http://localhost/api/gateway/balances?address=${operator}`
    });
    assert.equal(response.status, 200);
    const body = response.body as {
      totalBalanceUsdc: number;
      unifiedAvailableUsdc: number;
      balances: Array<{domain: number; balanceUsdc: number}>;
      pendingDeposits: Array<{domain: number; amountUsdc: number}>;
    };
    assert.equal(body.totalBalanceUsdc, 5);
    assert.equal(body.unifiedAvailableUsdc, 5);
    assert.deepEqual(body.balances.map((item) => item.balanceUsdc), [5, 0, 0]);
    assert.equal(body.pendingDeposits[0].amountUsdc, 1.25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gateway estimate and transfer support forwarding to an agent wallet", async () => {
  const originalFetch = globalThis.fetch;
  let estimatedSpec: Record<string, unknown> | null = null;
  let transferUrl = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/estimate")) {
      const payload = JSON.parse(String(init?.body ?? "[]")) as Array<{spec: Record<string, unknown>}>;
      estimatedSpec = payload[0].spec;
      return Response.json({
        fees: {total: "100"},
        body: [{burnIntent: {maxBlockHeight: "99999999", maxFee: "100", spec: payload[0].spec}}]
      });
    }
    transferUrl = url;
    return Response.json({transferId: "gateway-transfer-1"});
  };

  try {
    const estimate = await handleAppRequest({
      method: "POST",
      url: "http://localhost/api/gateway/estimate",
      body: {
        operatorAddress: operator,
        sourceChainId: 5042002,
        destinationChainId: 84532,
        destinationRecipient: agent,
        amountUsdc: 2,
        salt: `0x${"b".repeat(64)}`
      }
    });
    assert.equal(estimate.status, 200);
    assert.equal(estimatedSpec?.sourceDomain, 26);
    assert.equal(estimatedSpec?.destinationDomain, 6);
    assert.equal(estimatedSpec?.sourceDepositor, bytes32Address(operator));
    assert.equal(estimatedSpec?.destinationRecipient, bytes32Address(agent));
    assert.equal(estimatedSpec?.value, "2000000");

    const burnIntent = (estimate.body as {burnIntent: unknown}).burnIntent;
    const transfer = await handleAppRequest({
      method: "POST",
      url: "http://localhost/api/gateway/transfer",
      body: {
        operatorAddress: operator,
        burnIntent,
        signature: `0x${"c".repeat(130)}`
      }
    });
    assert.equal(transfer.status, 200);
    assert.match(transferUrl, /\/transfer\?enableForwarder=true$/);
    assert.equal((transfer.body as {forwarded: boolean}).forwarded, true);
    assert.equal((transfer.body as {destination: {recipient: string}}).destination.recipient.toLowerCase(), agent.toLowerCase());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gateway canonicalizes address-shaped bytes20 fields returned by the estimate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "[]")) as Array<{spec: Record<string, unknown>}>;
    const spec = {...payload[0].spec};
    for (const field of ["sourceContract", "destinationContract", "sourceToken", "destinationToken", "sourceDepositor", "destinationRecipient", "sourceSigner", "destinationCaller"]) {
      spec[field] = String(spec[field]).slice(-40).replace(/^/, "0x");
    }
    return Response.json({body: [{burnIntent: {maxBlockHeight: "99999999", maxFee: "100", spec}}]});
  };

  try {
    const response = await handleAppRequest({
      method: "POST",
      url: "http://localhost/api/gateway/estimate",
      body: {operatorAddress: operator, sourceChainId: 5042002, destinationChainId: 84532, destinationRecipient: agent, amountUsdc: 2, salt: `0x${"b".repeat(64)}`}
    });
    assert.equal(response.status, 200);
    const burnIntent = (response.body as {burnIntent: {spec: Record<string, string>}}).burnIntent;
    assert.equal(burnIntent.spec.sourceSigner, bytes32Address(operator));
    assert.equal(burnIntent.spec.destinationRecipient, bytes32Address(agent));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gateway rejects same-domain estimates before calling Circle", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("unexpected upstream request");
  };

  try {
    const response = await handleAppRequest({
      method: "POST",
      url: "http://localhost/api/gateway/estimate",
      body: {
        operatorAddress: operator,
        sourceChainId: 5042002,
        destinationChainId: 5042002,
        destinationRecipient: agent,
        amountUsdc: 2,
        salt: `0x${"b".repeat(64)}`
      }
    });
    assert.equal(response.status, 400);
    assert.match(String((response.body as {error?: string}).error), /must differ/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gateway rejects tampered burn-intent routes and oversized values", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("unexpected upstream request");
  };

  const baseIntent = {
    maxBlockHeight: "99999999",
    maxFee: "100",
    spec: {
      version: 1,
      sourceDomain: 26,
      destinationDomain: 6,
      sourceContract: bytes32Address(gatewayWallet),
      destinationContract: bytes32Address(gatewayMinter),
      sourceToken: bytes32Address(arcUsdc),
      destinationToken: bytes32Address(baseSepoliaUsdc),
      sourceDepositor: bytes32Address(operator),
      destinationRecipient: bytes32Address(agent),
      sourceSigner: bytes32Address(operator),
      destinationCaller: bytes32Address("0x0000000000000000000000000000000000000000"),
      value: "2000000",
      salt: `0x${"b".repeat(64)}`,
      hookData: "0x"
    }
  };
  const cases = [
    {
      label: "same domain",
      update: (intent: typeof baseIntent) => {
        intent.spec.destinationDomain = intent.spec.sourceDomain;
      },
      error: /must differ/
    },
    {
      label: "source token",
      update: (intent: typeof baseIntent) => {
        intent.spec.sourceToken = `0x${"1".repeat(24)}${arcUsdc.slice(2).toLowerCase()}`;
      },
      error: /source token mismatch/
    },
    {
      label: "destination token",
      update: (intent: typeof baseIntent) => {
        intent.spec.destinationToken = bytes32Address(agent);
      },
      error: /destination token mismatch/
    },
    {
      label: "destination caller",
      update: (intent: typeof baseIntent) => {
        intent.spec.destinationCaller = bytes32Address(agent);
      },
      error: /destination caller is not supported/
    },
    {
      label: "transfer ceiling",
      update: (intent: typeof baseIntent) => {
        intent.spec.value = "100000001";
      },
      error: /exceeds the 100 USDC limit/
    }
  ];

  try {
    for (const item of cases) {
      const burnIntent = structuredClone(baseIntent);
      item.update(burnIntent);
      const response = await handleAppRequest({
        method: "POST",
        url: "http://localhost/api/gateway/transfer",
        body: {
          operatorAddress: operator,
          burnIntent,
          signature: `0x${"c".repeat(130)}`
        }
      });
      assert.equal(response.status, 400, item.label);
      assert.match(String((response.body as {error?: string}).error), item.error, item.label);
    }
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
