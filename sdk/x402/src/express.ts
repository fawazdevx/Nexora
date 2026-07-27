import {encodeX402Header, NexoraX402Client, parseXPaymentHeader} from "./client.js";
import {createPaymentRequirements, paymentRequiredResponseForVersion} from "./requirements.js";
import {dispatchReceiptCallback} from "./webhook.js";
import type {NexoraX402Config, X402Context} from "./types.js";

type ExpressLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  url?: string;
  x402?: X402Context;
};

type ExpressLikeResponse = {
  status(code: number): ExpressLikeResponse;
  set(name: string, value: string): ExpressLikeResponse;
  json(value: unknown): unknown;
};

type ExpressLikeNext = () => unknown;

export function nexoraX402(config: NexoraX402Config) {
  const client = new NexoraX402Client(config.facilitatorUrl);

  return async function nexoraX402Middleware(req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressLikeNext) {
    const paymentRequirements = createPaymentRequirements({
      ...config,
      resource: config.resource ?? req.originalUrl ?? req.url ?? "express-route"
    });
    const header = headerValue(
      req.headers["payment-signature"]
      ?? req.headers["PAYMENT-SIGNATURE"]
      ?? req.headers["x-payment"]
      ?? req.headers["X-PAYMENT"]
    );
    const payment = parseXPaymentHeader(header);

    if (!payment) {
      return sendPaymentRequired(res, paymentRequirements);
    }

    const verification = await client.verify(payment, paymentRequirements);
    if (!verification.isValid) {
      return sendPaymentRequired(res, paymentRequirements, verification.invalidReason);
    }

    const settlement = config.settle === false ? undefined : await client.settle(payment, paymentRequirements);
    if (settlement && !settlement.success) {
      return sendPaymentRequired(res, paymentRequirements, settlement.errorReason);
    }

    await dispatchReceiptCallback(config.onReceipt, {paymentRequirements, verification, settlement});
    if (settlement) {
      const receiptHeader = encodeX402Header(settlement);
      res.set("PAYMENT-RESPONSE", receiptHeader).set("X-PAYMENT-RESPONSE", receiptHeader);
    }
    req.x402 = {payment, paymentRequirements, verification, settlement};
    return next();
  };
}

function sendPaymentRequired(res: ExpressLikeResponse, paymentRequirements: ReturnType<typeof createPaymentRequirements>, reason?: string) {
  const version = paymentRequirementsVersion(paymentRequirements);
  const body = {
    ...paymentRequiredResponseForVersion(paymentRequirements, version),
    ...(reason ? {error: reason} : {})
  };
  const encoded = encodeX402Header(body);
  return res
    .status(402)
    .set("x-accept-payment", "x402")
    .set("x402-version", String(version))
    .set("PAYMENT-REQUIRED", encoded)
    .json(body);
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function paymentRequirementsVersion(paymentRequirements: ReturnType<typeof createPaymentRequirements>): 1 | 2 {
  return Number(paymentRequirements.extra?.x402Version) === 1 ? 1 : 2;
}
