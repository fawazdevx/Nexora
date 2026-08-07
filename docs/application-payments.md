# Integrating Nexora into an application

Nexora can provide programmable payment and financial-control primitives to games, SaaS products, AI workflows, marketplaces, freelance platforms, creator tools, subscriptions, commerce, checkout, and treasury applications across its integrated chains.

It is useful to think of Nexora as an onchain payment and control layer, not a complete Stripe replacement. Nexora can handle wallet execution, policy checks, approval workflows, x402 payment requirements, fee-aware contracts, receipts, notifications, and Gateway routing. The integrating application remains responsible for user accounts, its internal ledger, entitlements, refunds, disputes, tax treatment, and custody rules.

## Reusable components

| Application need | Nexora/Circle component | Application responsibility |
| --- | --- | --- |
| Managed wallet | Circle developer-controlled wallet | Map the wallet to the correct user, agent, or treasury role |
| User-owned wallet | Connected EOA or Circle user/modular wallet | Authentication, recovery, and transaction consent |
| Paid API or metered action | `@nexorafi/x402` and Nexora facilitator | Deliver the result exactly once after settlement |
| Spending guard | Nexora Policy Registry and policy engine | Define the limits and authorized operators |
| High-risk payment | Approval queue and risk monitor | Define reviewers, expiry, and escalation |
| Cross-chain USDC | Circle Gateway | Reconcile deposits and destination delivery |
| Platform purchase | Marketplace or settlement contract | Maintain orders, inventory, and entitlements |
| Work milestone | Nexora Escrow | Define evidence, deadlines, disputes, and refunds |
| Idle treasury | Save/Earn profile pools | Choose Conservative, Balanced, or Growth; USDC routes into the profile's active underlying Arc vault and is reevaluated every 24 hours |
| Audit trail | Nexora receipts and notifications | Retain business records and reconcile exceptions |

## Common application flows

### SaaS and API usage

Return an x402 challenge for a paid request, verify and settle it through Nexora, then grant one usage unit. Store the Nexora request hash and receipt ID against the customer invoice or usage record.

### Marketplace and creator commerce

Bind each purchase to a seller, amount, fee basis, product ID, and idempotency key. Deliver the item only once. Seller payouts and refunds should use separate reviewed workflows instead of trusting values supplied by the client.

### Subscriptions

Use a server-owned subscription schedule and create a unique payment intent for each billing period. A successful payment extends access once; retries must resolve to the existing period receipt.

### Escrow and freelance work

Lock funds against a clear milestone, deadline, counterparty, and dispute policy. Release only after the application records valid completion evidence or an authorized decision.

### Games and prize systems

Use a dedicated purchase or prize-pool flow, not an untracked shared wallet. The game grants an item, entry, or prize only after final settlement and keeps gameplay state separate from custody accounting. See [the game-specific example](game-payments.md).

### Treasury and autonomous agents

Attach policy limits, recipient and contract allowlists, service allowlists, cooldowns, and approval thresholds to the wallet that moves funds. Automation may propose or execute only within those controls.

## Money invariants

1. Every deposit, purchase, payout, refund, and withdrawal has a unique idempotency key.
2. A product entitlement or internal balance changes only after a verified receipt.
3. One payment receipt cannot satisfy two business operations.
4. The server derives amount, token, recipient, chain, and fee from trusted application state.
5. Payout and withdrawal authority is separated from untrusted clients.
6. Internal balances reconcile to onchain or Circle custody balances.
7. Failed delivery after successful payment enters an explicit recovery or refund workflow.
8. High-value or unusual transactions can require policy checks and human approval.

## Suggested API boundary

```text
POST /payment-intents
POST /payment-intents/:id/approve
POST /payment-intents/:id/execute
POST /payments/:id/reconcile
POST /payout-intents
POST /refund-intents
GET  /receipts/:id
GET  /ledger/accounts/:id
```

These endpoints are an application architecture, not automatic Nexora routes. Each integration should add authentication, authorization, idempotency, transaction verification, and durable reconciliation before production use.
