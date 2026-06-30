# @nexorafi/x402

Nexora x402 SDK and middleware for protecting APIs with Arc USDC payments.

The SDK helps developers:

- return x402 payment requirements
- parse `X-PAYMENT` headers
- verify signed payment payloads through Nexora
- settle payments through Nexora
- protect Express and Next.js routes
- generate Nexora service manifests and policy hints
- run webhook-backed service executors
- trigger receipt callbacks after verified settlement

## Install

```bash
npm install @nexorafi/x402
```

For local repo development:

```bash
npm install ../sdk/x402
```

## Express

```ts
import express from "express";
import {nexoraX402} from "@nexorafi/x402";

const app = express();
const facilitatorUrl = process.env.NEXORA_FACILITATOR_URL ?? "https://nexorafibackend.vercel.app";

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl,
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    description: "Website growth report",
    onReceipt: async ({settlement}) => {
      console.log("Nexora receipt tx", settlement?.transaction);
    }
  }),
  (_req, res) => {
    res.json({report: "paid result"});
  }
);

app.listen(3000);
```

## Next.js Route Handler

```ts
import {withNexoraX402} from "@nexorafi/x402";

const facilitatorUrl = process.env.NEXORA_FACILITATOR_URL ?? "https://nexorafibackend.vercel.app";

export const GET = withNexoraX402(
  {
    facilitatorUrl,
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    description: "Paid API response"
  },
  async (_request, context) => {
    return Response.json({
      ok: true,
      payer: context.verification.payer,
      tx: context.settlement?.transaction
    });
  }
);
```

## Service Manifest

Use `createNexoraServiceManifest` before publishing a paid endpoint to Nexora.

```ts
import {createNexoraServiceManifest} from "@nexorafi/x402";

const manifest = createNexoraServiceManifest({
  name: "Wallet Risk + Approval Scan",
  endpointHash: "wallet-risk-approval-scan-v1",
  kind: "wallet_risk_approval_scan",
  price: "0.05",
  outputSchema: ["wallet", "riskLevel", "checks", "recommendedPolicy"]
});

console.log(manifest.policyHints);
```

## Webhook Executor

Use `createWebhookExecutor` for a webhook endpoint that Nexora can call after settlement.

```ts
import {createWebhookExecutor} from "@nexorafi/x402";

export const POST = createWebhookExecutor(async ({args}) => {
  return {
    status: "ok",
    summary: "Paid execution complete",
    input: args
  };
});
```

## Options

`facilitatorUrl` is the Nexora facilitator endpoint used by the SDK to verify and settle x402 payments.

```ts
type NexoraX402Config = {
  facilitatorUrl: string;
  payTo: string;
  asset: string;
  price?: string;
  amountAtomic?: string;
  network?: "arc-testnet" | "arc";
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  settle?: boolean;
  outputSchema?: unknown;
  onReceipt?: (event: {
    paymentRequirements: PaymentRequirements;
    verification: VerifyResponse;
    settlement?: SettleResponse;
  }) => void | Promise<void>;
};
```

Use `price` for USDC decimal strings such as `"0.05"`, or `amountAtomic` for base units.

## Security

- Use HTTPS for production facilitator URLs.
- Keep publisher wallets and payout addresses explicit.
- Set `settle: false` only if your API intentionally wants verify-only behavior.
- Nexora verifies amount, recipient, asset, network, authorization time window, signature, and replay protection.
- Do not treat provider-dependent services such as compliance, liquidation, or APY monitors as definitive unless your endpoint uses a licensed/live provider.
