import type {NexoraReceiptCallback, NexoraReceiptEvent, X402Context} from "./types.js";

export type NexoraWebhookHandler<TArgs = unknown, TResult = unknown> = (input: {
  args: TArgs;
  context?: X402Context;
  receipt?: NexoraReceiptEvent;
}) => TResult | Promise<TResult>;

export function createWebhookExecutor<TArgs = unknown, TResult = unknown>(handler: NexoraWebhookHandler<TArgs, TResult>) {
  return async function executeWebhookRequest(request: Request, context?: X402Context) {
    const body = await safeJson(request);
    const args = (body.args ?? body) as TArgs;
    const result = await handler({args, context});
    return Response.json(result);
  };
}

export async function dispatchReceiptCallback(callback: NexoraReceiptCallback | undefined, event: NexoraReceiptEvent) {
  if (!callback) return;
  await callback(event);
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  if (text.length > 256_000) throw new Error("webhook request body is too large");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("webhook body must be a JSON object");
  return parsed as Record<string, unknown>;
}
