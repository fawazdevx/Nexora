import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {pathToFileURL} from "node:url";
import {config} from "./config.js";
import {authorizeX402, paymentRequired, settleX402} from "./x402/facilitator.js";
import {createAgentWallet, updateAgentPolicy} from "./circle/agent-wallets.js";
import {listEarnOpportunities} from "./earn/opportunities.js";
import {featureService, listServices, platformPlans, publishService, subscribePlan} from "./marketplace/services.js";
import {operatorProfile} from "./identity/operators.js";
import {integrationReadiness} from "./readiness.js";
import {appSnapshot, updateStore} from "./store.js";

export async function handler(req: IncomingMessage, res: ServerResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const body = await readJson(req);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") {
      return json(res, 200, {ok: true, network: "Arc Testnet", chainId: config.arc.chainId});
    }

    if (req.method === "GET" && path === "/api/readiness") {
      return json(res, 200, integrationReadiness());
    }

    if (req.method === "GET" && path === "/api/app") {
      return json(res, 200, await appSnapshot(optionalString(url.searchParams.get("operator"))));
    }

    if (req.method === "POST" && path === "/api/auth/nonce") {
      return json(res, 200, {nonce: `nexora:${String(body.address ?? "")}:${Date.now()}`});
    }

    if (req.method === "POST" && path === "/api/auth/verify") {
      return json(res, 200, {token: Buffer.from(`${String(body.address ?? "")}:${String(body.nonce ?? "")}`).toString("base64url")});
    }

    if (req.method === "GET" && path.startsWith("/api/operators/")) {
      return json(res, 200, await operatorProfile(decodeURIComponent(path.replace("/api/operators/", ""))));
    }

    if (req.method === "POST" && path === "/api/agents") {
      return json(res, 200, await createAgentWallet({
        operatorAddress: requiredString(body.operatorAddress, "operatorAddress"),
        arcName: optionalString(body.arcName),
        dailyLimitUsdc: requiredNumber(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredNumber(body.transactionCapUsdc, "transactionCapUsdc")
      }));
    }

    if ((req.method === "PATCH" || req.method === "POST") && path.startsWith("/api/agents/") && path.endsWith("/policies")) {
      const agentId = path.split("/")[3] ?? "local";
      return json(res, 200, await updateAgentPolicy(agentId, {
        dailyLimitUsdc: requiredNumber(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredNumber(body.transactionCapUsdc, "transactionCapUsdc"),
        contractAllowlist: arrayOfStrings(body.contractAllowlist),
        recipientAllowlist: arrayOfStrings(body.recipientAllowlist)
      }));
    }

    if (req.method === "GET" && path === "/api/marketplace/services") {
      return json(res, 200, {services: await listServices()});
    }

    if (req.method === "POST" && path === "/api/marketplace/services") {
      return json(res, 201, await publishService({
        publisherAddress: requiredString(body.publisherAddress, "publisherAddress"),
        name: requiredString(body.name, "name"),
        endpointHash: requiredString(body.endpointHash, "endpointHash"),
        pricePerUnitUsdc: requiredNumber(body.pricePerUnitUsdc, "pricePerUnitUsdc"),
        chainServiceId: optionalNumber(body.chainServiceId),
        txHash: optionalString(body.txHash)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/feature") {
      return json(res, 200, await featureService({
        serviceId: requiredString(body.serviceId, "serviceId"),
        operatorAddress: requiredString(body.operatorAddress, "operatorAddress")
      }));
    }

    if (req.method === "GET" && path === "/api/monetization/plans") {
      return json(res, 200, {plans: await platformPlans()});
    }

    if (req.method === "POST" && path === "/api/monetization/subscribe") {
      return json(res, 201, await subscribePlan({
        operatorAddress: requiredString(body.operatorAddress, "operatorAddress"),
        plan: requiredString(body.plan, "plan"),
        amountUsdc: requiredNumber(body.amountUsdc, "amountUsdc")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/payment-required") {
      return json(res, 402, paymentRequired({
        serviceId: requiredString(body.serviceId, "serviceId"),
        amountUsdc: requiredNumber(body.amountUsdc, "amountUsdc"),
        resource: requiredString(body.resource, "resource"),
        payTo: requiredString(body.payTo, "payTo")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/authorize") {
      return json(res, 200, await authorizeX402({
        serviceId: requiredString(body.serviceId, "serviceId"),
        payer: requiredString(body.payer, "payer"),
        requestHash: requiredString(body.requestHash, "requestHash"),
        units: requiredNumber(body.units, "units")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/settle") {
      return json(res, 200, await settleX402({
        authorizationId: requiredString(body.authorizationId, "authorizationId"),
        txHash: optionalString(body.txHash)
      }));
    }

    if (req.method === "GET" && path === "/api/earn/opportunities") {
      return json(res, 200, {opportunities: listEarnOpportunities()});
    }

    if (req.method === "POST" && path.startsWith("/api/earn/opportunities/") && path.endsWith("/activate")) {
      const id = path.split("/")[4] ?? "";
      const opportunity = listEarnOpportunities().find((item) => item.id === id);
      if (!opportunity) return json(res, 404, {error: "opportunity_not_found"});
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
      return json(res, 200, {...activation, queue: "agent-actions"});
    }

    if (req.method === "HEAD" && path === "/api/webhooks/circle") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST" && path === "/api/webhooks/circle") {
      return json(res, 200, {received: true, eventType: typeof body.type === "string" ? body.type : "unknown"});
    }

    if (req.method === "POST" && path === "/api/indexer/arc/sync") {
      return json(res, 200, {status: "queued", queue: "indexing"});
    }

    return json(res, 404, {error: "not_found"});
  } catch (error) {
    return json(res, 400, {error: error instanceof Error ? error.message : "bad_request"});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(handler);
  server.listen(config.port, () => {
    console.log(`Nexora API listening on :${config.port}`);
  });
}

function setCors(res: ServerResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,HEAD,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization,x-payment");
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {"content-type": "application/json"});
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return {};

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
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
