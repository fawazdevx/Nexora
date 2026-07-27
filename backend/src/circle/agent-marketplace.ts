import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {promisify} from "node:util";
import {createPublicClient, http, isAddress, parseAbi, parseEventLogs, type Hex} from "viem";
import {agentChainContexts} from "../chains.js";
import {config} from "../config.js";
import {dispatchNotification} from "../notifications.js";
import {evaluateAutomationRecipesForOperator} from "../automation/recipes.js";
import {evaluateAgentPolicy, type PolicyRemediation} from "../policies/engine.js";
import {safeHttpUrl} from "../security.js";
import {insertPayment, insertPaymentIntent, isVisibleAgent, pushNotification, readStore, updatePaymentIntentById, withAgentSpendLock} from "../store.js";
import type {AgentWalletRecord, PaymentIntentRecord, PaymentRecord, ServiceRecord} from "../store.js";
import {executeCircleDeveloperWalletX402, type CircleDeveloperWalletX402Result} from "./developer-wallet-x402.js";

export type CircleCliRunner = (args: string[], options?: {timeoutMs?: number}) => Promise<{stdout: string; stderr: string}>;
export type CircleDiscoveryFetcher = (url: string) => Promise<unknown>;

export type CircleAgentService = {
  name: string;
  description: string;
  url: string;
  priceUsdc: number;
  publisherAddress: string | null;
  assetAddress: string | null;
  acceptedChains: string[];
  paymentScheme: string | null;
  method: string;
  inputSchema: unknown;
};

export type CircleAgentMarketplaceReadiness = {
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "ready" | "managed_wallet_unavailable" | "cli_missing" | "terms_required" | "not_logged_in" | "wallet_status_error";
  cliPath: string;
  cliVersion: string | null;
  defaultChain: string;
  supportedChains: string[];
  requireConfirmation: boolean;
  maxPaymentUsdc: number;
  requiredEnv: string[];
  message: string;
};

export type CirclePaymentGuard = {
  allowed: boolean;
  decision: "allow" | "block";
  payment: {
    walletAddress: string;
    chain: string;
    amountUsdc: number;
    requestHash: string;
    service: CircleAgentService;
  };
  policy: {
    allowed: boolean;
    reason: string | null;
    remediation: PolicyRemediation | null;
    dailySpentUsdc: number;
    weeklySpentUsdc: number;
    monthlySpentUsdc: number;
  };
  checks: Array<{status: "pass" | "fail"; label: string; detail: string}>;
};

type CircleMarketplaceOptions = Partial<{
  enabled: boolean;
  runner: CircleCliRunner;
  discoveryFetch: CircleDiscoveryFetcher;
  defaultChain: string;
  requireConfirmation: boolean;
  maxPaymentUsdc: number;
  executor: CirclePaymentExecutor;
}>;

export type CirclePaymentExecutor = (input: {
  payment: CirclePaymentInput;
  guard: CirclePaymentGuard;
  walletId: string;
  method: string;
}) => Promise<CircleDeveloperWalletX402Result>;

export type ExternalCircleSettlementVerifier = (input: {
  intent: PaymentIntentRecord;
  txHash: Hex;
}) => Promise<void>;

type CirclePaymentInput = {
  operatorAddress: string;
  agentId?: string | null;
  walletAddress: string;
  serviceUrl: string;
  chain?: string | null;
  data?: Record<string, unknown>;
};

type CirclePayInput = CirclePaymentInput & {
  confirmed?: boolean;
};

type CirclePaymentIntentDecisionInput = {
  operatorAddress: string;
  note?: string | null;
};

type CirclePaymentIntentExecutionInput = {
  operatorAddress: string;
  confirmed?: boolean;
};

const execFileAsync = promisify(execFile);
const requiredEnv = [
  "NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED",
  "CIRCLE_API_KEY",
  "CIRCLE_ENTITY_SECRET",
  "NEXORA_CIRCLE_DEFAULT_CHAIN",
  "NEXORA_CIRCLE_PAYMENT_MAX_USDC"
];
const zeroAddress = "0x0000000000000000000000000000000000000000";
const erc20TransferAbi = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);

export const defaultCircleCliRunner: CircleCliRunner = async (args, options) => {
  const result = await execFileAsync(config.circle.agentMarketplace.cliPath, args, {
    timeout: options?.timeoutMs ?? 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: buildCircleCliEnv()
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
};

export const defaultCircleDiscoveryFetcher: CircleDiscoveryFetcher = async (url) => {
  const response = await fetch(url, {headers: {accept: "application/json"}});
  if (!response.ok) throw httpError(publicCircleUnavailableMessage("search"), 502);
  return response.json() as Promise<unknown>;
};

export async function circleAgentMarketplaceReadiness(options: CircleMarketplaceOptions = {}): Promise<CircleAgentMarketplaceReadiness> {
  const settings = marketplaceSettings(options);
  if (!settings.enabled) {
    return readiness({
      settings,
      configured: false,
      status: "disabled",
      cliVersion: null,
      message: "Circle service payments are not enabled for this workspace."
    });
  }

  // An explicitly injected runner is retained as a local test/development
  // adapter. Production web requests never depend on one shared Circle CLI
  // login: each payment signs from the selected developer-controlled wallet.
  if (!options.runner) {
    const configured = Boolean(options.executor || (config.circle.apiKey && config.circle.entitySecret));
    return readiness({
      settings,
      configured,
      status: configured ? "ready" : "managed_wallet_unavailable",
      cliVersion: null,
      message: configured
        ? "Managed Circle wallet execution is ready."
        : "Service discovery and Nexora approvals are available. Managed execution needs Circle developer-wallet credentials; external Agent Stack wallets can complete approved intents through the SDK."
    });
  }

  try {
    const version = await settings.runner(["--version"], {timeoutMs: 10_000});
    const cliVersion = compactText(version.stdout || version.stderr);
    return await readinessFromWalletStatus(settings, cliVersion);
  } catch (error) {
    const status = isMissingCliError(error) ? "cli_missing" : "wallet_status_error";
    if (status !== "cli_missing") {
      return readinessFromWalletStatus(settings, null);
    }
    return readiness({
      settings,
      configured: false,
      status,
      cliVersion: null,
      message: status === "cli_missing" ? "Circle payments are not available in this workspace yet." : versionFailureMessage(error)
    });
  }
}

async function readinessFromWalletStatus(settings: ReturnType<typeof marketplaceSettings>, cliVersion: string | null) {
  try {
    await settings.runner(["wallet", "status"], {timeoutMs: 10_000});
    return readiness({
      settings,
      configured: true,
      status: "ready",
      cliVersion,
      message: "Circle service payments are ready."
    });
  } catch (error) {
    const message = errorMessage(error);
    if (/terms acceptance|required before use/i.test(message)) {
      return readiness({settings, configured: false, status: "terms_required", cliVersion, message: "Complete Circle wallet setup to enable service payments."});
    }
    if (/not logged in|login/i.test(message) || isEmptyWalletStatusFailure(error)) {
      return readiness({settings, configured: false, status: "not_logged_in", cliVersion, message: "Connect your Circle agent wallet to enable real service payments."});
    }
    return readiness({settings, configured: false, status: "wallet_status_error", cliVersion, message: publicCircleUnavailableMessage()});
  }
}

export async function searchCircleAgentServices(query: string, options: CircleMarketplaceOptions = {}) {
  const settings = marketplaceSettings(options);
  assertMarketplaceEnabled(settings);
  const keyword = String(query ?? "").trim();
  if (!keyword) throw httpError("query is required", 400);
  if (keyword.length > 160) throw httpError("query is too long", 400);
  let services: CircleAgentService[] = [];
  if (options.runner) {
    try {
      const output = await runCircleCli(settings, ["services", "search", keyword, "--output", "json"], {timeoutMs: 30_000});
      services = serviceArrayFromPayload(parseCliJson(output.stdout, "Circle services search")).map((item) => normalizeCircleService(item, null));
    } catch {
      services = [];
    }
  }
  if (services.length === 0) services = serviceArrayFromPayload(await discoveryPayload(settings, {query: keyword, label: "search"})).map((item) => normalizeCircleService(item, null));
  return {
    query: keyword,
    services
  };
}

export async function inspectCircleAgentService(serviceUrl: string, options: CircleMarketplaceOptions = {}) {
  const settings = marketplaceSettings(options);
  assertMarketplaceEnabled(settings);
  const url = safeHttpUrl(serviceUrl, "serviceUrl");
  let service: CircleAgentService | null = null;
  if (options.runner) {
    try {
      const output = await runCircleCli(settings, ["services", "inspect", url, "--output", "json"], {timeoutMs: 30_000});
      service = normalizeCircleService(parseCliJson(output.stdout, "Circle services inspect"), url);
    } catch {
      service = null;
    }
  }
  if (!service || !hasPayableServiceDetails(service)) {
    const payload = await discoveryPayload(settings, {query: url, label: "inspect"});
    const match = serviceArrayFromPayload(payload)
      .map((item) => normalizeCircleService(item, url))
      .find((item) => item.url === url) ?? null;
    service = match ?? null;
  }
  if (!service) throw httpError(publicCircleUnavailableMessage("inspect"), 502);
  return {
    service
  };
}

export async function preflightCircleAgentPayment(input: CirclePaymentInput, options: CircleMarketplaceOptions = {}): Promise<CirclePaymentGuard> {
  const settings = marketplaceSettings(options);
  assertMarketplaceEnabled(settings);
  const serviceUrl = safeHttpUrl(input.serviceUrl, "serviceUrl");
  const chain = normalizeChain(input.chain || settings.defaultChain);
  const walletAddress = assertAddress(input.walletAddress, "walletAddress");
  const operatorAddress = assertAddress(input.operatorAddress, "operatorAddress");
  const inspection = await inspectCircleAgentService(serviceUrl, {...options, ...settings});
  const service = inspection.service;
  const checks: CirclePaymentGuard["checks"] = [];
  const chainSupported = settings.supportedChains.includes(chain);

  const requestHash = paymentRequestHash({
    operatorAddress,
    walletAddress,
    serviceUrl,
    chain,
    data: input.data ?? {}
  });

  checks.push(check(chainSupported, "Nexora chain supported", chainSupported ? `${chain} is enabled for Nexora agent payments.` : `Supported routes: ${settings.supportedChains.join(", ")}.`));
  checks.push(check(service.priceUsdc > 0, "Price available", service.priceUsdc > 0 ? `${service.priceUsdc} USDC per call` : "Service details did not include a positive USDC price."));
  checks.push(check(service.priceUsdc <= settings.maxPaymentUsdc, "Workspace payment cap", `${settings.maxPaymentUsdc} USDC max per Circle service call`));
  checks.push(check(Boolean(service.publisherAddress), "Seller wallet available", service.publisherAddress ?? "Service details did not include the recipient wallet."));
  checks.push(check(service.acceptedChains.includes(chain), "Chain accepted", service.acceptedChains.length > 0 ? `Accepted: ${service.acceptedChains.join(", ")}` : "Service details did not include supported payment chains."));

  const store = await readStore();
  const agent = findOperatorAgent(store.agents, {
    operatorAddress,
    agentId: input.agentId ?? null,
    walletAddress
  });
  const settlementChainId = chainSupported ? chainIdForCircleChain(chain) : null;
  const routeWallet = settlementChainId && agent ? agentWalletForChain(agent, settlementChainId) : null;
  checks.push(check(
    Boolean(routeWallet && routeWallet.toLowerCase() === walletAddress.toLowerCase()),
    "Agent wallet route",
    routeWallet
      ? `Using the agent wallet provisioned for ${networkNameForCircleChain(chain)}.`
      : `This agent does not have a ready wallet for ${networkNameForCircleChain(chain)}.`
  ));
  const syntheticService = circleServiceRecord(service, chain);
  const policy = evaluateAgentPolicy({
    agent,
    service: syntheticService,
    units: 1,
    payments: store.payments
  });
  checks.push(check(policy.allowed, "Agent policy", policy.allowed ? "Existing Nexora policy allows this Circle marketplace payment." : policy.reason ?? "Existing Nexora policy blocked this payment."));

  const allowed = checks.every((item) => item.status === "pass");
  return {
    allowed,
    decision: allowed ? "allow" : "block",
    payment: {
      walletAddress,
      chain,
      amountUsdc: service.priceUsdc,
      requestHash,
      service
    },
    policy: {
      allowed: policy.allowed,
      reason: policy.reason ?? null,
      remediation: policy.remediation ?? null,
      dailySpentUsdc: policy.v2?.dailySpentUsdc ?? 0,
      weeklySpentUsdc: policy.v2?.weeklySpentUsdc ?? 0,
      monthlySpentUsdc: policy.v2?.monthlySpentUsdc ?? 0
    },
    checks
  };
}

export async function payCircleAgentService(input: CirclePayInput, options: CircleMarketplaceOptions = {}) {
  const settings = marketplaceSettings(options);
  assertMarketplaceEnabled(settings);
  if (settings.requireConfirmation && !input.confirmed) {
    throw httpError("payment confirmation is required before spending USDC", 428);
  }

  // Serialize the spend-check → CLI pay → record critical section per agent so
  // two concurrent payments cannot both clear a daily/weekly/monthly cap on a
  // stale spend snapshot and overspend it. In file mode this is a passthrough
  // (the blob write queue already serializes); in DB mode it takes a Postgres
  // advisory lock keyed by the agent, closing the daily-limit TOCTOU.
  return withAgentSpendLock(input.agentId ?? null, async () => {
    const guard = await preflightCircleAgentPayment(input, {...options, ...settings});
    if (!guard.allowed) {
      const payment = await recordCirclePayment({
        input,
        guard,
        status: "policy_blocked",
        policyReason: guard.checks.find((item) => item.status === "fail")?.detail ?? "Circle payment blocked by pre-payment guard"
      });
      throw Object.assign(new Error(payment.policyReason ?? "Circle payment blocked by pre-payment guard"), {status: 402, paymentId: payment.id});
    }

    try {
      const execution = await executeCirclePayment(input, guard, settings, options);
      const receipt = await recordCirclePayment({
        input,
        guard,
        status: "settled",
        txHash: execution.txHash,
        resultSummary: resultSummary(execution.result),
        paymentScheme: execution.paymentScheme || guard.payment.service.paymentScheme
      });
      await evaluateAutomationRecipesForOperator(input.operatorAddress).catch(() => undefined);
      return {
        status: "settled",
        guard,
        receipt,
        result: execution.result,
        paymentResponse: execution.paymentResponse
      };
    } catch (error) {
      if (isHttpError(error) && httpStatus(error) < 500) throw error;
      const payment = await recordCirclePayment({
        input,
        guard,
        status: "failed",
        policyReason: compactText(errorMessage(error))
      });
      const wrapped = httpError(errorMessage(error), httpStatus(error) || 502) as Error & {paymentId?: string};
      wrapped.paymentId = payment.id;
      throw wrapped;
    }
  });
}

async function executeCirclePayment(
  input: CirclePaymentInput,
  guard: CirclePaymentGuard,
  settings: ReturnType<typeof marketplaceSettings>,
  options: CircleMarketplaceOptions
): Promise<CircleDeveloperWalletX402Result> {
  const store = await readStore();
  const agent = findOperatorAgent(store.agents, {
    operatorAddress: input.operatorAddress,
    agentId: input.agentId ?? null,
    walletAddress: guard.payment.walletAddress
  });
  const chainId = chainIdForCircleChain(guard.payment.chain);
  const route = chainId && agent ? agentChainWalletForChain(agent, chainId) : null;
  if (!route?.circleWalletId || !route.address || route.address.toLowerCase() !== guard.payment.walletAddress.toLowerCase()) {
    throw httpError("The selected agent does not have a ready Circle wallet on this service network.", 409);
  }

  if (options.executor) {
    return options.executor({
      payment: input,
      guard,
      walletId: route.circleWalletId,
      method: guard.payment.service.method
    });
  }

  // Explicit runner injection remains useful for deterministic tests and local
  // Agent Stack experiments. It is never the production default.
  if (options.runner) {
    const maxAmount = Math.min(settings.maxPaymentUsdc, guard.payment.amountUsdc);
    const output = await runCircleCli(settings, [
      "services",
      "pay",
      guard.payment.service.url,
      "--address",
      guard.payment.walletAddress,
      "--chain",
      guard.payment.chain,
      "--data",
      JSON.stringify(input.data ?? {}),
      "--max-amount",
      formatUsdc(maxAmount),
      "--output",
      "json"
    ], {timeoutMs: 90_000});
    const payload = parseCliJson(output.stdout, "Circle services pay");
    assertCirclePaymentSucceeded(payload);
    return {
      result: paymentResultPayload(payload),
      txHash: txHashFromPayload(payload),
      paymentResponse: payload,
      paymentScheme: guard.payment.service.paymentScheme ?? "x402"
    };
  }

  return executeCircleDeveloperWalletX402({
    walletId: route.circleWalletId,
    walletAddress: route.address,
    chain: guard.payment.chain,
    serviceUrl: guard.payment.service.url,
    method: guard.payment.service.method,
    data: input.data ?? {},
    maxAmountUsdc: Math.min(settings.maxPaymentUsdc, guard.payment.amountUsdc)
  });
}

export async function createCircleAgentPaymentIntent(input: CirclePaymentInput, options: CircleMarketplaceOptions = {}) {
  const settings = marketplaceSettings(options);
  assertMarketplaceEnabled(settings);
  const guard = await preflightCircleAgentPayment(input, {...options, ...settings});
  const service = circleServiceRecord(guard.payment.service, guard.payment.chain);
  const now = new Date();
  const status: PaymentIntentRecord["status"] = guard.allowed ? "pending_approval" : "policy_blocked";
  const intent: PaymentIntentRecord = {
    id: crypto.randomUUID(),
    operatorAddress: input.operatorAddress,
    agentId: input.agentId ?? null,
    agentWallet: guard.payment.walletAddress,
    requestHash: guard.payment.requestHash,
    status,
    source: {
      provider: "circle_agent_marketplace",
      serviceUrl: guard.payment.service.url,
      inspectedAt: now.toISOString()
    },
    normalized: {
      serviceId: service.id,
      serviceName: service.name,
      description: guard.payment.service.description,
      amountUsdc: guard.payment.amountUsdc,
      payTo: guard.payment.service.publisherAddress ?? zeroAddress,
      chain: guard.payment.chain,
      chainId: chainIdForCircleChain(guard.payment.chain),
      network: networkNameForCircleChain(guard.payment.chain),
      paymentScheme: guard.payment.service.paymentScheme ?? null,
      assetAddress: guard.payment.service.assetAddress ?? agentChainContexts().find((item) => item.chainId === chainIdForCircleChain(guard.payment.chain))?.usdc ?? null,
      inputSchema: guard.payment.service.inputSchema ?? null
    },
    data: input.data ?? {},
    policy: {
      allowed: guard.policy.allowed,
      reason: guard.policy.reason ?? failedCheckDetail(guard) ?? null,
      remediation: guard.policy.remediation ?? null,
      dailySpentUsdc: guard.policy.dailySpentUsdc,
      weeklySpentUsdc: guard.policy.weeklySpentUsdc,
      monthlySpentUsdc: guard.policy.monthlySpentUsdc,
      checks: guard.checks,
      riskFlags: riskFlagsFromGuard(guard)
    },
    approval: {
      required: guard.allowed,
      decidedBy: null,
      decidedAt: null,
      note: null,
      expiresAt: guard.allowed ? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() : null
    },
    execution: {
      paymentId: null,
      txHash: null,
      resultSummary: null,
      error: status === "policy_blocked" ? failedCheckDetail(guard) ?? "Circle payment blocked by policy guard" : null,
      executedAt: null
    },
    receiptId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  const result = await insertPaymentIntent(intent, (store) => {
    const notification = pushNotification(store, {
      operatorAddress: intent.operatorAddress,
      title: status === "pending_approval" ? "Circle payment approval requested" : "Circle payment blocked",
      detail: `${intent.normalized.serviceName} · ${intent.normalized.amountUsdc} USDC`,
      kind: status === "pending_approval" ? "payment" : "policy",
      actionHref: "/payments"
    });
    return {notification};
  });
  if (result?.notification) {
    await dispatchNotification({
      notification: result.notification,
      event: status === "pending_approval" ? "paymentReceipts" : "policyAlerts"
    }).catch(() => undefined);
  }
  return intent;
}

export async function approveCircleAgentPaymentIntent(id: string, input: CirclePaymentIntentDecisionInput) {
  return decideCircleAgentPaymentIntent(id, input, "approved");
}

export async function rejectCircleAgentPaymentIntent(id: string, input: CirclePaymentIntentDecisionInput) {
  return decideCircleAgentPaymentIntent(id, input, "rejected");
}

export async function executeCircleAgentPaymentIntent(id: string, input: CirclePaymentIntentExecutionInput, options: CircleMarketplaceOptions = {}) {
  const intent = await markPaymentIntentExecuting(id, input.operatorAddress);
  try {
    const result = await payCircleAgentService({
      operatorAddress: intent.operatorAddress,
      agentId: intent.agentId ?? null,
      walletAddress: intent.agentWallet ?? "",
      serviceUrl: intent.source.serviceUrl,
      chain: intent.normalized.chain,
      data: intent.data,
      confirmed: input.confirmed
    }, options);
    const updated = await updatePaymentIntentById(id, (current) => {
      assertIntentOperator(current, input.operatorAddress);
      current.status = "settled";
      current.execution = {
        paymentId: result.receipt.id,
        txHash: result.receipt.txHash ?? null,
        resultSummary: resultSummary(result.result),
        error: null,
        executedAt: new Date().toISOString()
      };
      current.receiptId = result.receipt.id;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    return {
      status: "settled",
      intent: updated,
      receipt: result.receipt,
      result: result.result,
      guard: result.guard
    };
  } catch (error) {
    const paymentId = typeof error === "object" && error && "paymentId" in error ? String((error as {paymentId?: unknown}).paymentId ?? "") : null;
    const status = typeof error === "object" && error && "status" in error && Number((error as {status?: unknown}).status) === 402 ? "policy_blocked" : "failed";
    await updatePaymentIntentById(id, (current) => {
      assertIntentOperator(current, input.operatorAddress);
      current.status = status;
      current.execution = {
        ...current.execution,
        paymentId: paymentId || current.execution.paymentId || null,
        error: compactText(errorMessage(error)),
        executedAt: new Date().toISOString()
      };
      current.receiptId = current.execution.paymentId ?? null;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    throw error;
  }
}

export async function completeCircleAgentPaymentIntentFromReceipt(id: string, input: {
  operatorAddress: string;
  paymentResponse: unknown;
  result?: unknown;
}, options: {verifySettlement?: ExternalCircleSettlementVerifier} = {}) {
  const intent = await markPaymentIntentExecuting(id, input.operatorAddress);
  try {
    const normalized = validateExternalCircleReceipt(intent, input.paymentResponse);
    await (options.verifySettlement ?? verifyExternalCircleSettlement)({intent, txHash: normalized.txHash});
    const guard = guardFromIntent(intent);
    const payment = await recordCirclePayment({
      input: {
        operatorAddress: intent.operatorAddress,
        agentId: intent.agentId ?? null,
        walletAddress: intent.agentWallet ?? "",
        serviceUrl: intent.source.serviceUrl,
        chain: intent.normalized.chain,
        data: intent.data
      },
      guard,
      status: "settled",
      txHash: normalized.txHash,
      resultSummary: resultSummary(input.result),
      paymentScheme: intent.normalized.paymentScheme ?? "circle-agent-stack",
      requestHash: `0x${stableHash(`circle-external:${intent.normalized.chainId}:${normalized.txHash.toLowerCase()}`)}`
    });
    const updated = await updatePaymentIntentById(id, (current) => {
      assertIntentOperator(current, input.operatorAddress);
      current.status = "settled";
      current.execution = {
        paymentId: payment.id,
        txHash: payment.txHash ?? null,
        resultSummary: resultSummary(input.result),
        error: null,
        executedAt: new Date().toISOString()
      };
      current.receiptId = payment.id;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    await evaluateAutomationRecipesForOperator(input.operatorAddress).catch(() => undefined);
    return {status: "settled", intent: updated, receipt: payment, result: input.result ?? null};
  } catch (error) {
    await updatePaymentIntentById(id, (current) => {
      assertIntentOperator(current, input.operatorAddress);
      current.status = "failed";
      current.execution = {
        ...current.execution,
        error: externalReceiptError(error),
        executedAt: new Date().toISOString()
      };
      current.updatedAt = new Date().toISOString();
      return current;
    });
    throw httpError(externalReceiptError(error), 400);
  }
}

export async function circleAgentPaymentIntentAuthorization(id: string, operatorAddress: string) {
  const store = await readStore();
  const intent = store.paymentIntents.find((item) => item.id === id);
  if (!intent) throw httpError("payment intent not found", 404);
  assertIntentOperator(intent, operatorAddress);
  return {
    intentId: intent.id,
    approved: intent.status === "approved" && !isExpired(intent),
    status: intent.status,
    expiresAt: intent.approval.expiresAt ?? null,
    payment: {
      serviceUrl: intent.source.serviceUrl,
      walletAddress: intent.agentWallet,
      chain: intent.normalized.chain,
      amountUsdc: intent.normalized.amountUsdc,
      payTo: intent.normalized.payTo,
      assetAddress: intent.normalized.assetAddress ?? null,
      data: intent.data
    }
  };
}

async function decideCircleAgentPaymentIntent(id: string, input: CirclePaymentIntentDecisionInput, status: "approved" | "rejected") {
  const result = await updatePaymentIntentById(id, (intent, store) => {
    assertIntentOperator(intent, input.operatorAddress);
    if (intent.status !== "pending_approval") {
      throw httpError(intent.status === "settled" ? "payment intent already executed" : "payment intent is not pending approval", 409);
    }
    // The expiry transition must persist even though the call is rejected, so it
    // is returned (committed) then thrown after the write lands.
    if (isExpired(intent)) {
      intent.status = "expired";
      intent.updatedAt = new Date().toISOString();
      return {expired: true as const, intent, notification: null};
    }
    if (status === "approved" && !intent.policy.allowed) {
      throw httpError(intent.policy.reason ?? "payment intent is blocked by policy", 402);
    }

    const now = new Date().toISOString();
    intent.status = status;
    intent.approval = {
      ...intent.approval,
      decidedBy: input.operatorAddress,
      decidedAt: now,
      note: input.note ?? intent.approval.note ?? null
    };
    if (status === "rejected") {
      intent.execution = {
        ...intent.execution,
        error: input.note ?? "Rejected by operator"
      };
    }
    intent.updatedAt = now;
    const notification = pushNotification(store, {
      operatorAddress: intent.operatorAddress,
      title: status === "approved" ? "Circle payment approved" : "Circle payment rejected",
      detail: `${intent.normalized.serviceName} · ${intent.normalized.amountUsdc} USDC`,
      kind: status === "approved" ? "payment" : "policy",
      actionHref: "/payments"
    });
    return {expired: false as const, intent, notification};
  });
  if (result.expired) throw httpError("payment intent approval window has expired", 410);
  if (result.notification) {
    await dispatchNotification({
      notification: result.notification,
      event: status === "approved" ? "paymentReceipts" : "policyAlerts"
    }).catch(() => undefined);
  }
  return result.intent;
}

async function markPaymentIntentExecuting(id: string, operatorAddress: string) {
  // The expiry transition must persist even though the call is then rejected,
  // so it is returned (committed) rather than thrown from inside the mutate.
  // Pure validation failures throw inside the mutate to roll the write back.
  const outcome = await updatePaymentIntentById(id, (intent) => {
    assertIntentOperator(intent, operatorAddress);
    if (intent.status === "settled") throw httpError("payment intent already executed", 409);
    if (intent.status === "executing") throw httpError("payment intent is already executing", 409);
    if (intent.status !== "approved") throw httpError("payment intent must be approved before execution", 428);
    if (isExpired(intent)) {
      intent.status = "expired";
      intent.updatedAt = new Date().toISOString();
      return {expired: true as const, intent};
    }
    if (!intent.agentWallet) throw httpError("payment intent is missing an agent wallet", 400);
    intent.status = "executing";
    intent.updatedAt = new Date().toISOString();
    return {expired: false as const, intent};
  });
  if (outcome.expired) throw httpError("payment intent approval window has expired", 410);
  return outcome.intent;
}

function assertIntentOperator(intent: PaymentIntentRecord, operatorAddress: string) {
  if (intent.operatorAddress.toLowerCase() !== operatorAddress.toLowerCase()) {
    throw httpError("payment intent operator wallet required", 403);
  }
  return intent;
}

function isExpired(intent: PaymentIntentRecord) {
  return Boolean(intent.approval.expiresAt && Date.parse(intent.approval.expiresAt) <= Date.now());
}

function failedCheckDetail(guard: CirclePaymentGuard) {
  return guard.checks.find((item) => item.status === "fail")?.detail ?? null;
}

function riskFlagsFromGuard(guard: CirclePaymentGuard): PaymentIntentRecord["policy"]["riskFlags"] {
  const flags = guard.checks
    .filter((item) => item.status === "fail")
    .map((item) => ({
      severity: item.label === "Agent policy" ? "critical" as const : "warning" as const,
      label: item.label,
      detail: item.detail
    }));
  if (guard.payment.amountUsdc >= 1) {
    flags.push({
      severity: "warning",
      label: "High value service call",
      detail: `${formatUsdc(guard.payment.amountUsdc)} is above the normal nanopayment range.`
    });
  }
  if (!guard.payment.service.publisherAddress) {
    flags.push({
      severity: "critical",
      label: "Missing payTo",
      detail: "Service details did not include a payable recipient address."
    });
  }
  return flags;
}

function validateExternalCircleReceipt(intent: PaymentIntentRecord, value: unknown) {
  const parsed = parseExternalReceipt(value);
  const record = objectValue(parsed);
  const nested = objectValue(record.settlement);
  const source = Object.keys(nested).length > 0 ? {...record, ...nested} : record;
  const status = stringValue(source.status ?? source.state);
  if (source.success === false || (status && /fail|error|reject|denied/i.test(status))) {
    throw new Error("The Circle service reported an unsuccessful payment.");
  }
  if (source.success !== true && !(status && /success|settled|complete|confirmed/i.test(status))) {
    throw new Error("A successful Circle payment response is required.");
  }

  const network = stringValue(source.network ?? source.chain);
  if (network && normalizeChain(network) !== normalizeChain(intent.normalized.chain)) {
    throw new Error("The Circle payment response network does not match the approved intent.");
  }
  const payer = stringValue(source.payer ?? source.from ?? source.walletAddress);
  if (payer && (!isAddress(payer) || payer.toLowerCase() !== intent.agentWallet?.toLowerCase())) {
    throw new Error("The Circle payment response payer does not match the approved agent wallet.");
  }
  const payTo = stringValue(source.payTo ?? source.recipient ?? source.to);
  if (payTo && (!isAddress(payTo) || payTo.toLowerCase() !== intent.normalized.payTo.toLowerCase())) {
    throw new Error("The Circle payment response recipient does not match the approved intent.");
  }
  const amount = receiptUsdcAmount(source.amount ?? source.value ?? source.amountUsdc);
  if (amount !== null && Math.abs(amount - intent.normalized.amountUsdc) > 0.000001) {
    throw new Error("The Circle payment response amount does not match the approved intent.");
  }
  const txHash = txHashFromPayload(source);
  if (!txHash) throw new Error("The Circle payment response must include a verifiable transaction hash.");
  return {txHash: txHash as Hex};
}

async function verifyExternalCircleSettlement(input: {intent: PaymentIntentRecord; txHash: Hex}) {
  const chainId = input.intent.normalized.chainId ?? chainIdForCircleChain(input.intent.normalized.chain);
  const context = agentChainContexts().find((item) => item.chainId === chainId);
  const asset = input.intent.normalized.assetAddress || context?.usdc;
  if (!context?.rpcUrl || !asset || !isAddress(asset)) {
    throw new Error("The approved Circle payment chain or USDC asset is not configured for receipt verification.");
  }
  if (!input.intent.agentWallet || !isAddress(input.intent.agentWallet) || !isAddress(input.intent.normalized.payTo)) {
    throw new Error("The approved Circle payment route is incomplete.");
  }

  const client = createPublicClient({transport: http(context.rpcUrl, {timeout: 20_000})});
  const receipt = await client.getTransactionReceipt({hash: input.txHash});
  if (receipt.status !== "success") throw new Error("The Circle payment transaction reverted.");
  const expectedAmount = BigInt(Math.round(input.intent.normalized.amountUsdc * 1_000_000));
  const transfer = parseEventLogs({
    abi: erc20TransferAbi,
    eventName: "Transfer",
    logs: receipt.logs,
    strict: false
  }).find((event) => (
    event.address.toLowerCase() === asset.toLowerCase()
    && event.args.from?.toLowerCase() === input.intent.agentWallet?.toLowerCase()
    && event.args.to?.toLowerCase() === input.intent.normalized.payTo.toLowerCase()
    && event.args.value === expectedAmount
  ));
  if (!transfer) throw new Error("The transaction does not contain the approved USDC payment transfer.");
}

function parseExternalReceipt(value: unknown) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) throw new Error("paymentResponse is required");
  const candidates = [value.trim()];
  try {
    candidates.push(Buffer.from(value.trim(), "base64").toString("utf8"));
  } catch {
    // The plain JSON candidate below will produce the public validation error.
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next supported encoding.
    }
  }
  throw new Error("paymentResponse must be JSON or base64-encoded JSON");
}

function receiptUsdcAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return value.includes(".") || parsed < 1_000 ? parsed : parsed / 1_000_000;
}

function guardFromIntent(intent: PaymentIntentRecord): CirclePaymentGuard {
  const service: CircleAgentService = {
    name: intent.normalized.serviceName.replace(/^Circle:\s*/i, ""),
    description: intent.normalized.description,
    url: intent.source.serviceUrl,
    priceUsdc: intent.normalized.amountUsdc,
    publisherAddress: intent.normalized.payTo,
    assetAddress: intent.normalized.assetAddress ?? null,
    acceptedChains: [intent.normalized.chain],
    paymentScheme: intent.normalized.paymentScheme ?? null,
    method: "POST",
    inputSchema: intent.normalized.inputSchema ?? null
  };
  return {
    allowed: true,
    decision: "allow",
    payment: {
      walletAddress: intent.agentWallet ?? "",
      chain: intent.normalized.chain,
      amountUsdc: intent.normalized.amountUsdc,
      requestHash: intent.requestHash,
      service
    },
    policy: {
      allowed: intent.policy.allowed,
      reason: intent.policy.reason ?? null,
      remediation: intent.policy.remediation ?? null,
      dailySpentUsdc: intent.policy.dailySpentUsdc,
      weeklySpentUsdc: intent.policy.weeklySpentUsdc,
      monthlySpentUsdc: intent.policy.monthlySpentUsdc
    },
    checks: intent.policy.checks
  };
}

function externalReceiptError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/Circle payment response|paymentResponse|successful Circle/i.test(message)) return message;
  return "The external Circle payment receipt could not be validated.";
}

function marketplaceSettings(options: CircleMarketplaceOptions) {
  const supportedChains = supportedCirclePaymentChains();
  const requestedDefaultChain = normalizeChain(options.defaultChain ?? config.circle.agentMarketplace.defaultChain);
  return {
    enabled: options.enabled ?? config.circle.agentMarketplace.enabled,
    runner: options.runner ?? defaultCircleCliRunner,
    discoveryFetch: options.discoveryFetch ?? defaultCircleDiscoveryFetcher,
    defaultChain: supportedChains.includes(requestedDefaultChain)
      ? requestedDefaultChain
      : supportedChains.find((chain) => chain === "BASE_SEPOLIA") ?? supportedChains[0] ?? "ARC",
    supportedChains,
    requireConfirmation: options.requireConfirmation ?? config.circle.agentMarketplace.requireConfirmation,
    maxPaymentUsdc: positiveUsdc(options.maxPaymentUsdc ?? config.circle.agentMarketplace.maxPaymentUsdc, 5),
    cliPath: config.circle.agentMarketplace.cliPath
  };
}

function readiness(input: {
  settings: ReturnType<typeof marketplaceSettings>;
  configured: boolean;
  status: CircleAgentMarketplaceReadiness["status"];
  cliVersion: string | null;
  message: string;
}): CircleAgentMarketplaceReadiness {
  return {
    enabled: input.settings.enabled,
    configured: input.configured,
    status: input.status,
    cliPath: input.settings.cliPath,
    cliVersion: input.cliVersion,
    defaultChain: input.settings.defaultChain,
    supportedChains: input.settings.supportedChains,
    requireConfirmation: input.settings.requireConfirmation,
    maxPaymentUsdc: input.settings.maxPaymentUsdc,
    requiredEnv,
    message: input.message
  };
}

function assertMarketplaceEnabled(settings: ReturnType<typeof marketplaceSettings>) {
  if (!settings.enabled) throw httpError("Circle service payments are not enabled for this workspace.", 503);
}

async function runCircleCli(settings: ReturnType<typeof marketplaceSettings>, args: string[], options?: {timeoutMs?: number}) {
  try {
    return await settings.runner(args, options);
  } catch (error) {
    throw httpError(circleCliFailureMessage(args), 502);
  }
}

async function discoveryPayload(settings: ReturnType<typeof marketplaceSettings>, input: {query: string; label: "search" | "inspect"}) {
  const url = new URL("https://api.circle.com/v2/x402/discovery/resources");
  url.searchParams.set("query", input.query);
  url.searchParams.set("siwx", "false");
  url.searchParams.set("limit", input.label === "inspect" ? "50" : "25");
  try {
    return await settings.discoveryFetch(url.toString());
  } catch {
    throw httpError(publicCircleUnavailableMessage(input.label), 502);
  }
}

function serviceArrayFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = objectValue(payload);
  // `resources` is the x402 discovery convention (what Circle's discovery API and
  // Nexora's own /api/discovery/resources both emit); the others cover assorted
  // provider shapes we normalize from.
  const candidates = [record.resources, record.services, record.results, record.items, record.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const nested = objectValue(candidate);
    if (Array.isArray(nested.resources)) return nested.resources;
    if (Array.isArray(nested.services)) return nested.services;
    if (Array.isArray(nested.results)) return nested.results;
  }
  return [];
}

function normalizeCircleService(value: unknown, fallbackUrl: string | null): CircleAgentService {
  const record = objectValue(value);
  const nested = objectValue(record.service);
  const source = Object.keys(nested).length > 0 ? {...record, ...nested} : record;
  const metadata = objectValue(source.metadata);
  const provider = objectValue(metadata.provider);
  const accepts = acceptsArray(source);
  const acceptedChains = [...new Set(accepts.map(chainFromAccept).filter(Boolean) as string[])];
  const priceUsdc = priceFromSource(source, accepts);
  const publisherAddress = publisherFromSource(source, accepts);
  const url = stringValue(source.url ?? source.endpoint ?? source.resource ?? source.href) ?? fallbackUrl ?? "";
  return {
    name: stringValue(source.name ?? source.title ?? source.serviceName ?? provider.name) ?? "Circle marketplace service",
    description: stringValue(source.description ?? source.summary ?? metadata.description ?? provider.description) ?? "Circle x402 paid service",
    url,
    priceUsdc,
    publisherAddress,
    assetAddress: assetFromSource(source, accepts),
    acceptedChains,
    paymentScheme: stringValue(source.scheme ?? source.paymentScheme ?? accepts[0]?.scheme ?? accepts[0]?.paymentScheme ?? objectValue(accepts[0]?.extra).name),
    method: normalizeHttpMethod(source.method ?? source.httpMethod ?? objectValue(source.request).method ?? metadata.method),
    inputSchema: source.inputSchema ?? source.schema ?? source.requestSchema ?? metadata.input ?? null
  };
}

function normalizeHttpMethod(value: unknown) {
  const method = String(value ?? "POST").trim().toUpperCase();
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method) ? method : "POST";
}

function hasPayableServiceDetails(service: CircleAgentService) {
  return Boolean(service.url && service.priceUsdc > 0 && service.publisherAddress && service.acceptedChains.length > 0);
}

function acceptsArray(source: Record<string, unknown>) {
  const candidates = [
    source.accepts,
    source.accept,
    objectValue(source.paymentRequirements).accepts,
    objectValue(source.payment).accepts,
    objectValue(source.x402).accepts
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(objectValue);
  }
  return [];
}

function chainFromAccept(accept: Record<string, unknown>) {
  return normalizeChain(stringValue(accept.chain ?? accept.network ?? accept.networkId ?? accept.blockchain));
}

function priceFromSource(source: Record<string, unknown>, accepts: Array<Record<string, unknown>>) {
  const direct = usdcAmount(source.priceUsdc ?? source.amountUsdc ?? source.usdc ?? source.price ?? source.amount);
  if (direct > 0) return direct;
  for (const accept of accepts) {
    const standard = usdcAmount(accept.priceUsdc ?? accept.amountUsdc ?? accept.price);
    if (standard > 0) return standard;
    const baseUnits = usdcBaseUnitsAmount(accept.maxAmountRequired ?? accept.maxAmount ?? accept.amountRequired ?? accept.amount);
    if (baseUnits > 0) return baseUnits;
  }
  return 0;
}

function publisherFromSource(source: Record<string, unknown>, accepts: Array<Record<string, unknown>>) {
  const direct = stringValue(source.payTo ?? source.pay_to ?? source.publisherAddress ?? source.sellerAddress ?? source.seller ?? source.recipient);
  if (direct && isAddress(direct)) return direct;
  for (const accept of accepts) {
    const value = stringValue(accept.payTo ?? accept.pay_to ?? accept.recipient ?? accept.seller ?? accept.sellerAddress);
    if (value && isAddress(value)) return value;
  }
  return null;
}

function assetFromSource(source: Record<string, unknown>, accepts: Array<Record<string, unknown>>) {
  const direct = stringValue(source.asset ?? source.assetAddress ?? source.token ?? source.tokenAddress);
  if (direct && isAddress(direct)) return direct;
  for (const accept of accepts) {
    const value = stringValue(accept.asset ?? accept.assetAddress ?? accept.token ?? accept.tokenAddress);
    if (value && isAddress(value)) return value;
  }
  return null;
}

function circleServiceRecord(service: CircleAgentService, chain?: string | null): ServiceRecord {
  const id = circleServiceId(service.url);
  return {
    id,
    chainServiceId: null,
    settlementChainId: chain ? chainIdForCircleChain(chain) : null,
    publisherAddress: service.publisherAddress ?? zeroAddress,
    name: `Circle: ${service.name}`,
    endpointHash: `circle-agent-marketplace:${stableHash(service.url)}`,
    pricePerUnitUsdc: service.priceUsdc,
    manifest: {
      kind: "generic",
      version: "1.0.0",
      description: service.description,
      inputSchema: [],
      outputSchema: ["status", "result", "receipt"],
      revenueMode: "per_execution",
      platformFeeBps: 0,
      webhookUrl: null
    },
    active: true,
    featured: false,
    txHash: null,
    createdAt: new Date().toISOString(),
    archivedAt: null,
    archiveReason: null,
    trust: null
  };
}

function findOperatorAgent(agents: AgentWalletRecord[], input: {operatorAddress: string; agentId?: string | null; walletAddress: string}) {
  return agents.find((item) => (
    isVisibleAgent(item)
    && item.operatorAddress.toLowerCase() === input.operatorAddress.toLowerCase()
    && (
      (input.agentId ? item.id === input.agentId : false)
      || item.address?.toLowerCase() === input.walletAddress.toLowerCase()
      || item.chainWallets?.some((wallet) => wallet.address?.toLowerCase() === input.walletAddress.toLowerCase())
    )
  ));
}

async function recordCirclePayment(input: {
  input: CirclePaymentInput;
  guard: CirclePaymentGuard;
  status: PaymentRecord["status"];
  txHash?: string | null;
  resultSummary?: string | null;
  paymentScheme?: string | null;
  policyReason?: string | null;
  requestHash?: string;
}) {
  const service = circleServiceRecord(input.guard.payment.service, input.guard.payment.chain);
  const now = new Date().toISOString();
  const agentId = input.input.agentId ?? null;
  const payment: PaymentRecord = {
    id: crypto.randomUUID(),
    authorizationId: `circle:${crypto.randomUUID()}`,
    serviceId: service.id,
    serviceName: service.name,
    payer: input.input.operatorAddress,
    agentId,
    agentWallet: input.guard.payment.walletAddress,
    publisherAddress: service.publisherAddress,
    amountUsdc: input.guard.payment.amountUsdc,
    grossAmountUsdc: input.guard.payment.amountUsdc,
    platformFeeUsdc: 0,
    publisherNetUsdc: input.status === "settled" ? input.guard.payment.amountUsdc : 0,
    facilitatorFeeBps: 0,
    units: 1,
    requestHash: input.requestHash ?? input.guard.payment.requestHash,
    status: input.status,
    policyReason: input.policyReason ?? null,
    memo: null,
    txHash: input.txHash ?? null,
    external: {
      provider: "circle_agent_marketplace",
      serviceUrl: input.guard.payment.service.url,
      chain: input.guard.payment.chain,
      chainId: chainIdForCircleChain(input.guard.payment.chain),
      network: networkNameForCircleChain(input.guard.payment.chain),
      paymentScheme: input.paymentScheme ?? input.guard.payment.service.paymentScheme ?? null,
      resultSummary: input.resultSummary ?? null
    },
    createdAt: now,
    settledAt: input.status === "settled" ? now : null
  };

  const result = await insertPayment(payment, (store) => {
    const notification = pushNotification(store, {
      operatorAddress: payment.payer,
      title: input.status === "settled" ? "Circle payment settled" : input.status === "failed" ? "Circle payment failed" : "Circle payment blocked",
      detail: `${payment.serviceName} · ${payment.amountUsdc} USDC`,
      kind: input.status === "settled" ? "payment" : "policy",
      txHash: payment.txHash,
      receiptId: payment.id,
      actionHref: `/receipts/${encodeURIComponent(payment.id)}`
    });
    return {notification};
  });
  if (result?.notification) {
    await dispatchNotification({
      notification: result.notification,
      event: input.status === "settled" ? "paymentReceipts" : "policyAlerts",
      receiptId: payment.id
    }).catch(() => undefined);
  }
  return payment;
}

function paymentResultPayload(payload: unknown) {
  const record = objectValue(payload);
  return record.response ?? record.result ?? record.data ?? payload;
}

function assertCirclePaymentSucceeded(payload: unknown) {
  const record = objectValue(payload);
  const status = stringValue(record.status ?? record.state);
  if (record.error || (status && /fail|error|reject/i.test(status))) {
    throw new Error(stringValue(record.error ?? record.message) ?? "Circle service payment failed");
  }
}

function txHashFromPayload(payload: unknown): string | null {
  const record = objectValue(payload);
  const candidates = [
    record.txHash,
    record.transactionHash,
    record.transaction,
    record.hash,
    objectValue(record.payment).txHash,
    objectValue(record.payment).transactionHash,
    objectValue(record.receipt).txHash,
    objectValue(record.receipt).transactionHash,
    objectValue(record.settlement).txHash,
    objectValue(record.settlement).transactionHash,
    objectValue(record.settlement).transaction
  ];
  for (const candidate of candidates) {
    const value = stringValue(candidate);
    if (value && /^0x[a-fA-F0-9]{64}$/.test(value)) return value;
  }
  return null;
}

function paymentRequestHash(input: {operatorAddress: string; walletAddress: string; serviceUrl: string; chain: string; data: Record<string, unknown>}) {
  return `0x${stableHash(JSON.stringify({...input, nonce: crypto.randomUUID(), timestamp: Date.now()}))}`;
}

function circleServiceId(url: string) {
  return `circle-agent-marketplace-${stableHash(url).slice(0, 24)}`;
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCliJson(stdout: string, label: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw httpError(publicCircleUnavailableMessage(label), 502);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const starts = [...trimmed].map((char, index) => (char === "{" || char === "[" ? index : -1)).filter((index) => index >= 0);
    for (const start of starts) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        // Try the next JSON-looking boundary.
      }
    }
  }
  throw httpError(publicCircleUnavailableMessage(label), 502);
}

export function buildCircleCliEnv(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nodeOptions = sanitizeNodeOptions(sourceEnv.NODE_OPTIONS ?? "");
  const headerOption = "--max-http-header-size=262144";
  const warningOption = "--no-deprecation";
  return {
    ...sourceEnv,
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: [
      nodeOptions,
      nodeOptions.includes("--max-http-header-size") ? "" : headerOption,
      nodeOptions.includes("--no-deprecation") ? "" : warningOption
    ].filter(Boolean).join(" ")
  };
}

function sanitizeNodeOptions(value: string) {
  return value
    .split(/\s+/)
    .filter((option) => option && option !== "--throw-deprecation" && option !== "--trace-deprecation" && option !== "--trace-warnings")
    .join(" ");
}

function normalizeChain(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "BASE";
  const upper = text.toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (upper === `EIP155:${config.arc.chainId}`) return "ARC";
  if (upper === `EIP155:${config.base.sepoliaChainId}`) return "BASE_SEPOLIA";
  if (upper === `EIP155:${config.arbitrum.sepoliaChainId}`) return "ARB_SEPOLIA";
  if (upper === "EIP155:1") return "ETH";
  if (upper === "EIP155:10") return "OP";
  if (upper === "EIP155:130") return "UNI";
  if (upper === "EIP155:137") return "MATIC";
  if (upper === "EIP155:8453") return "BASE";
  if (upper === "EIP155:42161") return "ARB";
  if (upper === "EIP155:43114") return "AVAX";
  if (upper === "POLYGON" || upper === "MATIC") return "MATIC";
  if (upper === "ARBITRUM" || upper === "ARBITRUM_ONE" || upper === "ARB_ONE") return "ARB";
  if (upper === "BASE_MAINNET") return "BASE";
  if (upper === "BASE_SEPOLIA") return "BASE_SEPOLIA";
  if (upper === "ARBITRUM_SEPOLIA" || upper === "ARB_SEPOLIA") return "ARB_SEPOLIA";
  if (upper === "ARC_TESTNET") return "ARC";
  return upper;
}

function supportedCirclePaymentChains() {
  return [...new Set(agentChainContexts().map((context) => normalizeChain(context.circleBlockchain)))];
}

function agentWalletForChain(agent: AgentWalletRecord, chainId: number) {
  return agentChainWalletForChain(agent, chainId)?.address ?? null;
}

function agentChainWalletForChain(agent: AgentWalletRecord, chainId: number) {
  const chainWallet = agent.chainWallets?.find((wallet) => wallet.chainId === chainId);
  if (chainWallet) return chainWallet;
  if (chainId !== config.arc.chainId) return null;
  return {
    chainId,
    chain: "Arc Testnet",
    circleBlockchain: "ARC-TESTNET",
    address: agent.address,
    circleWalletId: agent.circleWalletId ?? null,
    status: agent.circleWalletStatus,
    updatedAt: agent.createdAt
  };
}

function chainIdForCircleChain(chain: string) {
  const normalized = normalizeChain(chain);
  if (normalized === "ARC") return config.arc.chainId;
  if (normalized === "BASE") return config.base.mainnetChainId;
  if (normalized === "BASE_SEPOLIA") return config.base.sepoliaChainId;
  if (normalized === "ARB") return config.arbitrum.oneChainId;
  if (normalized === "ARB_SEPOLIA") return config.arbitrum.sepoliaChainId;
  if (normalized === "MATIC") return 137;
  if (normalized === "ETH") return 1;
  if (normalized === "AVAX") return 43114;
  if (normalized === "OP") return 10;
  return null;
}

function networkNameForCircleChain(chain: string) {
  const normalized = normalizeChain(chain);
  if (normalized === "ARC") return "Arc";
  if (normalized === "BASE") return "Base";
  if (normalized === "BASE_SEPOLIA") return "Base Sepolia";
  if (normalized === "ARB") return "Arbitrum One";
  if (normalized === "ARB_SEPOLIA") return "Arbitrum Sepolia";
  if (normalized === "MATIC") return "Polygon";
  if (normalized === "ETH") return "Ethereum";
  if (normalized === "AVAX") return "Avalanche";
  if (normalized === "OP") return "Optimism";
  return normalized;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function usdcAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return roundUsdc(value);
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/,/g, "");
  const match = cleaned.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? roundUsdc(parsed) : 0;
}

function usdcBaseUnitsAmount(value: unknown) {
  const parsed = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? roundUsdc(parsed / 1_000_000) : 0;
}

function positiveUsdc(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundUsdc(parsed) : fallback;
}

function formatUsdc(value: number) {
  return String(roundUsdc(value));
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function check(pass: boolean, label: string, detail: string): CirclePaymentGuard["checks"][number] {
  return {status: pass ? "pass" : "fail", label, detail};
}

function resultSummary(value: unknown) {
  if (typeof value === "string") return compactText(value).slice(0, 240);
  const record = objectValue(value);
  const summary = stringValue(record.summary ?? record.message ?? record.title);
  if (summary) return compactText(summary).slice(0, 240);
  const keys = Object.keys(record);
  return keys.length > 0 ? `Returned fields: ${keys.slice(0, 8).join(", ")}` : null;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function assertAddress(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) throw httpError(`${label} must be a valid EVM address`, 400);
  return value;
}

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), {status});
}

function isHttpError(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error;
}

function httpStatus(error: unknown) {
  if (typeof error !== "object" || !error || !("status" in error)) return 0;
  const status = Number((error as {status?: unknown}).status);
  return Number.isInteger(status) ? status : 0;
}

function errorMessage(error: unknown) {
  const stream = cliOutputText(error);
  const streamMessage = messageFromCliOutput(stream);
  if (streamMessage) return streamMessage;
  if (error instanceof Error) {
    if (/^Command failed: circle\b/i.test(error.message) && !stream) return "Circle CLI command failed without output.";
    return error.message;
  }
  return String(error);
}

function circleCliFailureMessage(args: string[]) {
  return publicCircleUnavailableMessage(args.slice(0, 2).join(" "));
}

function versionFailureMessage(error: unknown) {
  const detail = errorMessage(error);
  if (/without output/i.test(detail) || /^Command failed: circle --version/i.test(detail)) {
    return publicCircleUnavailableMessage();
  }
  return publicCircleUnavailableMessage();
}

function publicCircleUnavailableMessage(context = "") {
  const normalized = context.toLowerCase();
  if (normalized.includes("search")) return "Circle service search is temporarily unavailable. Please try again shortly.";
  if (normalized.includes("inspect")) return "Circle service details are temporarily unavailable. Please try again shortly.";
  if (normalized.includes("pay")) return "Circle payment execution is temporarily unavailable. Please try again shortly.";
  return "Circle payments are temporarily unavailable. Please try again shortly.";
}

function cliOutputText(error: unknown) {
  if (typeof error !== "object" || !error) return "";
  const stderr = "stderr" in error ? String((error as {stderr?: unknown}).stderr ?? "") : "";
  const stdout = "stdout" in error ? String((error as {stdout?: unknown}).stdout ?? "") : "";
  return compactText([stderr, stdout].filter(Boolean).join(" "));
}

function messageFromCliOutput(output: string) {
  if (!output) return "";
  const starts = [...output].map((char, index) => (char === "{" ? index : -1)).filter((index) => index >= 0);
  for (const start of starts) {
    try {
      const record = objectValue(JSON.parse(output.slice(start)));
      const error = objectValue(record.error);
      const message = stringValue(error.message ?? record.message);
      const hint = stringValue(error.hint ?? record.hint);
      if (message && hint) return `${message} Hint: ${hint}`;
      if (message) return message;
    } catch {
      // Try the next JSON-looking boundary.
    }
  }
  return output;
}

function isMissingCliError(error: unknown) {
  if (typeof error !== "object" || !error) return false;
  const code = "code" in error ? String((error as {code?: unknown}).code) : "";
  return code === "ENOENT" || /ENOENT|not found/i.test(errorMessage(error));
}

function isEmptyWalletStatusFailure(error: unknown) {
  if (typeof error !== "object" || !error) return false;
  const message = "message" in error && typeof (error as {message?: unknown}).message === "string" ? (error as {message: string}).message : "";
  const stdout = "stdout" in error ? String((error as {stdout?: unknown}).stdout ?? "") : "";
  const stderr = "stderr" in error ? String((error as {stderr?: unknown}).stderr ?? "") : "";
  return /circle wallet status/i.test(message) && stdout.trim() === "" && stderr.trim() === "";
}
