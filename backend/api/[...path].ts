import {corsHeaders, handleAppRequest} from "../src/router.js";

type VercelRequestLike = {
  method?: string;
  url?: string;
  headers: {
    host?: string;
    origin?: string;
    authorization?: string;
    "x-admin-secret"?: string;
    "x-webhook-secret"?: string;
    "x-indexer-secret"?: string;
  };
  body?: unknown;
};

type VercelResponseLike = {
  setHeader(key: string, value: string): void;
  status(status: number): {
    end(): void;
    json(body: unknown): void;
  };
};

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
  const result = await handleAppRequest({
    method: req.method ?? "GET",
    url: req.url ?? "/",
    host: req.headers.host,
    headers: req.headers,
    body: typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {}
  }).catch((error) => ({
    status: 500,
    body: {
      error: error instanceof Error ? error.message : "backend request failed"
    }
  }));

  for (const [key, value] of Object.entries({...corsHeaders(req.headers.origin), ...result.headers})) {
    if (typeof value === "string") res.setHeader(key, value);
  }

  if (result.body === undefined) {
    res.status(result.status).end();
    return;
  }

  res.status(result.status).json(result.body);
}
