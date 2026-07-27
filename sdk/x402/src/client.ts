import type {
  CircleExternalReceiptInput,
  CirclePaymentIntent,
  CirclePaymentIntentAuthorization,
  CirclePaymentIntentRequest,
  NexoraX402ClientOptions,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
  X402PaymentPayload
} from "./types.js";

export class NexoraX402Client {
  readonly facilitatorUrl: string;
  private readonly authorizationToken?: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(facilitatorUrl: string, options: NexoraX402ClientOptions = {}) {
    this.facilitatorUrl = facilitatorUrl.replace(/\/+$/, "");
    this.authorizationToken = options.authorizationToken;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  supported() {
    return this.request<SupportedResponse>("/api/x402/supported", {method: "GET"});
  }

  verify(paymentPayload: X402PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.request<VerifyResponse>("/api/x402/verify", {
      method: "POST",
      body: JSON.stringify({paymentPayload, paymentRequirements})
    });
  }

  settle(paymentPayload: X402PaymentPayload, paymentRequirements: PaymentRequirements) {
    // Nexora Marketplace owns `/api/x402/settle` and expects an
    // authorizationId. The facilitator has a deliberately distinct internal
    // endpoint so SDK calls cannot be misrouted by hosting rewrites.
    return this.request<SettleResponse>("/api/x402/facilitator-settle", {
      method: "POST",
      body: JSON.stringify({paymentPayload, paymentRequirements})
    });
  }

  createCirclePaymentIntent(input: CirclePaymentIntentRequest) {
    return this.request<CirclePaymentIntent>("/api/circle/agent-marketplace/intents", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  approveCirclePaymentIntent(intentId: string, operatorAddress: string, note?: string) {
    return this.request<CirclePaymentIntent>(`/api/payment-intents/${encodeURIComponent(intentId)}/approve`, {
      method: "POST",
      body: JSON.stringify({operatorAddress, note})
    });
  }

  rejectCirclePaymentIntent(intentId: string, operatorAddress: string, note?: string) {
    return this.request<CirclePaymentIntent>(`/api/payment-intents/${encodeURIComponent(intentId)}/reject`, {
      method: "POST",
      body: JSON.stringify({operatorAddress, note})
    });
  }

  circlePaymentIntentAuthorization(intentId: string, operatorAddress: string) {
    const query = new URLSearchParams({operatorAddress});
    return this.request<CirclePaymentIntentAuthorization>(`/api/payment-intents/${encodeURIComponent(intentId)}/authorization?${query}`, {
      method: "GET"
    });
  }

  completeCirclePaymentIntent(intentId: string, input: CircleExternalReceiptInput) {
    return this.request<{status: "settled"; intent: CirclePaymentIntent; receipt: unknown; result: unknown}>(
      `/api/payment-intents/${encodeURIComponent(intentId)}/external-receipt`,
      {method: "POST", body: JSON.stringify(input)}
    );
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.facilitatorUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.authorizationToken ? {authorization: `Bearer ${this.authorizationToken}`} : {}),
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `Nexora x402 request failed: ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  }
}

export function parseXPaymentHeader(value: string | null | undefined): X402PaymentPayload | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const candidates = [
    raw,
    tryDecodeBase64(raw),
    tryDecodeBase64Url(raw)
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as X402PaymentPayload;
    } catch {
      // Try next representation.
    }
  }

  throw new Error("X-PAYMENT header is not valid JSON or base64 JSON");
}

export const parsePaymentSignatureHeader = parseXPaymentHeader;

export function encodeX402Header(value: unknown) {
  const json = JSON.stringify(value);
  const buffer = (globalThis as unknown as {Buffer?: {from(value: string, encoding: string): {toString(encoding: string): string}}}).Buffer;
  if (buffer) return buffer.from(json, "utf8").toString("base64");
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(json)));
  throw new Error("No base64 encoder is available in this runtime");
}

function tryDecodeBase64(value: string) {
  try {
    const buffer = (globalThis as unknown as {Buffer?: {from(value: string, encoding: string): {toString(encoding: string): string}}}).Buffer;
    if (buffer) return buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
  return null;
}

function tryDecodeBase64Url(value: string) {
  return tryDecodeBase64(value.replace(/-/g, "+").replace(/_/g, "/"));
}
