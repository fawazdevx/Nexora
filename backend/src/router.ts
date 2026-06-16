import {config} from "./config.js";
import {createPublicClient, formatUnits, http, isAddress, parseAbi} from "viem";
import {authorizeX402, paymentRequired, settleX402} from "./x402/facilitator.js";
import {createAgentWallet, refreshPendingCircleWallets, submitAgentX402Settlement, updateAgentPolicy} from "./circle/agent-wallets.js";
import {listEarnOpportunities} from "./earn/opportunities.js";
import {activatePlan, executeBuiltInService, executeMarketplaceService, featureService, listServices, platformPlans, publishService, requirePlatformPlan, subscribePlan} from "./marketplace/services.js";
import {operatorProfile} from "./identity/operators.js";
import {integrationReadiness} from "./readiness.js";
import {synthraApproval, synthraQuote, synthraReadiness, synthraSwap} from "./swap/synthra.js";
import {indexedAnalytics, syncArcIndexer} from "./indexer/arc.js";
import {
  addressArray,
  assertJsonObject,
  assertSharedSecret,
  assertTokenAddress,
  authContext,
  corsOrigin,
  issueAuthNonce,
  nonNegativeUsdcAmount,
  optionalBps,
  optionalLimitedString,
  optionalTxHash,
  requiredAddress,
  requiredBytes32,
  requiredLimitedString,
  requiredPositiveInteger,
  requiredTxHash,
  requiredUsdcAmount,
  securityHeaders,
  verifyAuthSignature,
  type AuthContext
} from "./security.js";
import {appSnapshot, pushNotification, readStore, storageFriendlyError, updateStore} from "./store.js";
import {settleFacilitatorPayment, supportedX402, verifyFacilitatorPayment} from "./x402/protocol-facilitator.js";

const erc20BalanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export type AppRequest = {
  method: string;
  url: string;
  host?: string;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

export type AppResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function handleAppRequest(req: AppRequest): Promise<AppResponse> {
  if (req.method === "OPTIONS") return {status: 204};

  try {
    const url = new URL(req.url, `http://${req.host ?? "localhost"}`);
    assertAllowedRequestOrigin(req);
    const body = req.body ?? {};
    const rawPath = url.pathname;
    const path = normalizePath(rawPath);
    const auth = authContext(header(req, "authorization"));

    if (req.method === "GET" && path === "/api/health") {
      return ok({ok: true, network: "Arc Testnet", chainId: config.arc.chainId});
    }

    if (req.method === "GET" && (path === "/x402/supported" || path === "/api/x402/supported")) {
      return ok(supportedX402());
    }

    if (req.method === "POST" && (path === "/x402/verify" || path === "/api/x402/verify")) {
      return ok(await verifyFacilitatorPayment({
        paymentPayload: body.paymentPayload ?? body.payment,
        paymentRequirements: body.paymentRequirements
      }));
    }

    if (req.method === "POST" && (path === "/x402/settle" || path === "/api/x402/facilitator-settle")) {
      return ok(await settleFacilitatorPayment({
        paymentPayload: body.paymentPayload ?? body.payment,
        paymentRequirements: body.paymentRequirements
      }));
    }

    if (req.method === "GET" && path === "/api/readiness") {
      return ok(integrationReadiness());
    }

    if (req.method === "GET" && path === "/api/admin/deployments") {
      assertSharedSecret(header(req, "x-admin-secret"), config.security.adminSecret, "admin");
      return ok(await deploymentDashboard());
    }

    if (req.method === "GET" && path === "/api/app") {
      const operator = optionalLimitedString(url.searchParams.get("operator"), "operator", 80);
      await refreshPendingCircleWallets(operator);
      return ok(await appSnapshot(operator));
    }

    if (req.method === "POST" && path === "/api/auth/nonce") {
      return ok({nonce: issueAuthNonce(requiredAddress(body.address, "address"))});
    }

    if (req.method === "POST" && path === "/api/auth/verify") {
      return ok({
        token: await verifyAuthSignature({
          address: requiredAddress(body.address, "address"),
          nonce: requiredLimitedString(body.nonce, "nonce", 240),
          signature: optionalLimitedString(body.signature, "signature", 200)
        })
      });
    }

    if (req.method === "GET" && path.startsWith("/api/operators/")) {
      return ok(await operatorProfile(decodeURIComponent(path.replace("/api/operators/", ""))));
    }

    if (req.method === "POST" && path === "/api/agents") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await createAgentWallet({
        operatorAddress,
        arcName: optionalLimitedString(body.arcName, "arcName", 120),
        dailyLimitUsdc: requiredUsdcAmount(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredUsdcAmount(body.transactionCapUsdc, "transactionCapUsdc"),
        policyV2: optionalPolicyV2(body.policyV2)
      }));
    }

    if ((req.method === "PATCH" || req.method === "POST") && path.startsWith("/api/agents/") && path.endsWith("/policies")) {
      const agentId = path.split("/")[3] ?? "local";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await updateAgentPolicy(agentId, {
        operatorAddress,
        dailyLimitUsdc: requiredUsdcAmount(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredUsdcAmount(body.transactionCapUsdc, "transactionCapUsdc"),
        contractAllowlist: addressArray(body.contractAllowlist, "contractAllowlist"),
        recipientAllowlist: addressArray(body.recipientAllowlist, "recipientAllowlist"),
        policyV2: optionalPolicyV2(body.policyV2),
        txHash: optionalTxHash(body.txHash)
      }));
    }

    if (req.method === "GET" && path === "/api/marketplace/services") {
      return ok({services: await listServices()});
    }

    if (req.method === "GET" && path === "/api/public/builders") {
      return ok(await publicBuilderDirectory());
    }

    if (req.method === "GET" && path === "/api/x402/analytics") {
      return ok(await facilitatorAnalytics());
    }

    if (req.method === "GET" && path.startsWith("/api/marketplace/services/")) {
      const serviceId = path.split("/")[4] ?? "";
      const service = (await readStore()).services.find((item) => item.id === serviceId || String(item.chainServiceId) === serviceId);
      if (!service) return response(404, {error: "service_not_found"});
      return ok({service});
    }

    if (req.method === "GET" && path === "/api/synthra/readiness") {
      return ok(synthraReadiness());
    }

    if (req.method === "POST" && path === "/api/synthra/quote") {
      return ok(await synthraQuote({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredAddress(body.tokenIn, "tokenIn"),
        tokenOut: requiredAddress(body.tokenOut, "tokenOut"),
        amount: String(requiredUsdcAmount(body.amount, "amount", 100_000))
      }));
    }

    if (req.method === "POST" && path === "/api/synthra/approval") {
      const owner = requiredAddress(body.owner, "owner");
      assertTokenAddress(auth, owner, "owner");
      return ok(await synthraApproval({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredAddress(body.tokenIn, "tokenIn"),
        tokenOut: requiredAddress(body.tokenOut, "tokenOut"),
        amount: String(requiredUsdcAmount(body.amount, "amount", 100_000)),
        owner
      }));
    }

    if (req.method === "POST" && path === "/api/synthra/swap") {
      const sender = requiredAddress(body.sender, "sender");
      assertTokenAddress(auth, sender, "sender");
      return ok(await synthraSwap({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredAddress(body.tokenIn, "tokenIn"),
        tokenOut: requiredAddress(body.tokenOut, "tokenOut"),
        amount: String(requiredUsdcAmount(body.amount, "amount", 100_000)),
        recipient: requiredAddress(body.recipient, "recipient"),
        sender,
        slippageBps: optionalBps(body.slippageBps, 100, 1000)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/services") {
      const publisherAddress = requiredAddress(body.publisherAddress, "publisherAddress");
      assertTokenAddress(auth, publisherAddress, "publisherAddress");
      return response(201, await publishService({
        publisherAddress,
        name: requiredLimitedString(body.name, "name", 120),
        endpointHash: requiredLimitedString(body.endpointHash, "endpointHash", 120),
        pricePerUnitUsdc: requiredUsdcAmount(body.pricePerUnitUsdc, "pricePerUnitUsdc", 10_000),
        chainServiceId: optionalNumber(body.chainServiceId),
        txHash: optionalTxHash(body.txHash),
        manifestKind: optionalLimitedString(body.manifestKind, "manifestKind", 80) as Parameters<typeof publishService>[0]["manifestKind"],
        description: optionalLimitedString(body.description, "description", 1_000),
        webhookUrl: optionalLimitedString(body.webhookUrl, "webhookUrl", 2_048),
        platformFeeBps: optionalBps(body.platformFeeBps, 200, 1000)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/feature") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await featureService({
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        operatorAddress
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/marketplace/services/") && path.endsWith("/execute")) {
      const serviceId = path.split("/")[4] ?? "";
      return ok(await executeMarketplaceService({
        serviceId,
        payer: requiredAddress(body.payer, "payer"),
        authorizationId: optionalLimitedString(body.authorizationId, "authorizationId", 120),
        args: assertJsonObject(body.args)
      }));
    }

    if (req.method === "GET" && path === "/api/monetization/plans") {
      return ok({plans: await platformPlans(), treasury: config.contracts.treasury, usdc: config.contracts.usdc, chainId: config.arc.chainId});
    }

    if (req.method === "POST" && path === "/api/monetization/subscribe") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return response(201, await subscribePlan({
        operatorAddress,
        plan: requiredLimitedString(body.plan, "plan", 80)
      }));
    }

    if (req.method === "POST" && path === "/api/monetization/activate") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      const plan = requiredLimitedString(body.plan, "plan", 80);
      const txHash = requiredTxHash(body.txHash, "txHash");
      const chainId = optionalNumber(body.chainId) ?? config.arc.chainId;
      await verifyPlanPayment({
        operatorAddress,
        plan,
        txHash,
        chainId
      });
      return response(201, await activatePlan({
        operatorAddress,
        plan,
        txHash,
        chainId
      }));
    }

    if (req.method === "POST" && path === "/api/x402/payment-required") {
      return response(402, paymentRequired({
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        amountUsdc: requiredUsdcAmount(body.amountUsdc, "amountUsdc", 10_000),
        resource: requiredLimitedString(body.resource, "resource", 2_048),
        payTo: requiredAddress(body.payTo, "payTo")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/authorize") {
      const payer = requiredAddress(body.payer, "payer");
      return ok(await authorizeX402({
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        payer,
        requestHash: requiredBytes32(body.requestHash, "requestHash"),
        units: requiredPositiveInteger(body.units, "units", 1_000),
        agentId: optionalLimitedString(body.agentId, "agentId", 120)
      }));
    }

    if (req.method === "POST" && path === "/api/x402/settle") {
      const authorizationId = requiredLimitedString(body.authorizationId, "authorizationId", 120);
      const agentId = optionalLimitedString(body.agentId, "agentId", 120);
      if (agentId) {
        const store = await readStore();
        const payment = store.payments.find((item) => item.authorizationId === authorizationId || item.id === authorizationId);
        const service = payment ? store.services.find((item) => item.id === payment.serviceId) : null;
        if (!payment || !service) throw new Error("settlement authorization not found");
        if (!service.chainServiceId) throw new Error("service is not published on-chain");
        const circleSettlement = await submitAgentX402Settlement({
          agentId,
          serviceId: service.chainServiceId,
          requestHash: payment.requestHash,
          amountUsdc: payment.amountUsdc,
          units: payment.units
        });
        if (circleSettlement.state === "PENDING") {
          return ok({
            authorizationId,
            status: "pending_settlement",
            ...circleSettlement
          });
        }
        return ok(await settleX402({authorizationId, txHash: circleSettlement.txHash ?? undefined}));
      }
      return ok(await settleX402({
        authorizationId,
        txHash: optionalTxHash(body.txHash)
      }));
    }

    if (req.method === "GET" && path.startsWith("/api/developers/") && path.endsWith("/dashboard")) {
      return ok(await developerDashboard(decodeURIComponent(path.split("/")[3] ?? "")));
    }

    if (req.method === "GET" && path === "/api/revenue") {
      return ok(await platformRevenueDashboard());
    }

    if (req.method === "GET" && path === "/api/gateway/balances") {
      return ok(await gatewayBalances(requiredAddress(url.searchParams.get("address"), "address")));
    }

    if (req.method === "GET" && path === "/api/indexer/arc/status") {
      return ok(await indexedAnalytics());
    }

    if (req.method === "GET" && path === "/api/escrows") {
      return ok({escrows: (await readStore()).escrows});
    }

    if (req.method === "POST" && path === "/api/escrows") {
      const creatorAddress = requiredAddress(body.creatorAddress, "creatorAddress");
      assertTokenAddress(auth, creatorAddress, "creatorAddress");
      return response(201, await createEscrow({
        creatorAddress,
        counterpartyAddress: requiredAddress(body.counterpartyAddress, "counterpartyAddress"),
        title: requiredLimitedString(body.title, "title", 140),
        description: requiredLimitedString(body.description, "description", 4_000),
        amountUsdc: requiredUsdcAmount(body.amountUsdc, "amountUsdc", 1_000_000),
        performanceBondUsdc: nonNegativeUsdcAmount(body.performanceBondUsdc ?? 0, "performanceBondUsdc", 1_000_000),
        platformFeeBps: optionalBps(body.platformFeeBps, 100, 1000),
        chainEscrowId: optionalNumber(body.chainEscrowId),
        txHash: optionalTxHash(body.txHash)
      }));
    }

    if (req.method === "DELETE" && path.startsWith("/api/escrows/")) {
      const escrowId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await removeEscrow(escrowId, operatorAddress));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/fund")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "funded", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        txHash: optionalTxHash(body.txHash)
      }, auth));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/submit")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "submitted", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        deliverableUrl: optionalLimitedString(body.deliverableUrl, "deliverableUrl", 2_048),
        txHash: optionalTxHash(body.txHash),
        autoExecute: Boolean(body.autoExecute)
      }, auth));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/verify")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "verified", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        verifierNotes: optionalLimitedString(body.verifierNotes, "verifierNotes", 2_000)
      }, auth));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/release")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "released", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        txHash: optionalTxHash(body.txHash)
      }, auth));
    }

    if (req.method === "GET" && path === "/api/earn/opportunities") {
      return ok({opportunities: listEarnOpportunities()});
    }

    if (req.method === "POST" && path.startsWith("/api/earn/opportunities/") && path.endsWith("/activate")) {
      const id = path.split("/")[4] ?? "";
      const opportunity = listEarnOpportunities().find((item) => item.id === id);
      if (!opportunity) return response(404, {error: "opportunity_not_found"});
      const activation = await updateStore((store) => {
        const record = {
          id: crypto.randomUUID(),
          opportunityId: id,
          operatorAddress: assertTokenAddress(auth, requiredAddress(body.operatorAddress, "operatorAddress"), "operatorAddress"),
          status: opportunity.automationEnabled ? ("queued" as const) : ("requires_configuration" as const),
          createdAt: new Date().toISOString()
        };
        store.earnActivations.push(record);
        pushNotification(store, {
          operatorAddress: record.operatorAddress,
          title: "Save/Earn route requested",
          detail: `${opportunity.title} activation queued`,
          kind: "earn"
        });
        return record;
      });
      return ok({...activation, queue: "agent-actions"});
    }

    if ((req.method === "GET" || req.method === "HEAD") && path === "/api/webhooks/circle") {
      return {status: 200};
    }

    if (req.method === "POST" && path === "/api/webhooks/circle") {
      assertSharedSecret(header(req, "x-webhook-secret"), config.security.webhookSecret, "webhook");
      return ok({received: true, eventType: typeof body.type === "string" ? body.type : "unknown"});
    }

    if (req.method === "POST" && path === "/api/indexer/arc/sync") {
      assertSharedSecret(header(req, "x-indexer-secret"), config.security.indexerSecret, "indexer");
      return ok(await syncArcIndexer());
    }

    return response(404, {error: "not_found", path: rawPath, normalizedPath: path});
  } catch (error) {
    return response(statusFromError(error), {error: storageFriendlyError(error)});
  }
}

export function corsHeaders(origin?: string) {
  return {
    ...securityHeaders(),
    "access-control-allow-origin": corsOrigin(origin),
    "access-control-allow-methods": "GET,POST,PATCH,HEAD,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-payment,x-accept-payment,x402-version,x-admin-secret,x-webhook-secret,x-indexer-secret",
    "access-control-expose-headers": "x-accept-payment,x-payment-response,x402-version",
    "vary": "Origin"
  };
}

function ok(body: unknown) {
  return response(200, body);
}

function response(status: number, body: unknown): AppResponse {
  return {status, body};
}

function statusFromError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as {status?: unknown}).status) : 400;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
}

function header(req: AppRequest, key: string) {
  const wanted = key.toLowerCase();
  const found = Object.entries(req.headers ?? {}).find(([name]) => name.toLowerCase() === wanted);
  return found?.[1];
}

function assertAllowedRequestOrigin(req: AppRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = header(req, "origin");
  const allowed = corsOrigin(origin);
  if (allowed !== "*" && origin && allowed !== origin.replace(/\/+$/, "")) {
    const error = new Error("origin is not allowed");
    (error as Error & {status?: number}).status = 403;
    throw error;
  }
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new Error("optional number is invalid");
  return numberValue;
}

function optionalPolicyV2(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    weeklyLimitUsdc: nonNegativeUsdcAmount(record.weeklyLimitUsdc ?? 0, "weeklyLimitUsdc", 1_000_000),
    monthlyLimitUsdc: nonNegativeUsdcAmount(record.monthlyLimitUsdc ?? 0, "monthlyLimitUsdc", 1_000_000),
    maxUnitsPerRequest: optionalPositiveInteger(record.maxUnitsPerRequest, "maxUnitsPerRequest", 10_000),
    cooldownSeconds: optionalPositiveInteger(record.cooldownSeconds, "cooldownSeconds", 30 * 24 * 60 * 60),
    expiresAt: optionalIsoDate(record.expiresAt, "expiresAt"),
    serviceAllowlist: limitedStringArray(record.serviceAllowlist, "serviceAllowlist", 50, 160),
    requireOnchainPolicy: Boolean(record.requireOnchainPolicy)
  };
}

function optionalPositiveInteger(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} must be a valid non-negative integer`);
  return parsed;
}

function optionalIsoDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const text = requiredLimitedString(value, label, 40);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid date`);
  return new Date(timestamp).toISOString();
}

function limitedStringArray(value: unknown, label: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) throw new Error(`${label} has too many entries`);
  return [...new Set(value.map((item, index) => requiredLimitedString(item, `${label}[${index}]`, maxLength)))];
}

const gatewayDomains = [
  {domain: 26, chainId: config.arc.chainId, chain: "Arc Testnet"},
  {domain: 3, chainId: config.arbitrum.sepoliaChainId, chain: "Arbitrum Sepolia"},
  {domain: 6, chainId: config.base.sepoliaChainId, chain: "Base Sepolia"}
] as const;

type GatewayBalanceResponse = {
  token?: string;
  balances?: Array<{
    domain?: number;
    depositor?: string;
    balance?: string;
  }>;
};

async function gatewayBalances(address: string) {
  const apiUrl = config.gateway.apiUrl.replace(/\/+$/, "");
  const upstream = await fetch(`${apiUrl}/balances`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      token: config.gateway.token,
      sources: gatewayDomains.map(({domain}) => ({domain, depositor: address}))
    })
  });

  const raw = await upstream.text().catch(() => "");
  const parsed = raw ? tryJson<GatewayBalanceResponse>(raw) : {};
  if (!upstream.ok) {
    const error = new Error(gatewayErrorMessage(parsed, raw, upstream.status));
    (error as Error & {status?: number}).status = 502;
    throw error;
  }

  const balances = gatewayDomains.map((domain) => {
    const match = parsed.balances?.find((item) => item.domain === domain.domain);
    const balanceUsdc = parseGatewayBalance(match?.balance);
    return {
      ...domain,
      depositor: match?.depositor ?? address,
      balanceUsdc,
      balance: balanceUsdc.toFixed(6)
    };
  });

  return {
    token: parsed.token ?? config.gateway.token,
    totalBalanceUsdc: roundUsdc(balances.reduce((sum, item) => sum + item.balanceUsdc, 0)),
    balances,
    gateway: {
      environment: apiUrl.includes("testnet") ? "testnet" : "mainnet",
      apiUrl
    },
    updatedAt: new Date().toISOString()
  };
}

function parseGatewayBalance(value: unknown) {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? roundUsdc(parsed) : 0;
}

function gatewayErrorMessage(parsed: unknown, raw: string, status: number) {
  if (parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as {error?: unknown}).error === "string") return (parsed as {error: string}).error;
  if (parsed && typeof parsed === "object" && "message" in parsed && typeof (parsed as {message?: unknown}).message === "string") return (parsed as {message: string}).message;
  return raw.trim() || `Gateway balance request failed: ${status}`;
}

function tryJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

async function developerDashboard(address: string) {
  const store = await readStore();
  const lower = address.toLowerCase();
  const services = store.services.filter((service) => service.publisherAddress.toLowerCase() === lower);
  const payments = store.payments.filter((payment) => payment.publisherAddress.toLowerCase() === lower);
  const escrows = store.escrows.filter((escrow) => escrow.creatorAddress.toLowerCase() === lower || escrow.counterpartyAddress.toLowerCase() === lower);
  const settled = payments.filter((payment) => payment.status === "settled");
  const hasAnalytics = isPlanActive(store.subscriptions, lower, "developer_analytics");
  const platformRevenue = settled.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const grossRevenue = settled.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
  return {
    address,
    services,
    payments: hasAnalytics ? payments : [],
    escrows,
    access: {
      developerAnalytics: hasAnalytics
    },
    summary: {
      publishedServices: services.length,
      totalExecutions: settled.length,
      grossRevenueUsdc: hasAnalytics ? grossRevenue : 0,
      platformRevenueUsdc: hasAnalytics ? platformRevenue : 0,
      netRevenueUsdc: hasAnalytics ? grossRevenue - platformRevenue : 0,
      activeEscrows: escrows.filter((escrow) => escrow.status !== "released" && escrow.status !== "cancelled").length
    }
  };
}

function isPlanActive(subscriptions: Array<{operatorAddress: string; plan: string; status: string; currentPeriodEnd?: string | null}>, operator: string, plan: string) {
  const now = Date.now();
  return subscriptions.some((subscription) => (
    subscription.operatorAddress.toLowerCase() === operator
    && subscription.plan === plan
    && subscription.status === "active"
    && (!subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > now)
  ));
}

async function platformRevenueDashboard() {
  const store = await readStore();
  const onchain = await indexedAnalytics();
  const onchainSummary = onchain.summary;
  const treasuryBalance = await treasuryUsdcBalance();
  const settledPayments = store.payments.filter((payment) => payment.status === "settled");
  const facilitatorVolume = store.facilitatorEvents
    .filter((event) => event.kind === "settle" && event.status === "success")
    .reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0);
  const escrowRevenue = store.escrows
    .filter((escrow) => escrow.status === "released")
    .reduce((sum, escrow) => sum + escrow.platformFeeUsdc, 0);
  const marketplaceGross = settledPayments.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
  const marketplaceFees = settledPayments.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const bookedSubscriptions = store.subscriptions.reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const collectedSubscriptions = store.subscriptions
    .filter((subscription) => subscription.status === "active")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const developerAnalyticsRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "developer_analytics")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const premiumAutomationRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "premium_agent_automation")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const indexedMarketplaceAvailable = onchainSummary.marketplaceSettlements > 0;
  const indexedEscrowAvailable = onchainSummary.escrowReleases > 0;
  const indexedSaveEarnAvailable = onchainSummary.saveEarnWithdrawals > 0;
  const selectedMarketplaceGross = indexedMarketplaceAvailable ? onchainSummary.marketplaceGrossUsdc : marketplaceGross;
  const selectedMarketplaceFees = indexedMarketplaceAvailable ? onchainSummary.marketplaceFeesUsdc : marketplaceFees;
  const selectedEscrowRevenue = indexedEscrowAvailable ? onchainSummary.escrowFeesUsdc : escrowRevenue;
  const selectedSaveEarnFees = indexedSaveEarnAvailable ? onchainSummary.saveEarnFeesUsdc : 0;
  const selectedSettlementCount = indexedMarketplaceAvailable ? onchainSummary.marketplaceSettlements : settledPayments.length;
  const selectedEscrowReleaseCount = indexedEscrowAvailable
    ? onchainSummary.escrowReleases
    : store.escrows.filter((escrow) => escrow.status === "released").length;
  const collectedFees = selectedMarketplaceFees + selectedEscrowRevenue + selectedSaveEarnFees + collectedSubscriptions;
  const policySaves = store.agents.filter((agent) => agent.policy.txHash).length;
  const treasury = config.contracts.treasury;
  const onchainFeeReceipts = onchain.recentEvents
    .filter((event) => event.feeUsdc && event.feeUsdc > 0)
    .map((event) => ({
      id: event.id,
      source: `onchain ${event.contract}`,
      label: onchainReceiptLabel(event),
      grossUsdc: event.amountUsdc ?? event.feeUsdc ?? 0,
      feeUsdc: event.feeUsdc ?? 0,
      netUsdc: Math.max(0, (event.amountUsdc ?? 0) - (event.feeUsdc ?? 0)),
      txHash: event.transactionHash,
      createdAt: event.createdAt
    }));
  const feeReceipts = [
    ...settledPayments
      .filter((payment) => payment.platformFeeUsdc && payment.platformFeeUsdc > 0)
      .map((payment) => ({
        id: payment.id,
        source: "x402 marketplace",
        label: payment.serviceName,
        grossUsdc: payment.grossAmountUsdc ?? payment.amountUsdc,
        feeUsdc: payment.platformFeeUsdc ?? 0,
        netUsdc: payment.publisherNetUsdc ?? 0,
        txHash: payment.txHash ?? null,
        createdAt: payment.settledAt ?? payment.createdAt
      })),
    ...store.escrows
      .filter((escrow) => escrow.status === "released" && escrow.platformFeeUsdc > 0)
      .map((escrow) => ({
        id: escrow.id,
        source: "escrow",
        label: escrow.title,
        grossUsdc: escrow.amountUsdc,
        feeUsdc: escrow.platformFeeUsdc,
        netUsdc: escrow.counterpartyNetUsdc,
        txHash: escrow.txHash ?? null,
        createdAt: escrow.releasedAt ?? escrow.createdAt
      })),
    ...store.subscriptions
      .filter((subscription) => subscription.status === "active" && subscription.amountUsdc > 0)
      .map((subscription) => ({
        id: subscription.id,
        source: "monthly plan",
        label: subscription.planName ?? subscription.plan,
        grossUsdc: subscription.amountUsdc,
        feeUsdc: subscription.amountUsdc,
        netUsdc: subscription.amountUsdc,
        txHash: subscription.txHash ?? null,
        createdAt: subscription.activatedAt ?? subscription.createdAt
      })),
    ...onchainFeeReceipts
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const dedupedFeeReceipts = dedupeFeeReceipts(feeReceipts);

  return {
    treasury,
    treasuryBalance,
    feeReceipts: dedupedFeeReceipts.slice(0, 40),
    onchain,
    summary: {
      totalPlatformRevenueUsdc: roundUsdc(collectedFees),
      analyticsSource: onchainSummary.indexedEvents > 0 ? "indexed" : "local",
      indexedEvents: onchainSummary.indexedEvents,
      marketplaceGrossUsdc: roundUsdc(selectedMarketplaceGross),
      facilitatorVolumeUsdc: roundUsdc(facilitatorVolume),
      marketplaceFeesUsdc: roundUsdc(selectedMarketplaceFees),
      escrowFeesUsdc: roundUsdc(selectedEscrowRevenue),
      saveEarnFeesUsdc: roundUsdc(selectedSaveEarnFees),
      saveEarnDepositVolumeUsdc: onchainSummary.saveEarnDepositVolumeUsdc,
      saveEarnWithdrawalVolumeUsdc: onchainSummary.saveEarnWithdrawalVolumeUsdc,
      subscriptionRevenueUsdc: roundUsdc(collectedSubscriptions),
      bookedPlanVolumeUsdc: roundUsdc(bookedSubscriptions),
      developerAnalyticsRevenueUsdc: roundUsdc(developerAnalyticsRevenue),
      premiumAutomationRevenueUsdc: roundUsdc(premiumAutomationRevenue),
      settledPayments: selectedSettlementCount,
      onchainMarketplaceSettlements: onchainSummary.marketplaceSettlements,
      onchainEscrowReleases: onchainSummary.escrowReleases,
      publishedServices: store.services.length,
      activeAgents: store.agents.filter((agent) => agent.address).length,
      policySaves: onchainSummary.policySaves > 0 ? onchainSummary.policySaves : policySaves
    },
    bySource: [
      {source: "x402 marketplace fees", revenueUsdc: roundUsdc(selectedMarketplaceFees), amountUsdc: roundUsdc(selectedMarketplaceFees), kind: "revenue", count: selectedSettlementCount},
      {source: "escrow fees", revenueUsdc: roundUsdc(selectedEscrowRevenue), amountUsdc: roundUsdc(selectedEscrowRevenue), kind: "revenue", count: selectedEscrowReleaseCount},
      {source: "Save/Earn fees", revenueUsdc: roundUsdc(selectedSaveEarnFees), amountUsdc: roundUsdc(selectedSaveEarnFees), kind: "revenue", count: onchainSummary.saveEarnWithdrawals},
      {source: "Developer analytics monthly", revenueUsdc: roundUsdc(developerAnalyticsRevenue), amountUsdc: roundUsdc(developerAnalyticsRevenue), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active" && subscription.plan === "developer_analytics").length},
      {source: "Premium agent automation monthly", revenueUsdc: roundUsdc(premiumAutomationRevenue), amountUsdc: roundUsdc(premiumAutomationRevenue), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active" && subscription.plan === "premium_agent_automation").length},
      {source: "other active plan revenue", revenueUsdc: roundUsdc(Math.max(0, collectedSubscriptions - developerAnalyticsRevenue - premiumAutomationRevenue)), amountUsdc: roundUsdc(Math.max(0, collectedSubscriptions - developerAnalyticsRevenue - premiumAutomationRevenue)), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active" && subscription.plan !== "developer_analytics" && subscription.plan !== "premium_agent_automation").length},
      {source: "booked plan volume", revenueUsdc: 0, amountUsdc: roundUsdc(bookedSubscriptions), kind: "volume", count: store.subscriptions.length},
      {source: "x402 facilitator volume", revenueUsdc: 0, amountUsdc: roundUsdc(facilitatorVolume), kind: "volume", count: store.facilitatorEvents.filter((event) => event.kind === "settle" && event.status === "success").length},
      {source: "Save/Earn deposit volume", revenueUsdc: 0, amountUsdc: onchainSummary.saveEarnDepositVolumeUsdc, kind: "volume", count: onchainSummary.saveEarnDeposits},
      {source: "Save/Earn withdrawal volume", revenueUsdc: 0, amountUsdc: onchainSummary.saveEarnWithdrawalVolumeUsdc, kind: "volume", count: onchainSummary.saveEarnWithdrawals},
      {source: "Swap fees", revenueUsdc: 0, amountUsdc: 0, kind: "revenue", count: 0}
    ]
  };
}

function onchainReceiptLabel(event: {event: string; actor?: string | null; counterparty?: string | null}) {
  if (event.event === "RequestSettled" || event.event === "AgentRequestSettled") return "x402 settlement";
  if (event.event === "EscrowReleased") return "Escrow release";
  if (event.event === "Withdrawn") return "Save/Earn withdrawal";
  return event.event;
}

function dedupeFeeReceipts<T extends {id: string; txHash?: string | null; source: string}>(receipts: T[]) {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    const key = receipt.txHash ? `tx:${receipt.txHash.toLowerCase()}:${receipt.source}` : `id:${receipt.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function verifyPlanPayment(input: {operatorAddress: string; plan: string; txHash: string; chainId: number}) {
  if (input.chainId !== config.arc.chainId) {
    throw new Error("plan payments are currently accepted on Arc Testnet");
  }
  if (!isAddress(config.contracts.treasury) || !isAddress(config.contracts.usdc)) {
    throw new Error("treasury payment address is not configured");
  }
  const plan = requirePlatformPlan(input.plan);
  const publicClient = arcPublicClient();
  const receipt = await publicClient.getTransactionReceipt({hash: input.txHash as `0x${string}`});
  if (receipt.status !== "success") throw new Error("plan payment transaction reverted");

  const minimumAmount = BigInt(Math.round(plan.amountUsdc * 1_000_000));
  const treasury = config.contracts.treasury.toLowerCase();
  const operator = input.operatorAddress.toLowerCase();
  const usdc = config.contracts.usdc.toLowerCase();
  const paid = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== usdc) return false;
    try {
      const parsed = parseErc20TransferLog(log);
      return parsed.from.toLowerCase() === operator
        && parsed.to.toLowerCase() === treasury
        && parsed.value >= minimumAmount;
    } catch {
      return false;
    }
  });

  if (!paid) {
    throw new Error(`transaction does not include the required ${plan.amountUsdc} USDC transfer to Nexora treasury`);
  }
}

function parseErc20TransferLog(log: {topics: readonly `0x${string}`[]; data: `0x${string}`}) {
  const eventTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  if (log.topics[0]?.toLowerCase() !== eventTopic) throw new Error("not transfer");
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const value = BigInt(log.data);
  return {from, to, value};
}

function topicAddress(topic?: `0x${string}`) {
  if (!topic || topic.length !== 66) throw new Error("invalid indexed address");
  return `0x${topic.slice(26)}`;
}

function arcPublicClient() {
  return createPublicClient({
    transport: http(config.arc.rpcUrl),
    chain: {
      id: config.arc.chainId,
      name: "Arc Testnet",
      nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
      rpcUrls: {default: {http: [config.arc.rpcUrl]}}
    }
  });
}

async function treasuryUsdcBalance() {
  if (!isAddress(config.contracts.treasury) || !isAddress(config.contracts.usdc)) {
    return {
      available: false,
      balanceUsdc: 0,
      asset: config.contracts.usdc,
      treasury: config.contracts.treasury,
      updatedAt: new Date().toISOString()
    };
  }

  try {
    const publicClient = arcPublicClient();
    const raw = await publicClient.readContract({
      address: config.contracts.usdc as `0x${string}`,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [config.contracts.treasury as `0x${string}`]
    });
    return {
      available: true,
      balanceUsdc: roundUsdc(Number(formatUnits(raw, 6))),
      asset: config.contracts.usdc,
      treasury: config.contracts.treasury,
      updatedAt: new Date().toISOString()
    };
  } catch {
    return {
      available: false,
      balanceUsdc: 0,
      asset: config.contracts.usdc,
      treasury: config.contracts.treasury,
      updatedAt: new Date().toISOString()
    };
  }
}

async function facilitatorAnalytics() {
  const store = await readStore();
  const events = store.facilitatorEvents;
  const verifyEvents = events.filter((event) => event.kind === "verify");
  const settleEvents = events.filter((event) => event.kind === "settle");
  const successfulSettles = settleEvents.filter((event) => event.status === "success");
  const activeIntegrators = new Set(successfulSettles.map((event) => event.payTo?.toLowerCase()).filter(Boolean)).size;
  return {
    summary: {
      verifications: verifyEvents.length,
      settlements: successfulSettles.length,
      failed: events.filter((event) => event.status === "failed").length,
      volumeUsdc: roundUsdc(successfulSettles.reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0)),
      activeIntegrators
    },
    recentEvents: events.slice(-40).reverse()
  };
}

async function publicBuilderDirectory() {
  const store = await readStore();
  const byPublisher = new Map<string, typeof store.services>();
  for (const service of store.services.filter((item) => item.active)) {
    const key = service.publisherAddress.toLowerCase();
    byPublisher.set(key, [...(byPublisher.get(key) ?? []), service]);
  }

  const builders = [...byPublisher.entries()].map(([address, services]) => {
    const settled = store.payments.filter((payment) => payment.publisherAddress.toLowerCase() === address && payment.status === "settled");
    const fees = settled.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
    const gross = settled.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
    return {
      address: services[0]?.publisherAddress ?? address,
      services,
      serviceCount: services.length,
      settledPayments: settled.length,
      grossVolumeUsdc: roundUsdc(gross),
      platformFeesUsdc: roundUsdc(fees),
      featured: services.some((service) => service.featured),
      firstPublishedAt: services.map((service) => service.createdAt).sort()[0] ?? null
    };
  });

  builders.sort((a, b) => Number(b.featured) - Number(a.featured) || b.settledPayments - a.settledPayments || b.serviceCount - a.serviceCount);
  return {builders};
}

async function deploymentDashboard() {
  const store = await readStore();
  const settledPayments = store.payments.filter((payment) => payment.status === "settled");
  const escrowFees = store.escrows
    .filter((escrow) => escrow.status === "released")
    .reduce((sum, escrow) => sum + escrow.platformFeeUsdc, 0);
  const marketplaceFees = settledPayments.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const planRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const developerAnalyticsRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "developer_analytics")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const premiumAutomationRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "premium_agent_automation")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const bookedPlanVolume = store.subscriptions.reduce((sum, subscription) => sum + subscription.amountUsdc, 0);

  return {
    treasury: {
      address: config.contracts.treasury,
      totalPlatformRevenueUsdc: roundUsdc(marketplaceFees + escrowFees + planRevenue),
      marketplaceFeesUsdc: roundUsdc(marketplaceFees),
      escrowFeesUsdc: roundUsdc(escrowFees),
      planRevenueUsdc: roundUsdc(planRevenue),
      developerAnalyticsRevenueUsdc: roundUsdc(developerAnalyticsRevenue),
      premiumAutomationRevenueUsdc: roundUsdc(premiumAutomationRevenue),
      bookedPlanVolumeUsdc: roundUsdc(bookedPlanVolume)
    },
    fees: {
      x402DefaultBps: 200,
      escrowDefaultBps: 100,
      saveEarnWithdrawalBps: Number(process.env.NEXORA_WITHDRAWAL_FEE_BPS ?? 100),
      deploymentFeeBps: Number(process.env.NEXORA_FEE_BPS ?? 250),
      editable: false
    },
    chains: [
      {
        key: "arc-testnet",
        primary: true,
        name: "Arc Testnet",
        chainId: config.arc.chainId,
        rpcUrl: config.arc.rpcUrl,
        explorerUrl: config.arc.explorerUrl,
        usdc: config.contracts.usdc,
        contracts: {
          policyRegistry: config.contracts.policyRegistry,
          reputation: config.contracts.reputation,
          x402Ledger: config.contracts.x402Ledger,
          yieldRouter: config.contracts.yieldRouter,
          saveEarnVault: config.contracts.saveEarnVault,
          nexoraEscrow: config.contracts.nexoraEscrow
        },
        features: ["Agent policies", "x402 marketplace", "Save/Earn", "Escrow", "Swap aggregator"]
      },
      {
        key: "arbitrum-sepolia",
        primary: false,
        name: "Arbitrum Sepolia",
        chainId: config.arbitrum.sepoliaChainId,
        rpcUrl: config.arbitrum.sepoliaRpcUrl,
        explorerUrl: config.arbitrum.sepoliaExplorerUrl,
        usdc: config.arbitrum.sepoliaUsdc,
        contracts: {
          policyRegistry: config.arbitrum.sepoliaPolicyRegistry,
          reputation: config.arbitrum.sepoliaReputation,
          x402Ledger: config.arbitrum.sepoliaX402Ledger,
          yieldRouter: config.arbitrum.sepoliaYieldRouter,
          saveEarnVault: config.arbitrum.sepoliaSaveEarnVault,
          nexoraEscrow: config.arbitrum.sepoliaEscrow
        },
        features: ["Agent policies", "x402 marketplace", "Save/Earn", "Escrow"]
      },
      {
        key: "base-sepolia",
        primary: false,
        name: "Base Sepolia",
        chainId: config.base.sepoliaChainId,
        rpcUrl: config.base.sepoliaRpcUrl,
        explorerUrl: config.base.sepoliaExplorerUrl,
        usdc: config.base.sepoliaUsdc,
        contracts: {
          policyRegistry: config.base.sepoliaPolicyRegistry,
          reputation: config.base.sepoliaReputation,
          x402Ledger: config.base.sepoliaX402Ledger,
          yieldRouter: config.base.sepoliaYieldRouter,
          saveEarnVault: config.base.sepoliaSaveEarnVault,
          nexoraEscrow: config.base.sepoliaEscrow
        },
        features: ["Agent policies", "x402 marketplace", "Save/Earn", "Escrow"]
      }
    ]
  };
}

async function createEscrow(input: {
  creatorAddress: string;
  counterpartyAddress: string;
  title: string;
  description: string;
  amountUsdc: number;
  performanceBondUsdc: number;
  platformFeeBps: number;
  chainEscrowId?: number;
  txHash?: string;
}) {
  return updateStore((store) => {
    const platformFeeUsdc = roundUsdc((input.amountUsdc * input.platformFeeBps) / 10_000);
    const escrow = {
      id: crypto.randomUUID(),
      chainEscrowId: input.chainEscrowId ?? null,
      creatorAddress: input.creatorAddress,
      counterpartyAddress: input.counterpartyAddress,
      title: input.title,
      description: input.description,
      amountUsdc: input.amountUsdc,
      performanceBondUsdc: input.performanceBondUsdc,
      platformFeeBps: input.platformFeeBps,
      platformFeeUsdc,
      counterpartyNetUsdc: roundUsdc(input.amountUsdc - platformFeeUsdc),
      status: "draft" as const,
      createdAt: new Date().toISOString(),
      txHash: input.txHash ?? null
    };
    store.escrows.push(escrow);
    pushNotification(store, {
      operatorAddress: input.creatorAddress,
      title: "Escrow created",
      detail: `${input.amountUsdc} USDC for ${input.title}`,
      kind: "escrow",
      txHash: input.txHash ?? null
    });
    pushNotification(store, {
      operatorAddress: input.counterpartyAddress,
      title: "Escrow assigned",
      detail: `${input.amountUsdc} USDC task: ${input.title}`,
      kind: "escrow",
      txHash: input.txHash ?? null
    });
    return escrow;
  });
}

async function removeEscrow(escrowId: string, operatorAddress: string) {
  return updateStore((store) => {
    const escrowIndex = store.escrows.findIndex((item) => item.id === escrowId);
    if (escrowIndex === -1) throw new Error("escrow not found");

    const escrow = store.escrows[escrowIndex];
    const operator = operatorAddress.toLowerCase();
    const canRemove = escrow.creatorAddress.toLowerCase() === operator || escrow.counterpartyAddress.toLowerCase() === operator;
    if (!canRemove) throw new Error("Only the creator or counterparty can remove this escrow from their workspace.");
    if (!["draft", "released", "cancelled"].includes(escrow.status)) {
      throw new Error("Only draft, released, or cancelled escrows can be removed from the workspace.");
    }

    store.escrows.splice(escrowIndex, 1);
    pushNotification(store, {
      operatorAddress,
      title: "Escrow removed",
      detail: escrow.title,
      kind: "escrow"
    });
    return {removed: true, escrowId};
  });
}

async function updateEscrow(
  escrowId: string,
  status: "funded" | "submitted" | "verified" | "released",
  fields: Record<string, string | boolean | undefined>,
  auth: AuthContext
) {
  const operatorAddress = requiredAddress(fields.operatorAddress, "operatorAddress");
  assertTokenAddress(auth, operatorAddress, "operatorAddress");
  const autoResult = status === "submitted" && fields.autoExecute ? await runEscrowAgentSafe(escrowId) : null;
  return updateStore((store) => {
    const escrow = store.escrows.find((item) => item.id === escrowId);
    if (!escrow) throw new Error("escrow not found");
    assertEscrowRole(escrow, operatorAddress, status);
    escrow.status = status;
    if (typeof fields.txHash === "string") escrow.txHash = fields.txHash;
    if (typeof fields.deliverableUrl === "string") escrow.deliverableUrl = fields.deliverableUrl;
    if (typeof fields.verifierNotes === "string") escrow.verifierNotes = fields.verifierNotes;
    if (autoResult) {
      escrow.deliverableUrl = autoResult.deliverableUrl;
      escrow.deliverableResult = autoResult.result;
    }
    const now = new Date().toISOString();
    if (status === "funded") escrow.fundedAt = now;
    if (status === "submitted") escrow.submittedAt = now;
    if (status === "verified") escrow.verifiedAt = now;
    if (status === "released") escrow.releasedAt = now;
    const title = status === "funded"
      ? "Escrow funded"
      : status === "submitted"
        ? "Escrow deliverable submitted"
        : status === "verified"
          ? "Escrow verified"
          : "Escrow released";
    pushNotification(store, {
      operatorAddress: escrow.creatorAddress,
      title,
      detail: escrow.title,
      kind: "escrow",
      txHash: escrow.txHash ?? null
    });
    pushNotification(store, {
      operatorAddress: escrow.counterpartyAddress,
      title,
      detail: escrow.title,
      kind: "escrow",
      txHash: escrow.txHash ?? null
    });
    return escrow;
  });
}

function assertEscrowRole(
  escrow: {creatorAddress: string; counterpartyAddress: string},
  operatorAddress: string,
  action: "funded" | "submitted" | "verified" | "released"
) {
  const operator = operatorAddress.toLowerCase();
  const creator = escrow.creatorAddress.toLowerCase();
  const counterparty = escrow.counterpartyAddress.toLowerCase();
  if (action === "submitted") {
    if (operator !== counterparty) throw new Error("Only the counterparty can submit this escrow deliverable.");
    return;
  }
  if (operator !== creator) throw new Error("Only the escrow creator can perform this action.");
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function runEscrowAgent(escrowId: string) {
  const store = await readStore();
  const escrow = store.escrows.find((item) => item.id === escrowId);
  if (!escrow) throw new Error("escrow not found");
  const text = `${escrow.title}\n${escrow.description}`;
  const github = cleanExtractedValue(text.match(/github\.com\/[^\s)]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i)?.[0]);
  const url = cleanExtractedValue(text.match(/https?:\/\/[^\s)]+/i)?.[0]);
  const xHandle = text.match(/@[A-Za-z0-9_]{1,15}/)?.[0];

  if (github && /github\.com\/|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github)) {
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/github-analysis`,
      result: {
        kind: "github_repo_analyzer",
        input: {repo: github},
        output: await executeBuiltInService("github_repo_analyzer", {repo: github})
      }
    };
  }

  if (url) {
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/website-analysis`,
      result: {
        kind: "website_analyzer",
        input: {url},
        output: await executeBuiltInService("website_analyzer", {url})
      }
    };
  }

  if (xHandle) {
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/x-analysis`,
      result: {
        kind: "x_account_analyzer",
        input: {handle: xHandle},
        output: await executeBuiltInService("x_account_analyzer", {handle: xHandle})
      }
    };
  }

  return {
    deliverableUrl: `nexora://escrows/${escrowId}/manual-deliverable`,
    result: {
      kind: "generic",
      input: {description: escrow.description},
      output: {
        status: "manual_review",
        summary: "No URL, GitHub repository, or X handle was found in the escrow details. Attach a manual deliverable."
      }
    }
  };
}

async function runEscrowAgentSafe(escrowId: string) {
  try {
    return await runEscrowAgent(escrowId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent execution failed";
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/agent-error`,
      result: {
        kind: "agent_error",
        input: {escrowId},
        output: {
          status: "error",
          summary: "The on-chain submission succeeded, but Nexora could not complete the automatic agent analysis.",
          message
        }
      }
    };
  }
}

function cleanExtractedValue(value: string | undefined) {
  return value?.replace(/[.,;:!?]+$/g, "");
}

function normalizePath(path: string) {
  if (path === "/") return "/api/health";
  if (path === "/health") return "/api/health";
  if (path.startsWith("/api/")) return path;
  return `/api${path}`;
}
