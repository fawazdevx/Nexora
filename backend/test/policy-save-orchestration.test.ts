import assert from "node:assert/strict";
import test from "node:test";
import {completePolicySave, type PolicySaveStage} from "../../frontend/lib/policy-save.js";
import {assertSuccessfulTransactionReceipt} from "../../frontend/lib/transaction-status.js";

const transactionHash = `0x${"ab".repeat(32)}`;

test("a pending Circle registration resumes the same policy save after confirmation", async () => {
  const calls: string[] = [];
  const stages: PolicySaveStage[] = [];

  const result = await completePolicySave({
    async register() {
      calls.push("register");
      return {
        status: "pending",
        registered: false,
        transactionId: "circle-registration-id",
        txHash: null
      };
    },
    async waitForRegistration(registration) {
      calls.push("wait");
      assert.equal(registration.transactionId, "circle-registration-id");
    },
    async writeOnchain({skipBasicPolicy}) {
      calls.push("write");
      assert.equal(skipBasicPolicy, true);
      return transactionHash;
    },
    async persist(txHash) {
      calls.push("persist");
      assert.equal(txHash, transactionHash);
    },
    onStage(stage) {
      stages.push(stage);
    }
  });

  assert.equal(result, transactionHash);
  assert.deepEqual(calls, ["register", "wait", "write", "persist"]);
  assert.deepEqual(stages, ["registering", "waiting_registration", "writing_policy", "persisting"]);
});

test("an existing registration still updates the basic and advanced policy", async () => {
  let receivedSkipBasicPolicy: boolean | null = null;

  await completePolicySave({
    async register() {
      return {
        status: "already_registered",
        registered: false,
        transactionId: null,
        txHash: transactionHash
      };
    },
    async waitForRegistration() {
      throw new Error("wait must not run for an active registration");
    },
    async writeOnchain({skipBasicPolicy}) {
      receivedSkipBasicPolicy = skipBasicPolicy;
      return transactionHash;
    },
    async persist() {
      return undefined;
    }
  });

  assert.equal(receivedSkipBasicPolicy, false);
});

test("a registration timeout preserves the incomplete save by stopping before writes and persistence", async () => {
  let writes = 0;
  let persists = 0;

  await assert.rejects(
    completePolicySave({
      async register() {
        return {
          status: "pending",
          registered: false,
          transactionId: "circle-registration-id",
          txHash: null
        };
      },
      async waitForRegistration() {
        throw new Error("registration is still pending");
      },
      async writeOnchain() {
        writes += 1;
        return transactionHash;
      },
      async persist() {
        persists += 1;
      }
    }),
    /registration is still pending/
  );

  assert.equal(writes, 0);
  assert.equal(persists, 0);
});

test("policy transaction receipt validation rejects reverted writes", () => {
  assert.doesNotThrow(() => assertSuccessfulTransactionReceipt({status: "success"}, "Advanced policy"));
  assert.throws(
    () => assertSuccessfulTransactionReceipt({status: "reverted"}, "Advanced policy"),
    /Advanced policy transaction reverted/
  );
});
