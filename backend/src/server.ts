import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {pathToFileURL} from "node:url";
import {config} from "./config.js";
import {corsHeaders, handleAppRequest} from "./app.js";

export async function handler(req: IncomingMessage, res: ServerResponse) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(handler);
  server.listen(config.port, () => {
    console.log(`Nexora API listening on :${config.port}`);
  });
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
