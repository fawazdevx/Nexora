# `@nexorafi/x402`

`@nexorafi/x402` adds Nexora payment requirements and middleware to Express and Next.js APIs. It supports x402 v1 and v2, USDC settlement on Arc, Base, and Arbitrum, and policy-guarded Permit2/USDT settlement on BOT Chain through Meridian.

The package also exposes Circle Agent Stack helpers for creating Nexora-controlled payment intents, checking approval, and submitting an externally executed payment for onchain receipt verification.

> Network types describe protocol compatibility. A route is live only when its chain contracts, token, RPC, facilitator, and application configuration are deployed and verified.

> npm v0.3 is the current published release. This source tree is v0.4.0 and prepares BOT Chain mainnet, Meridian Marketplace attribution, and mainnet constants. Publish v0.4.0 before using `@0.4` in an installation command.

## Install

```bash
npm install @nexorafi/x402@0.3
```

The package is ESM and publishes TypeScript declarations.

## Supported network names

```ts
type X402Network =
  | "arc-testnet"
  | "arc"
  | "base-sepolia"
  | "base"
  | "arbitrum-sepolia"
  | "arbitrum"
  | "bot-chain-testnet"
  | "bot-chain"
  | `eip155:${number}`;
```

x402 v2 challenges use CAIP-2 network IDs. V1 challenges preserve readable aliases for compatibility. Applications must enable `bot-chain` only after they configure separate mainnet policy, reputation, relayer, seller, treasury, and settlement values.

## Express

```ts
import express from "express";
import {nexoraX402} from "@nexorafi/x402";

const app = express();

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL!,
    payTo: process.env.PUBLISHER_ADDRESS!,
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    price: "0.05",
    network: "base-sepolia",
    x402Version: 2,
    resource: "https://api.example.com/paid-report",
    description: "Paid Base Sepolia report",
    onReceipt: async ({verification, settlement}) => {
      console.log(verification.payer, settlement?.transaction);
    }
  }),
  (req, res) => {
    res.json({
      ok: true,
      payer: req.x402?.verification.payer,
      transaction: req.x402?.settlement?.transaction
    });
  }
);
```

## Next.js route handler

```ts
import {withNexoraX402} from "@nexorafi/x402";

export const POST = withNexoraX402(
  {
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL!,
    payTo: process.env.PUBLISHER_ADDRESS!,
    asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    price: "0.02",
    network: "arbitrum-sepolia",
    x402Version: 2,
    resource: "https://api.example.com/risk-check",
    description: "Arbitrum Sepolia risk check"
  },
  async (_request, context) => Response.json({
    ok: true,
    payer: context.verification.payer,
    transaction: context.settlement?.transaction
  })
);
```

## Headers

| Version | Client payment | Server challenge | Settlement response |
| --- | --- | --- | --- |
| v1 | `X-PAYMENT` | JSON / v1 accepts | `X-PAYMENT-RESPONSE` |
| v2 | `PAYMENT-SIGNATURE` | `PAYMENT-REQUIRED` | `PAYMENT-RESPONSE` |

Challenge and receipt headers are base64-encoded JSON. Helpers support both plain and encoded payloads:

```ts
import {
  encodeX402Header,
  parsePaymentSignatureHeader,
  parseXPaymentHeader
} from "@nexorafi/x402";
```

## Direct facilitator client

```ts
import {NexoraX402Client} from "@nexorafi/x402";

const client = new NexoraX402Client("https://api.nexora.example");
const supported = await client.supported();
const verification = await client.verify(paymentPayload, paymentRequirements);

if (!verification.isValid) {
  throw new Error(verification.invalidReason);
}

const settlement = await client.settle(paymentPayload, paymentRequirements);
```

The client calls:

```text
GET  /api/x402/supported
POST /api/x402/verify
POST /api/x402/facilitator-settle
```

`/api/x402/facilitator-settle` is intentionally separate from Nexora Marketplace authorization settlement, which requires an internal authorization ID.

## BOT Chain

BOT uses Permit2 because its configured USDT does not expose EIP-3009. Use the dedicated builder so `payTo` and the Permit2 witness always target Meridian's facilitator, not the seller wallet.

```ts
import {
  buildMeridianPermit2Payload,
  buildPermit2WitnessTypedData,
  createMeridianPaymentRequirements,
  randomPermit2Nonce
} from "@nexorafi/x402";

const requirements = createMeridianPaymentRequirements({
  facilitatorUrl: "https://api.nexora.example",
  network: "bot-chain-testnet",
  amountAtomic: "10000",
  resource: "https://seller.example/paid-report",
  description: "BOT Chain paid report",
  creditedRecipient: process.env.MERIDIAN_SELLER_ADDRESS!
});

const nonce = randomPermit2Nonce();
const deadline = String(Math.floor(Date.now() / 1000) + 300);
const typedData = buildPermit2WitnessTypedData({
  token: requirements.asset,
  amount: requirements.maxAmountRequired,
  facilitator: requirements.payTo,
  chainId: 968,
  nonce,
  deadline
});

const signature = await wallet.signTypedData(typedData);
const paymentPayload = buildMeridianPermit2Payload({
  network: "bot-chain-testnet",
  signature,
  owner: wallet.account.address,
  token: requirements.asset,
  amount: requirements.maxAmountRequired,
  facilitator: requirements.payTo,
  nonce,
  deadline
});

const settlement = await client.settle(paymentPayload, requirements);
```

Defaults:

```text
chain ID     968
USDT         0x75edC9335175Fc0552D51D48439F229c10420fe3
facilitator  0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A
```

When this payment is routed through Nexora, the backend checks the connected EOA's BOT policy before Meridian relay. A direct Meridian request bypasses Nexora's policy, receipt, notification, and reputation layer.

Mainnet uses:

```text
network      bot-chain
chain ID     677
USDT         0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C
facilitator  0x8E7769D440b3460b92159Dd9C6D17302b036e2d6
```

Set `network: "bot-chain"` in both the requirements and payload builders. For Marketplace attribution, pass the seller wallet as `creditedRecipient`; the builder places it in `extra.creditedRecipient`. Configure Nexora's percentage fee in Meridian Command Centre rather than adding custom fee fields to `paymentRequirements`.

## External Circle Agent Stack flow

External Circle Agent Stack clients can use Nexora's controls without handing wallet execution to Nexora:

```ts
const nexora = new NexoraX402Client("https://api.nexora.example", {
  authorizationToken: signedNexoraSession
});

const intent = await nexora.createCirclePaymentIntent({
  operatorAddress,
  agentId,
  walletAddress,
  serviceUrl,
  chain: "BASE_SEPOLIA",
  data: {query: "BTC"}
});

// An operator approves in Nexora, or through the authenticated SDK method.
await nexora.approveCirclePaymentIntent(intent.id, operatorAddress);

const authorization = await nexora.circlePaymentIntentAuthorization(
  intent.id,
  operatorAddress
);

if (!authorization.approved) throw new Error("Payment is not approved");

// Execute with the application's own Circle Agent Stack wallet.
const paid = await externalCircleAgent.pay(
  authorization.payment.serviceUrl,
  authorization.payment.data
);

const completed = await nexora.completeCirclePaymentIntent(intent.id, {
  operatorAddress,
  paymentResponse: paid.paymentResponse,
  result: paid.result
});
```

External completion does not trust a client-provided `success` flag. The payment response must include a transaction hash, and Nexora verifies the approved chain, USDC token, payer, recipient, amount, and successful transaction before recording a settled receipt. Gateway-batched external payments without a directly verifiable transfer are not accepted through this completion endpoint yet.

## Service manifests

```ts
import {createNexoraServiceManifest} from "@nexorafi/x402";

const manifest = createNexoraServiceManifest({
  name: "Wallet Risk + Approval Scan",
  endpointHash: "wallet-risk-approval-scan-v1",
  kind: "wallet_risk_approval_scan",
  price: "0.05",
  outputSchema: ["wallet", "riskLevel", "checks", "recommendedPolicy"]
});
```

## Using Nexora in applications

The SDK can protect paid HTTP resources used by games, SaaS products, AI agents, marketplaces, commerce, subscriptions, creator tools, and treasury workflows. It provides payment requirements, verification, settlement, and receipt callbacks.

It does not create a complete custody ledger, refund system, payout engine, or entitlement database. Applications must authenticate users, enforce idempotency, deliver the paid resource exactly once, and reconcile each settlement with their own product ledger.

## Migration from v0.3 to v0.4

1. Publish and install `@nexorafi/x402@0.4`.
2. Keep existing Arc, Base, and Arbitrum middleware unchanged.
3. Set `network: "bot-chain"` for BOT mainnet and retain `bot-chain-testnet` for chain `968`.
4. Add `creditedRecipient` for Meridian Marketplace seller attribution, and configure the Marketplace fee in Meridian Command Centre.
5. Keep mainnet disabled in the application until the backend advertises it from verified configuration.

Run release commands from the package directory. The parent `sdk/` directory has no `package.json`.

```bash
cd sdk/x402
npm install
npm run typecheck
npm test
npm pack --dry-run
npm whoami
npm publish --access public
```

Run the block from the repository root. The package version must be unused on npm. Check it with `npm view @nexorafi/x402 versions --json` before publication.

## Security checklist

- Keep facilitator, Circle, and Meridian credentials server-side.
- Configure an explicit asset and publisher for every USDC route.
- Treat network, token, recipient, amount, validity window, signature, and nonce as mandatory checks.
- Do not deliver an entitlement before settlement succeeds.
- Use one idempotency key for each application purchase or payout.
- Never reuse a transaction hash to satisfy two payment intents.
- Keep BOT Permit2 approvals scoped to the canonical Permit2 contract.
- Do not describe a mainnet route as live until contracts and operational controls have been tested.
- Obtain an independent audit before production custody or high-value flows.
