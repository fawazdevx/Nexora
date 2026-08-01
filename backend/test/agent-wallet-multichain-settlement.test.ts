import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {decodeFunctionData, parseAbi} from "viem";

const operator = "0x1111111111111111111111111111111111111111";
const baseWallet = "0x2222222222222222222222222222222222222222";
const arbWallet = "0x3333333333333333333333333333333333333333";
const basePolicyRegistry = "0x195f70790d977983586d90f2000725B6e26684eE";
const arbPolicyRegistry = "0x30c8cc3C07F822f8cCb8ab2df2a8485DDb210328";
const baseLedger = "0x12B6fF427abA4f0438EA6B5af7E1e49e55DeaB2D";
const arbLedger = "0x195f70790d977983586d90f2000725B6e26684eE";
const baseUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const arbUsdc = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const arcWallet = "0x4444444444444444444444444444444444444444";
const arcPolicyRegistry = "0x5555555555555555555555555555555555555555";
const arcLedger = "0x6666666666666666666666666666666666666666";
const arcUsdc = "0x7777777777777777777777777777777777777777";
const arcMemoContract = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const requestHash = `0x${"ab".repeat(32)}`;
const memoId = `0x${"cd".repeat(32)}`;

const tempDirectory = await mkdtemp(join(tmpdir(), "nexora-agent-wallet-multichain-"));
process.env.DATABASE_URL = "";
process.env.NEXORA_STORE_PATH = join(tempDirectory, "store.json");
process.env.CIRCLE_API_KEY = "test-circle-api-key";
process.env.CIRCLE_ENTITY_SECRET = "0".repeat(64);
process.env.CIRCLE_AGENT_WALLET_ACCOUNT_TYPE = "EOA";
process.env.BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS = basePolicyRegistry;
process.env.BASE_SEPOLIA_X402_LEDGER_ADDRESS = baseLedger;
process.env.BASE_SEPOLIA_USDC_ADDRESS = baseUsdc;
process.env.ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS = arbPolicyRegistry;
process.env.ARB_SEPOLIA_X402_LEDGER_ADDRESS = arbLedger;
process.env.ARB_SEPOLIA_USDC_ADDRESS = arbUsdc;
process.env.USDC_ADDRESS = arcUsdc;
process.env.POLICY_REGISTRY_ADDRESS = arcPolicyRegistry;
process.env.X402_LEDGER_ADDRESS = arcLedger;

const {ensureCircleAgentPolicyRegistration, submitAgentX402Settlement} = await import("../src/circle/agent-wallets.js");
const {updateStore} = await import("../src/store.js");

test.after(async () => {
  await rm(tempDirectory, {recursive: true, force: true});
});

for (const route of [
  {
    name: "Base Sepolia",
    chainId: 84532,
    wallet: baseWallet,
    walletId: "circle-base-wallet-id",
    circleBlockchain: "BASE-SEPOLIA",
    policyRegistry: basePolicyRegistry,
    ledger: baseLedger,
    usdc: baseUsdc
  },
  {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    wallet: arbWallet,
    walletId: "circle-arb-wallet-id",
    circleBlockchain: "ARB-SEPOLIA",
    policyRegistry: arbPolicyRegistry,
    ledger: arbLedger,
    usdc: arbUsdc
  }
]) {
  test(`agent-wallet purchase selects the ${route.name} wallet, USDC, ledger, and policy registry`, async () => {
    await seedAgent(route);
    const circleEstimates: Array<Record<string, unknown>> = [];
    const circleExecutions: Array<Record<string, unknown>> = [];
    const contractReads: Array<Record<string, unknown>> = [];
    const nativeBalanceReads: Array<Record<string, unknown>> = [];
    const idempotencyKeys = ["approval-idempotency-key", "settlement-idempotency-key"];

    const result = await submitAgentX402Settlement({
      agentId: `agent-${route.chainId}`,
      operatorAddress: operator,
      serviceId: 6,
      requestHash,
      amountUsdc: 0.025,
      units: 1,
      settlementChainId: route.chainId
    }, {
      circleClient: () => ({
        async estimateContractExecutionFee(input) {
          circleEstimates.push(input as unknown as Record<string, unknown>);
          return {data: {medium: {networkFee: "0.0001", networkFeeRaw: "0.00008"}}} as never;
        },
        async createContractExecutionTransaction(input) {
          circleExecutions.push(input as unknown as Record<string, unknown>);
          return {data: {id: circleExecutions.length === 1 ? "circle-approval-id" : "circle-settlement-id"}} as never;
        },
        async getTransaction() {
          throw new Error("pollTransaction injection must be used");
        }
      }),
      publicClient: (context) => {
        assert.equal(context.chainId, route.chainId);
        return {
          async readContract(input: Record<string, unknown>) {
            contractReads.push(input);
            if (input.functionName === "agentProfiles") {
              return [operator, `0x${"00".repeat(32)}`, true] as const;
            }
            if (input.functionName === "balanceOf") return 1_000_000n;
            throw new Error(`unexpected contract read: ${String(input.functionName)}`);
          },
          async getBalance(input: Record<string, unknown>) {
            nativeBalanceReads.push(input);
            return 1_000_000_000_000_000_000n;
          }
        } as never;
      },
      pollTransaction: async (transactionId) => ({
        state: "COMPLETE",
        txHash: transactionId === "circle-settlement-id" ? `0x${"cd".repeat(32)}` : `0x${"ef".repeat(32)}`
      }),
      idempotencyKey: () => idempotencyKeys.shift() ?? "unexpected-idempotency-key"
    });

    assert.equal(result.settlementChainId, route.chainId);
    assert.equal(result.agentWallet.toLowerCase(), route.wallet.toLowerCase());
    assert.equal(result.txHash, `0x${"cd".repeat(32)}`);
    assert.equal(result.networkFeeCurrency, "ETH");

    assert.equal(contractReads[0]?.address, route.policyRegistry);
    assert.equal(contractReads[0]?.functionName, "agentProfiles");
    assert.deepEqual(contractReads[0]?.args, [route.wallet]);
    assert.equal(contractReads[1]?.address, route.usdc);
    assert.equal(contractReads[1]?.functionName, "balanceOf");
    assert.deepEqual(nativeBalanceReads, [{address: route.wallet}, {address: route.wallet}]);

    assert.equal(circleEstimates.length, 2);
    assert.deepEqual(circleEstimates.map((estimate) => estimate.source), [
      {walletId: route.walletId},
      {walletId: route.walletId}
    ]);
    assert.deepEqual(circleEstimates.map((estimate) => estimate.contractAddress), [route.usdc, route.ledger]);
    assert.deepEqual(circleExecutions.map((execution) => execution.contractAddress), [route.usdc, route.ledger]);
    assert.deepEqual(circleExecutions.map((execution) => execution.walletId), [route.walletId, route.walletId]);
    assert.deepEqual(circleExecutions.map((execution) => execution.idempotencyKey), [
      "approval-idempotency-key",
      "settlement-idempotency-key"
    ]);
    assert.deepEqual(circleExecutions[0]?.abiParameters, [route.ledger, "25000"]);
    assert.deepEqual(circleExecutions[1]?.abiParameters, ["6", requestHash, "1"]);
  });
}

test("inactive Base policy registration blocks before Circle estimates or transactions", async () => {
  const route = {
    name: "Base Sepolia",
    chainId: 84532,
    wallet: baseWallet,
    walletId: "circle-base-wallet-id",
    circleBlockchain: "BASE-SEPOLIA",
    policyRegistry: basePolicyRegistry,
    ledger: baseLedger,
    usdc: baseUsdc
  };
  await seedAgent(route);
  let circleCalls = 0;

  await assert.rejects(
    submitAgentX402Settlement({
      agentId: `agent-${route.chainId}`,
      operatorAddress: operator,
      serviceId: 1,
      requestHash,
      amountUsdc: 0.025,
      units: 1,
      settlementChainId: route.chainId
    }, {
      circleClient: () => ({
        async estimateContractExecutionFee() {
          circleCalls += 1;
          return {data: {medium: {networkFee: "0.0001"}}} as never;
        },
        async createContractExecutionTransaction() {
          circleCalls += 1;
          return {data: {id: "must-not-submit"}} as never;
        },
        async getTransaction() {
          throw new Error("must not poll");
        }
      }),
      publicClient: () => ({
        async readContract() {
          return [operator, `0x${"00".repeat(32)}`, false] as const;
        }
      } as never)
    }),
    /not registered with an active policy on Base Sepolia/
  );
  assert.equal(circleCalls, 0);
});

test("a new Circle agent policy is registered by the Circle wallet before operator-managed updates", async () => {
  const route = {
    name: "Base Sepolia",
    chainId: 84532,
    wallet: baseWallet,
    walletId: "circle-base-wallet-id",
    circleBlockchain: "BASE-SEPOLIA",
    policyRegistry: basePolicyRegistry,
    ledger: baseLedger,
    usdc: baseUsdc
  };
  await seedAgent(route);
  const executions: Array<Record<string, unknown>> = [];
  const result = await ensureCircleAgentPolicyRegistration(`agent-${route.chainId}`, {
    operatorAddress: operator,
    chainId: route.chainId,
    policyRegistry: route.policyRegistry,
    dailyLimitUsdc: 125,
    transactionCapUsdc: 15,
    contractAllowlist: [route.ledger],
    recipientAllowlist: ["0x8888888888888888888888888888888888888888"]
  }, {
    circleClient: () => ({
      async estimateContractExecutionFee() {
        return {data: {medium: {networkFee: "0.0001"}}} as never;
      },
      async createContractExecutionTransaction(input) {
        executions.push(input as unknown as Record<string, unknown>);
        return {data: {id: "circle-policy-registration"}} as never;
      },
      async getTransaction() {
        throw new Error("pollTransaction injection must be used");
      }
    }),
    publicClient: () => ({
      async readContract() {
        return ["0x0000000000000000000000000000000000000000", `0x${"00".repeat(32)}`, false] as const;
      },
      async getBalance() {
        return 1_000_000_000_000_000_000n;
      }
    } as never),
    pollTransaction: async () => ({state: "COMPLETE", txHash: `0x${"91".repeat(32)}`}),
    idempotencyKey: () => "policy-registration-idempotency-key"
  });

  assert.equal(result.status, "registered");
  assert.equal(result.registered, true);
  assert.equal(result.agentWallet, route.wallet);
  assert.equal(result.txHash, `0x${"91".repeat(32)}`);
  assert.equal(executions.length, 1);
  assert.equal(executions[0]?.walletId, route.walletId);
  assert.equal(executions[0]?.contractAddress, route.policyRegistry);
  assert.equal(
    executions[0]?.abiFunctionSignature,
    "configureAgentPolicy(address,address,bytes32,uint256,uint256,bool,bool,bool,address[],address[])"
  );
  assert.equal(executions[0]?.idempotencyKey, "policy-registration-idempotency-key");
  const parameters = executions[0]?.abiParameters as unknown[];
  assert.equal(parameters[0], route.wallet);
  assert.equal(parameters[1], operator);
  assert.equal(parameters[3], "125000000");
  assert.equal(parameters[4], "15000000");
  assert.deepEqual(parameters[8], [route.ledger.toLowerCase()]);
  assert.deepEqual(parameters[9], ["0x8888888888888888888888888888888888888888"]);
});

test("an already registered Circle policy does not submit another Circle transaction", async () => {
  const route = {
    name: "Base Sepolia",
    chainId: 84532,
    wallet: baseWallet,
    walletId: "circle-base-wallet-id",
    circleBlockchain: "BASE-SEPOLIA",
    policyRegistry: basePolicyRegistry,
    ledger: baseLedger,
    usdc: baseUsdc
  };
  await seedAgent(route);
  let circleCalls = 0;
  const result = await ensureCircleAgentPolicyRegistration(`agent-${route.chainId}`, {
    operatorAddress: operator,
    chainId: route.chainId,
    policyRegistry: route.policyRegistry,
    dailyLimitUsdc: 100,
    transactionCapUsdc: 10,
    contractAllowlist: [],
    recipientAllowlist: []
  }, {
    circleClient: () => {
      circleCalls += 1;
      throw new Error("Circle must not be initialized for an active registration");
    },
    publicClient: () => ({
      async readContract() {
        return [operator, `0x${"00".repeat(32)}`, true] as const;
      }
    } as never)
  });

  assert.equal(result.status, "already_registered");
  assert.equal(result.registered, false);
  assert.equal(circleCalls, 0);
});

test("an unfunded Base EOA is blocked before its Circle approval transaction", async () => {
  const route = {
    name: "Base Sepolia",
    chainId: 84532,
    wallet: baseWallet,
    walletId: "circle-base-wallet-id",
    circleBlockchain: "BASE-SEPOLIA",
    policyRegistry: basePolicyRegistry,
    ledger: baseLedger,
    usdc: baseUsdc
  };
  await seedAgent(route);
  let submitted = false;

  await assert.rejects(
    submitAgentX402Settlement({
      agentId: `agent-${route.chainId}`,
      operatorAddress: operator,
      serviceId: 1,
      requestHash,
      amountUsdc: 0.025,
      units: 1,
      settlementChainId: route.chainId
    }, {
      circleClient: () => ({
        async estimateContractExecutionFee() {
          return {data: {medium: {networkFee: "0.0001"}}} as never;
        },
        async createContractExecutionTransaction() {
          submitted = true;
          return {data: {id: "must-not-submit"}} as never;
        },
        async getTransaction() {
          throw new Error("must not poll");
        }
      }),
      publicClient: () => ({
        async readContract(input: Record<string, unknown>) {
          if (input.functionName === "agentProfiles") return [operator, `0x${"00".repeat(32)}`, true] as const;
          return 1_000_000n;
        },
        async getBalance() {
          return 0n;
        }
      } as never)
    }),
    /Fund this agent wallet with native ETH on Base Sepolia/
  );
  assert.equal(submitted, false);
});

test("Arc EOA settlement sends the ledger call through Memo with bytes32 identifiers in the correct order", async () => {
  const route = {
    name: "Arc Testnet",
    chainId: 5042002,
    wallet: arcWallet,
    walletId: "circle-arc-wallet-id",
    circleBlockchain: "ARC-TESTNET",
    policyRegistry: arcPolicyRegistry,
    ledger: arcLedger,
    usdc: arcUsdc
  };
  await seedAgent(route);
  const executions: Array<Record<string, unknown>> = [];
  const memo = structuredMemo(memoId, requestHash);

  await submitAgentX402Settlement({
    agentId: `agent-${route.chainId}`,
    operatorAddress: operator,
    serviceId: 9,
    requestHash,
    amountUsdc: 0.025,
    units: 1,
    settlementChainId: route.chainId,
    memo
  }, {
    circleClient: () => ({
      async estimateContractExecutionFee() {
        return {data: {medium: {networkFee: "0.0001", networkFeeRaw: "0.0001"}}} as never;
      },
      async createContractExecutionTransaction(input) {
        executions.push(input as unknown as Record<string, unknown>);
        return {data: {id: executions.length === 1 ? "arc-approval" : "arc-settlement"}} as never;
      },
      async getTransaction() {
        throw new Error("pollTransaction injection must be used");
      }
    }),
    publicClient: () => ({
      async readContract(input: Record<string, unknown>) {
        if (input.functionName === "agentProfiles") return [operator, `0x${"00".repeat(32)}`, true] as const;
        if (input.functionName === "balanceOf") return 1_000_000n;
        throw new Error(`unexpected contract read: ${String(input.functionName)}`);
      }
    } as never),
    pollTransaction: async () => ({state: "COMPLETE", txHash: null}),
    idempotencyKey: () => crypto.randomUUID()
  });

  assert.equal(executions.length, 2);
  assert.equal(executions[1]?.contractAddress, arcMemoContract);
  assert.equal(executions[1]?.abiFunctionSignature, "memo(address,bytes,bytes32,bytes)");
  const parameters = executions[1]?.abiParameters as string[];
  assert.equal(parameters[0], arcLedger);
  assert.equal(parameters[2], memoId);
  assert.match(parameters[3] ?? "", /^0x[0-9a-f]+$/i);
  const decoded = decodeFunctionData({
    abi: parseAbi(["function settleAgentRequest(uint256 serviceId,bytes32 requestHash,uint256 units)"]),
    data: parameters[1] as `0x${string}`
  });
  assert.deepEqual(decoded.args, [9n, requestHash, 1n]);
});

test("agent-wallet settlement retries reuse stable Circle idempotency keys", async () => {
  const route = {
    name: "Arc Testnet",
    chainId: 5042002,
    wallet: arcWallet,
    walletId: "circle-arc-wallet-id",
    circleBlockchain: "ARC-TESTNET",
    policyRegistry: arcPolicyRegistry,
    ledger: arcLedger,
    usdc: arcUsdc
  };
  await seedAgent(route);
  const idempotencyKeys: string[] = [];
  let transactionNumber = 0;
  const dependencies = {
    circleClient: () => ({
      async estimateContractExecutionFee() {
        return {data: {medium: {networkFee: "0.0001"}}} as never;
      },
      async createContractExecutionTransaction(input: {idempotencyKey?: string}) {
        idempotencyKeys.push(input.idempotencyKey ?? "");
        transactionNumber += 1;
        return {data: {id: `retry-transaction-${transactionNumber}`}} as never;
      },
      async getTransaction() {
        throw new Error("pollTransaction injection must be used");
      }
    }),
    publicClient: () => ({
      async readContract(input: Record<string, unknown>) {
        if (input.functionName === "agentProfiles") return [operator, `0x${"00".repeat(32)}`, true] as const;
        return 1_000_000n;
      }
    } as never),
    pollTransaction: async () => ({state: "COMPLETE", txHash: `0x${"ef".repeat(32)}`})
  };

  const input = {
    agentId: "agent-5042002",
    operatorAddress: operator,
    authorizationId: "authorization-retry-safe",
    serviceId: 9,
    requestHash,
    amountUsdc: 0.025,
    units: 1,
    settlementChainId: 5042002
  };
  await submitAgentX402Settlement(input, dependencies);
  await submitAgentX402Settlement(input, dependencies);

  assert.equal(idempotencyKeys.length, 4);
  assert.deepEqual(idempotencyKeys.slice(0, 2), idempotencyKeys.slice(2));
  assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
  assert.match(idempotencyKeys[0] ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("malformed request and memo identifiers are rejected before any Circle call", async () => {
  let circleCalls = 0;
  const circleClient = () => {
    circleCalls += 1;
    throw new Error("Circle must not be initialized");
  };

  await assert.rejects(submitAgentX402Settlement({
    agentId: "agent-5042002",
    operatorAddress: operator,
    serviceId: 9,
    requestHash: "0x1234",
    amountUsdc: 0.025,
    units: 1,
    settlementChainId: 5042002
  }, {circleClient: circleClient as never}), /requestHash must be a 32-byte hexadecimal value/);

  await assert.rejects(submitAgentX402Settlement({
    agentId: "agent-5042002",
    operatorAddress: operator,
    serviceId: 9,
    requestHash,
    amountUsdc: 0.025,
    units: 1,
    settlementChainId: 5042002,
    memo: structuredMemo("0x1234", requestHash)
  }, {circleClient: circleClient as never}), /memoId must be a 32-byte hexadecimal value/);
  assert.equal(circleCalls, 0);
});

function structuredMemo(id: string, hash: string) {
  return {
    protocol: "nexora.memo" as const,
    version: "1.0" as const,
    type: "nexora.x402.purchase" as const,
    memoId: id,
    memoData: {
      agentId: "agent-5042002",
      agentWallet: arcWallet,
      operatorAddress: operator,
      serviceId: "5042002:9",
      serviceName: "Test service",
      publisherAddress: operator,
      requestHash: hash,
      authorizationId: "authorization-1",
      units: 1,
      amountUsdc: 0.025,
      budgetBucket: "developer_tools",
      policy: {mode: "auto" as const, dailyLimitUsdc: 100, transactionCapUsdc: 10, requireOnchainPolicy: false},
      privacy: {scope: "selective" as const, publicFields: ["requestHash"], privateFields: []},
      intent: "Test memo-backed settlement",
      createdAt: new Date().toISOString()
    },
    encoding: "json" as const,
    arc: {memoContract: arcMemoContract, targetContract: null, callDataHash: null, memoIndex: null}
  };
}

async function seedAgent(route: {
  chainId: number;
  name: string;
  wallet: string;
  walletId: string;
  circleBlockchain: string;
  policyRegistry: string;
}) {
  await updateStore((store) => {
    store.agents = [{
      id: `agent-${route.chainId}`,
      walletKind: "circle_developer",
      operatorAddress: operator,
      arcName: "test-agent.arc",
      address: null,
      circleWalletStatus: "ready",
      circleWalletSetId: "circle-wallet-set-id",
      circleWalletId: null,
      circleAccountType: "EOA",
      settlementMode: "eoa_memo",
      chainWallets: [{
        chainId: route.chainId,
        chain: route.name,
        circleBlockchain: route.circleBlockchain,
        address: route.wallet,
        circleWalletId: route.walletId,
        status: "ready",
        updatedAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      policy: {
        dailyLimitUsdc: 100,
        transactionCapUsdc: 10,
        contractAllowlist: [],
        recipientAllowlist: [],
        active: true,
        txHash: null,
        deployments: [{
          chainId: route.chainId,
          txHash: `0x${"12".repeat(32)}`,
          policyRegistry: route.policyRegistry,
          updatedAt: new Date().toISOString()
        }],
        v2: {
          weeklyLimitUsdc: 0,
          monthlyLimitUsdc: 0,
          maxUnitsPerRequest: 0,
          cooldownSeconds: 0,
          expiresAt: null,
          serviceAllowlist: [],
          requireOnchainPolicy: false
        }
      }
    }];
    store.payments = [];
  });
}
