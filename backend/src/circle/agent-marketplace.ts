import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {promisify} from "node:util";
import {isAddress} from "viem";
import {config} from "../config.js";
import {dispatchNotification} from "../notifications.js";
import {evaluateAutomationRecipesForOperator} from "../automation/recipes.js";
import {evaluateAgentPolicy} from "../policies/engine.js";
import {safeHttpUrl} from "../security.js";
import {isVisibleAgent, pushNotification, readStore, updateStore} from "../store.js";
import type {AgentWalletRecord, PaymentIntentRecord, PaymentRecord, ServiceRecord} from "../store.js";

export type CircleCliRunner = (args: string[], options?: {timeoutMs?: number}) => Promise<{stdout: string; stderr: string}>;
export type CircleDiscoveryFetcher = (url: string) => Promise<unknown>;

export type CircleAgentService = {
  name: string;
  description: string;
  url: string;
  priceUsdc: number;
  publisherAddress: string | null;
  acceptedChains: string[];
  paymentScheme: string | null;
  inputSchema: unknown;
};

export type CircleAgentMarketplaceReadiness = {
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "ready" | "cli_missing" | "terms_required" | "not_logged_in" | "wallet_status_error";
  cliPath: string;
  cliVersion: string | null;
  defaultChain: string;
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
}>;

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
  "NEXORA_CIRCLE_CLI_PATH",
  "NEXORA_CIRCLE_DEFAULT_CHAIN",
  "NEXORA_CIRCLE_PAYMENT_REQUIRE_CONFIRMATION",
  "NEXORA_CIRCLE_PAYMENT_MAX_USDC"
];
const zeroAddress = "0x0000000000000000000000000000000000000000";

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
  try {
    const output = await runCircleCli(settings, ["services", "search", keyword, "--output", "json"], {timeoutMs: 30_000});
    services = serviceArrayFromPayload(parseCliJson(output.stdout, "Circle services search")).map((item) => normalizeCircleService(item, null));
  } catch {
    services = serviceArrayFromPayload(await discoveryPayload(settings, {query: keyword, label: "search"})).map((item) => normalizeCircleService(item, null));
  }
  if (services.length === 0) {
    const discoveryServices = serviceArrayFromPayload(await discoveryPayload(settings, {query: keyword, label: "search"})).map((item) => normalizeCircleService(item, null));
    if (discoveryServices.length > 0) services = discoveryServices;
  }
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
  try {
    const output = await runCircleCli(settings, ["services", "inspect", url, "--output", "json"], {timeoutMs: 30_000});
    service = normalizeCircleService(parseCliJson(output.stdout, "Circle services inspect"), url);
  } catch {
    service = null;
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

  const requestHash = paymentRequestHash({
    operatorAddress,
    walletAddress,
    serviceUrl,
    chain,
    data: input.data ?? {}
  });

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
  const syntheticService = circleServiceRecord(service);
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
    const result = paymentResultPayload(payload);
    const receipt = await recordCirclePayment({
      input,
      guard,
      status: "settled",
      txHash: txHashFromPayload(payload),
      resultSummary: resultSummary(result),
      paymentScheme: guard.payment.service.paymentScheme
    });
    await evaluateAutomationRecipesForOperator(input.operatorAddress).catch(() => undefined);
    return {
      status: "settled",
      guard,
      receipt,
      result
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
}

export async function createCircleAgentPaymentIntent(input: CirclePaymentInput, options: CircleMarketplaceOptions = {}) {
  const settings = marketplaceSettings(options);
  assertMarketplaceEnabled(settings);
  const guard = await preflightCircleAgentPayment(input, {...options, ...settings});
  const service = circleServiceRecord(guard.payment.service);
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
      inputSchema: guard.payment.service.inputSchema ?? null
    },
    data: input.data ?? {},
    policy: {
      allowed: guard.policy.allowed,
      reason: guard.policy.reason ?? failedCheckDetail(guard) ?? null,
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

  const result = await updateStore((store) => {
    store.paymentIntents.unshift(intent);
    store.paymentIntents = store.paymentIntents.slice(0, 500);
    const notification = pushNotification(store, {
      operatorAddress: intent.operatorAddress,
      title: status === "pending_approval" ? "Circle payment approval requested" : "Circle payment blocked",
      detail: `${intent.normalized.serviceName} · ${intent.normalized.amountUsdc} USDC`,
      kind: status === "pending_approval" ? "payment" : "policy",
      actionHref: "/payments"
    });
    return {intent, notification};
  });
  await dispatchNotification({
    notification: result.notification,
    event: status === "pending_approval" ? "paymentReceipts" : "policyAlerts"
  }).catch(() => undefined);
  return result.intent;
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
    const updated = await updateStore((store) => {
      const current = paymentIntentForUpdate(store.paymentIntents, id, input.operatorAddress);
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
    await updateStore((store) => {
      const current = paymentIntentForUpdate(store.paymentIntents, id, input.operatorAddress);
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

async function decideCircleAgentPaymentIntent(id: string, input: CirclePaymentIntentDecisionInput, status: "approved" | "rejected") {
  const result = await updateStore((store) => {
    const intent = paymentIntentForUpdate(store.paymentIntents, id, input.operatorAddress);
    if (intent.status !== "pending_approval") {
      throw httpError(intent.status === "settled" ? "payment intent already executed" : "payment intent is not pending approval", 409);
    }
    if (isExpired(intent)) {
      intent.status = "expired";
      intent.updatedAt = new Date().toISOString();
      throw httpError("payment intent approval window has expired", 410);
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
    return {intent, notification};
  });
  await dispatchNotification({
    notification: result.notification,
    event: status === "approved" ? "paymentReceipts" : "policyAlerts"
  }).catch(() => undefined);
  return result.intent;
}

async function markPaymentIntentExecuting(id: string, operatorAddress: string) {
  return updateStore((store) => {
    const intent = paymentIntentForUpdate(store.paymentIntents, id, operatorAddress);
    if (intent.status === "settled") throw httpError("payment intent already executed", 409);
    if (intent.status === "executing") throw httpError("payment intent is already executing", 409);
    if (intent.status !== "approved") throw httpError("payment intent must be approved before execution", 428);
    if (isExpired(intent)) {
      intent.status = "expired";
      intent.updatedAt = new Date().toISOString();
      throw httpError("payment intent approval window has expired", 410);
    }
    if (!intent.agentWallet) throw httpError("payment intent is missing an agent wallet", 400);
    intent.status = "executing";
    intent.updatedAt = new Date().toISOString();
    return intent;
  });
}

function paymentIntentForUpdate(paymentIntents: PaymentIntentRecord[], id: string, operatorAddress: string) {
  const intent = paymentIntents.find((item) => item.id === id);
  if (!intent) throw httpError("payment intent not found", 404);
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

function marketplaceSettings(options: CircleMarketplaceOptions) {
  return {
    enabled: options.enabled ?? config.circle.agentMarketplace.enabled,
    runner: options.runner ?? defaultCircleCliRunner,
    discoveryFetch: options.discoveryFetch ?? defaultCircleDiscoveryFetcher,
    defaultChain: normalizeChain(options.defaultChain ?? config.circle.agentMarketplace.defaultChain),
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
  const candidates = [record.services, record.results, record.items, record.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    const nested = objectValue(candidate);
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
    acceptedChains,
    paymentScheme: stringValue(source.scheme ?? source.paymentScheme ?? accepts[0]?.scheme ?? accepts[0]?.paymentScheme ?? objectValue(accepts[0]?.extra).name),
    inputSchema: source.inputSchema ?? source.schema ?? source.requestSchema ?? metadata.input ?? null
  };
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

function circleServiceRecord(service: CircleAgentService): ServiceRecord {
  const id = circleServiceId(service.url);
  return {
    id,
    chainServiceId: null,
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
}) {
  const service = circleServiceRecord(input.guard.payment.service);
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
    requestHash: input.guard.payment.requestHash,
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

  const result = await updateStore((store) => {
    store.payments.push(payment);
    const notification = pushNotification(store, {
      operatorAddress: payment.payer,
      title: input.status === "settled" ? "Circle payment settled" : input.status === "failed" ? "Circle payment failed" : "Circle payment blocked",
      detail: `${payment.serviceName} · ${payment.amountUsdc} USDC`,
      kind: input.status === "settled" ? "payment" : "policy",
      txHash: payment.txHash,
      receiptId: payment.id,
      actionHref: `/receipts/${encodeURIComponent(payment.id)}`
    });
    return {payment, notification};
  });
  await dispatchNotification({
    notification: result.notification,
    event: input.status === "settled" ? "paymentReceipts" : "policyAlerts",
    receiptId: payment.id
  }).catch(() => undefined);
  return result.payment;
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
    record.hash,
    objectValue(record.payment).txHash,
    objectValue(record.payment).transactionHash,
    objectValue(record.receipt).txHash,
    objectValue(record.receipt).transactionHash,
    objectValue(record.settlement).txHash,
    objectValue(record.settlement).transactionHash
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
