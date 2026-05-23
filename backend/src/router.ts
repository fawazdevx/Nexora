import {config} from "./config.js";
import {authorizeX402, paymentRequired, settleX402} from "./x402/facilitator.js";
import {createAgentWallet, refreshPendingCircleWallets, updateAgentPolicy} from "./circle/agent-wallets.js";
import {listEarnOpportunities} from "./earn/opportunities.js";
import {executeMarketplaceService, featureService, listServices, platformPlans, publishService, subscribePlan} from "./marketplace/services.js";
import {operatorProfile} from "./identity/operators.js";
import {integrationReadiness} from "./readiness.js";
import {appSnapshot, storageFriendlyError, updateStore} from "./store.js";

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

    if (req.method === "GET" && path === "/api/readiness") {
      return ok(integrationReadiness());
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
        units: requiredNumber(body.units, "units")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/settle") {
      return ok(await settleX402({
        authorizationId: requiredString(body.authorizationId, "authorizationId"),
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
    "access-control-allow-headers": "content-type,authorization,x-payment"
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

function normalizePath(path: string) {
  if (path === "/") return "/api/health";
  if (path === "/health") return "/api/health";
  if (path.startsWith("/api/")) return path;
  return `/api${path}`;
}
