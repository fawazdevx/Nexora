import type {PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse, X402PaymentPayload} from "./types.js";

export class NexoraX402Client {
  readonly facilitatorUrl: string;

  constructor(facilitatorUrl: string) {
    this.facilitatorUrl = facilitatorUrl.replace(/\/+$/, "");
  }

  supported() {
    return this.request<SupportedResponse>("/x402/supported", {method: "GET"});
  }

  verify(paymentPayload: X402PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.request<VerifyResponse>("/x402/verify", {
      method: "POST",
      body: JSON.stringify({paymentPayload, paymentRequirements})
    });
  }

  settle(paymentPayload: X402PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.request<SettleResponse>("/x402/settle", {
      method: "POST",
      body: JSON.stringify({paymentPayload, paymentRequirements})
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.facilitatorUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
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
