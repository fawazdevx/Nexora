import {config} from "./config.js";
import {createPublicClient, formatUnits, http, isAddress, parseAbi} from "viem";
import {authorizeX402, paymentRequired, settleX402} from "./x402/facilitator.js";
import {createAgentWallet, refreshPendingCircleWallets, submitAgentX402Settlement, updateAgentPolicy} from "./circle/agent-wallets.js";
import {listEarnOpportunities} from "./earn/opportunities.js";
import {executeBuiltInService, executeMarketplaceService, featureService, listServices, platformPlans, publishService, subscribePlan} from "./marketplace/services.js";
import {operatorProfile} from "./identity/operators.js";
import {integrationReadiness} from "./readiness.js";
import {synthraApproval, synthraQuote, synthraReadiness, synthraSwap} from "./swap/synthra.js";
import {appSnapshot, pushNotification, readStore, storageFriendlyError, updateStore} from "./store.js";
import {settleFacilitatorPayment, supportedX402, verifyFacilitatorPayment} from "./x402/protocol-facilitator.js";

const erc20BalanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export type AppRequest = {
  method: string;
  url: string;
  host?: string;
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
    const body = req.body ?? {};
    const rawPath = url.pathname;
    const path = normalizePath(rawPath);

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
      return ok(await deploymentDashboard());
    }

    if (req.method === "GET" && path === "/api/app") {
      const operator = optionalString(url.searchParams.get("operator"));
      await refreshPendingCircleWallets(operator);
      return ok(await appSnapshot(operator));
    }

    if (req.method === "POST" && path === "/api/auth/nonce") {
      return ok({nonce: `nexora:${String(body.address ?? "")}:${Date.now()}`});
    }

    if (req.method === "POST" && path === "/api/auth/verify") {
      return ok({token: Buffer.from(`${String(body.address ?? "")}:${String(body.nonce ?? "")}`).toString("base64url")});
    }

    if (req.method === "GET" && path.startsWith("/api/operators/")) {
      return ok(await operatorProfile(decodeURIComponent(path.replace("/api/operators/", ""))));
    }

    if (req.method === "POST" && path === "/api/agents") {
      return ok(await createAgentWallet({
        operatorAddress: requiredString(body.operatorAddress, "operatorAddress"),
        arcName: optionalString(body.arcName),
        dailyLimitUsdc: requiredNumber(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredNumber(body.transactionCapUsdc, "transactionCapUsdc")
      }));
    }

    if ((req.method === "PATCH" || req.method === "POST") && path.startsWith("/api/agents/") && path.endsWith("/policies")) {
      const agentId = path.split("/")[3] ?? "local";
      return ok(await updateAgentPolicy(agentId, {
        dailyLimitUsdc: requiredNumber(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredNumber(body.transactionCapUsdc, "transactionCapUsdc"),
        contractAllowlist: arrayOfStrings(body.contractAllowlist),
        recipientAllowlist: arrayOfStrings(body.recipientAllowlist),
        txHash: optionalString(body.txHash)
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

    if (req.method === "GET" && path === "/api/swap/readiness") {
      const {circleSwapReadiness} = await import("./swap/circle-swap.js");
      return ok(circleSwapReadiness());
    }

    if (req.method === "POST" && path === "/api/swap/estimate") {
      const {estimateCircleSwap} = await import("./swap/circle-swap.js");
      return ok(await estimateCircleSwap({
        tokenIn: requiredString(body.tokenIn, "tokenIn"),
        tokenOut: requiredString(body.tokenOut, "tokenOut"),
        amountIn: requiredString(body.amountIn, "amountIn"),
        slippageBps: optionalNumber(body.slippageBps)
      }));
    }

    if (req.method === "POST" && path === "/api/swap/execute") {
      const {executeCircleSwap} = await import("./swap/circle-swap.js");
      return ok(await executeCircleSwap({
        tokenIn: requiredString(body.tokenIn, "tokenIn"),
        tokenOut: requiredString(body.tokenOut, "tokenOut"),
        amountIn: requiredString(body.amountIn, "amountIn"),
        slippageBps: optionalNumber(body.slippageBps)
      }));
    }

    if (req.method === "GET" && path === "/api/synthra/readiness") {
      return ok(synthraReadiness());
    }

    if (req.method === "POST" && path === "/api/synthra/quote") {
      return ok(await synthraQuote({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredString(body.tokenIn, "tokenIn"),
        tokenOut: requiredString(body.tokenOut, "tokenOut"),
        amount: requiredString(body.amount, "amount")
      }));
    }

    if (req.method === "POST" && path === "/api/synthra/approval") {
      return ok(await synthraApproval({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredString(body.tokenIn, "tokenIn"),
        tokenOut: requiredString(body.tokenOut, "tokenOut"),
        amount: requiredString(body.amount, "amount"),
        owner: requiredString(body.owner, "owner")
      }));
    }

    if (req.method === "POST" && path === "/api/synthra/swap") {
      return ok(await synthraSwap({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredString(body.tokenIn, "tokenIn"),
        tokenOut: requiredString(body.tokenOut, "tokenOut"),
        amount: requiredString(body.amount, "amount"),
        recipient: requiredString(body.recipient, "recipient"),
        sender: requiredString(body.sender, "sender"),
        slippageBps: optionalNumber(body.slippageBps)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/services") {
      return response(201, await publishService({
        publisherAddress: requiredString(body.publisherAddress, "publisherAddress"),
        name: requiredString(body.name, "name"),
        endpointHash: requiredString(body.endpointHash, "endpointHash"),
        pricePerUnitUsdc: requiredNumber(body.pricePerUnitUsdc, "pricePerUnitUsdc"),
        chainServiceId: optionalNumber(body.chainServiceId),
        txHash: optionalString(body.txHash)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/feature") {
      return ok(await featureService({
        serviceId: requiredString(body.serviceId, "serviceId"),
        operatorAddress: requiredString(body.operatorAddress, "operatorAddress")
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/marketplace/services/") && path.endsWith("/execute")) {
      const serviceId = path.split("/")[4] ?? "";
      return ok(await executeMarketplaceService({
        serviceId,
        payer: requiredString(body.payer, "payer"),
        args: body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {}
      }));
    }

    if (req.method === "GET" && path === "/api/monetization/plans") {
      return ok({plans: await platformPlans()});
    }

    if (req.method === "POST" && path === "/api/monetization/subscribe") {
      return response(201, await subscribePlan({
        operatorAddress: requiredString(body.operatorAddress, "operatorAddress"),
        plan: requiredString(body.plan, "plan"),
        amountUsdc: requiredNumber(body.amountUsdc, "amountUsdc")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/payment-required") {
      return response(402, paymentRequired({
        serviceId: requiredString(body.serviceId, "serviceId"),
        amountUsdc: requiredNumber(body.amountUsdc, "amountUsdc"),
        resource: requiredString(body.resource, "resource"),
        payTo: requiredString(body.payTo, "payTo")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/authorize") {
      return ok(await authorizeX402({
        serviceId: requiredString(body.serviceId, "serviceId"),
        payer: requiredString(body.payer, "payer"),
        requestHash: requiredString(body.requestHash, "requestHash"),
        units: requiredNumber(body.units, "units"),
        agentId: optionalString(body.agentId)
      }));
    }

    if (req.method === "POST" && path === "/api/x402/settle") {
      const authorizationId = requiredString(body.authorizationId, "authorizationId");
      const agentId = optionalString(body.agentId);
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
        txHash: optionalString(body.txHash)
      }));
    }

    if (req.method === "GET" && path.startsWith("/api/developers/") && path.endsWith("/dashboard")) {
      return ok(await developerDashboard(decodeURIComponent(path.split("/")[3] ?? "")));
    }

    if (req.method === "GET" && path === "/api/revenue") {
      return ok(await platformRevenueDashboard());
    }

    if (req.method === "GET" && path === "/api/escrows") {
      return ok({escrows: (await readStore()).escrows});
    }

    if (req.method === "POST" && path === "/api/escrows") {
      return response(201, await createEscrow({
        creatorAddress: requiredString(body.creatorAddress, "creatorAddress"),
        counterpartyAddress: requiredString(body.counterpartyAddress, "counterpartyAddress"),
        title: requiredString(body.title, "title"),
        description: requiredString(body.description, "description"),
        amountUsdc: requiredNumber(body.amountUsdc, "amountUsdc"),
        performanceBondUsdc: requiredNumber(body.performanceBondUsdc, "performanceBondUsdc"),
        platformFeeBps: optionalNumber(body.platformFeeBps) ?? 100,
        chainEscrowId: optionalNumber(body.chainEscrowId),
        txHash: optionalString(body.txHash)
      }));
    }

    if (req.method === "DELETE" && path.startsWith("/api/escrows/")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await removeEscrow(escrowId, requiredString(body.operatorAddress, "operatorAddress")));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/fund")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "funded", {
        txHash: optionalString(body.txHash)
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/submit")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "submitted", {
        deliverableUrl: optionalString(body.deliverableUrl),
        autoExecute: Boolean(body.autoExecute)
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/verify")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "verified", {
        verifierNotes: optionalString(body.verifierNotes)
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/release")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "released", {
        txHash: optionalString(body.txHash)
      }));
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
          operatorAddress: requiredString(body.operatorAddress, "operatorAddress"),
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
      return ok({received: true, eventType: typeof body.type === "string" ? body.type : "unknown"});
    }

    if (req.method === "POST" && path === "/api/indexer/arc/sync") {
      return ok({status: "queued", queue: "indexing"});
    }

    return response(404, {error: "not_found", path: rawPath, normalizedPath: path});
  } catch (error) {
    return response(400, {error: storageFriendlyError(error)});
  }
}

export function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,HEAD,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-payment,x-accept-payment,x402-version",
    "access-control-expose-headers": "x-accept-payment,x-payment-response,x402-version"
  };
}

function ok(body: unknown) {
  return response(200, body);
}

function response(status: number, body: unknown): AppResponse {
  return {status, body};
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new Error("optional number is invalid");
  return numberValue;
}

function requiredNumber(value: unknown, label: string) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`${label} must be a number`);
  return numberValue;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function developerDashboard(address: string) {
  const store = await readStore();
  const lower = address.toLowerCase();
  const services = store.services.filter((service) => service.publisherAddress.toLowerCase() === lower);
  const payments = store.payments.filter((payment) => payment.publisherAddress.toLowerCase() === lower);
  const escrows = store.escrows.filter((escrow) => escrow.creatorAddress.toLowerCase() === lower || escrow.counterpartyAddress.toLowerCase() === lower);
  const settled = payments.filter((payment) => payment.status === "settled");
  const platformRevenue = settled.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const grossRevenue = settled.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
  return {
    address,
    services,
    payments,
    escrows,
    summary: {
      publishedServices: services.length,
      totalExecutions: settled.length,
      grossRevenueUsdc: grossRevenue,
      platformRevenueUsdc: platformRevenue,
      netRevenueUsdc: grossRevenue - platformRevenue,
      activeEscrows: escrows.filter((escrow) => escrow.status !== "released" && escrow.status !== "cancelled").length
    }
  };
}

async function platformRevenueDashboard() {
  const store = await readStore();
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
  const collectedFees = marketplaceFees + escrowRevenue + collectedSubscriptions;
  const policySaves = store.agents.filter((agent) => agent.policy.txHash).length;
  const treasury = config.contracts.treasury;
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
      }))
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return {
    treasury,
    treasuryBalance,
    feeReceipts: feeReceipts.slice(0, 40),
    summary: {
      totalPlatformRevenueUsdc: roundUsdc(collectedFees),
      marketplaceGrossUsdc: roundUsdc(marketplaceGross),
      facilitatorVolumeUsdc: roundUsdc(facilitatorVolume),
      marketplaceFeesUsdc: roundUsdc(marketplaceFees),
      escrowFeesUsdc: roundUsdc(escrowRevenue),
      subscriptionRevenueUsdc: roundUsdc(collectedSubscriptions),
      bookedPlanVolumeUsdc: roundUsdc(bookedSubscriptions),
      settledPayments: settledPayments.length,
      publishedServices: store.services.length,
      activeAgents: store.agents.filter((agent) => agent.address).length,
      policySaves
    },
    bySource: [
      {source: "x402 marketplace fees", revenueUsdc: roundUsdc(marketplaceFees), amountUsdc: roundUsdc(marketplaceFees), kind: "revenue", count: settledPayments.length},
      {source: "escrow fees", revenueUsdc: roundUsdc(escrowRevenue), amountUsdc: roundUsdc(escrowRevenue), kind: "revenue", count: store.escrows.filter((escrow) => escrow.status === "released").length},
      {source: "active plan revenue", revenueUsdc: roundUsdc(collectedSubscriptions), amountUsdc: roundUsdc(collectedSubscriptions), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active").length},
      {source: "booked plan volume", revenueUsdc: 0, amountUsdc: roundUsdc(bookedSubscriptions), kind: "volume", count: store.subscriptions.length},
      {source: "x402 facilitator volume", revenueUsdc: 0, amountUsdc: roundUsdc(facilitatorVolume), kind: "volume", count: store.facilitatorEvents.filter((event) => event.kind === "settle" && event.status === "success").length},
      {source: "Save/Earn fees", revenueUsdc: 0, amountUsdc: 0, kind: "revenue", count: store.earnActivations.length},
      {source: "Swap fees", revenueUsdc: 0, amountUsdc: 0, kind: "revenue", count: 0}
    ]
  };
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
    const publicClient = createPublicClient({
      transport: http(config.arc.rpcUrl),
      chain: {
        id: config.arc.chainId,
        name: "Arc Testnet",
        nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
        rpcUrls: {default: {http: [config.arc.rpcUrl]}}
      }
    });
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
  const bookedPlanVolume = store.subscriptions.reduce((sum, subscription) => sum + subscription.amountUsdc, 0);

  return {
    treasury: {
      address: config.contracts.treasury,
      totalPlatformRevenueUsdc: roundUsdc(marketplaceFees + escrowFees + planRevenue),
      marketplaceFeesUsdc: roundUsdc(marketplaceFees),
      escrowFeesUsdc: roundUsdc(escrowFees),
      planRevenueUsdc: roundUsdc(planRevenue),
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

async function updateEscrow(escrowId: string, status: "funded" | "submitted" | "verified" | "released", fields: Record<string, string | boolean | undefined>) {
  const autoResult = status === "submitted" && fields.autoExecute ? await runEscrowAgentSafe(escrowId) : null;
  return updateStore((store) => {
    const escrow = store.escrows.find((item) => item.id === escrowId);
    if (!escrow) throw new Error("escrow not found");
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
