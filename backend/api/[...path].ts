import {corsHeaders, handleAppRequest} from "../src/app";

type VercelRequestLike = {
  method?: string;
  url?: string;
  headers: {
    host?: string;
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
    body: typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {}
  });

  for (const [key, value] of Object.entries({...corsHeaders(), ...result.headers})) {
    res.setHeader(key, value);
  }

  if (result.body === undefined) {
    res.status(result.status).end();
    return;
  }

  res.status(result.status).json(result.body);
}
