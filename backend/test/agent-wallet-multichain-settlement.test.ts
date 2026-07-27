import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

const operator = "0x1111111111111111111111111111111111111111";
const baseWallet = "0x2222222222222222222222222222222222222222";
const arbWallet = "0x3333333333333333333333333333333333333333";
const basePolicyRegistry = "0x195f70790d977983586d90f2000725B6e26684eE";
const arbPolicyRegistry = "0x30c8cc3C07F822f8cCb8ab2df2a8485DDb210328";
const baseLedger = "0x12B6fF427abA4f0438EA6B5af7E1e49e55DeaB2D";
const arbLedger = "0x195f70790d977983586d90f2000725B6e26684eE";
const baseUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const arbUsdc = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const requestHash = `0x${"ab".repeat(32)}`;

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

const {submitAgentX402Settlement} = await import("../src/circle/agent-wallets.js");
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
