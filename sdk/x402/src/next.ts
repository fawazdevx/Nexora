import {NexoraX402Client, parseXPaymentHeader} from "./client.js";
import {createPaymentRequirements, paymentRequiredResponse} from "./requirements.js";
import {dispatchReceiptCallback} from "./webhook.js";
import type {NexoraX402Config, X402Context} from "./types.js";

export type NexoraNextHandler = (request: Request, context: X402Context) => Response | Promise<Response>;

export function withNexoraX402(config: NexoraX402Config, handler: NexoraNextHandler) {
  const client = new NexoraX402Client(config.facilitatorUrl);

  return async function nexoraX402Route(request: Request) {
    const paymentRequirements = createPaymentRequirements({
      ...config,
      resource: config.resource ?? request.url
    });
    const payment = parseXPaymentHeader(request.headers.get("x-payment"));

    if (!payment) {
      return paymentRequired(paymentRequirements);
    }

    const verification = await client.verify(payment, paymentRequirements);
    if (!verification.isValid) {
      return paymentRequired(paymentRequirements, verification.invalidReason);
    }

    const settlement = config.settle === false ? undefined : await client.settle(payment, paymentRequirements);
    if (settlement && !settlement.success) {
      return paymentRequired(paymentRequirements, settlement.errorReason);
    }

    await dispatchReceiptCallback(config.onReceipt, {paymentRequirements, verification, settlement});
    return handler(request, {payment, paymentRequirements, verification, settlement});
  };
}

function paymentRequired(paymentRequirements: ReturnType<typeof createPaymentRequirements>, reason?: string) {
  return Response.json(
    {
      ...paymentRequiredResponse(paymentRequirements),
      ...(reason ? {error: reason} : {})
    },
    {
      status: 402,
      headers: {
        "x-accept-payment": "x402",
        "x402-version": "1"
      }
    }
  );
}
