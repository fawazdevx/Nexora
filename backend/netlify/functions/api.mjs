import {handleAppRequest, corsHeaders} from "../../dist/router.js";

export async function handler(event) {
  const body = parseBody(event.body);
  const result = await handleAppRequest({
    method: event.httpMethod ?? "GET",
    url: event.rawUrl ?? event.path ?? "/",
    host: event.headers?.host,
    body
  });

  return {
    statusCode: result.status,
    headers: {
      ...corsHeaders(),
      ...(result.body === undefined ? {} : {"content-type": "application/json"}),
      ...(result.headers ?? {})
    },
    body: result.body === undefined ? "" : JSON.stringify(result.body)
  };
}

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
