import type {IncomingMessage, ServerResponse} from "node:http";
import {corsHeaders, handleAppRequest} from "./src/router.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const result = await handleAppRequest({
    method: req.method ?? "GET",
    url: req.url ?? "/",
    host: req.headers.host,
    body
  });

  for (const [key, value] of Object.entries({...corsHeaders(), ...result.headers})) {
    res.setHeader(key, value);
  }

  res.writeHead(result.status, result.body === undefined ? undefined : {"content-type": "application/json"});
  res.end(result.body === undefined ? undefined : JSON.stringify(result.body));
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
