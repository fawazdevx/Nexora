# Integrating Nexora into a game

Nexora can act as a Stripe-like programmable USDC payment and control layer for a game. It can supply wallet integration, chain-aware settlement, policy checks, platform-fee splitting, x402 purchases, escrow, and verifiable receipts. The game still owns its gameplay ledger and must define who can move player funds.

## Recommended architecture

| Game money action | Nexora or Circle component | Game responsibility |
| --- | --- | --- |
| Player wallet | Circle user-controlled or modular wallet, or a connected EOA | Account linking and player recovery policy |
| Player deposit | USDC transfer or a dedicated game vault; Gateway may unify supported-chain liquidity | Credit the in-game ledger only after final settlement and reconciliation |
| Item or API purchase | Nexora x402 settlement and receipt | Deliver the item exactly once for the payment request id |
| Prize pool | Dedicated audited prize-pool or escrow contract | Define entry, cancellation, winner, refund, and deadline rules |
| Creator or player payout | Circle developer-controlled payout wallet with explicit policy and approval | Authorize the payout from trusted game state and prevent duplicate payout ids |
| Platform fee | Nexora settlement or game contract fee split | Define whether the fee is charged on deposits, purchases, winnings, or withdrawals |
| Refund or dispute | Escrow/refund workflow | Define evidence, decision authority, and refund eligibility |

Gateway is a unified USDC liquidity layer, not the game’s internal accounting database. A Gateway deposit must not automatically become a spendable game balance until the game records a unique deposit event and reconciles it.

## Required money invariants

1. Every deposit, purchase, payout, refund, and withdrawal has a unique idempotency key.
2. The game credits funds only after a verified on-chain or Circle receipt.
3. A payout id can settle once, even if a client retries.
4. Platform fees use one documented basis and basis-point value.
5. Player balances reconcile to custody or contract balances.
6. Administrative payout authority is separated from gameplay servers.
7. Withdrawal destinations and high-value payouts can require policy checks or human approval.

## Suggested API boundary

```text
POST /game/deposit-intents
POST /game/deposits/:id/reconcile
POST /game/purchases
POST /game/payouts
POST /game/payouts/:id/approve
POST /game/refunds
GET  /game/ledger/:playerId
GET  /game/receipts/:receiptId
```

Each write should accept an `Idempotency-Key`, authenticate the player or operator, and store the complete settlement reference. Do not let a game client choose the payout amount, fee recipient, or treasury address without server-side validation.

## Practical first release

Start with one narrow flow:

1. Players use a Circle user-controlled/modular wallet or connected wallet.
2. The game sells one item or tournament entry in USDC.
3. Nexora creates the payment requirement and receipt.
4. The game grants the item or entry only after verified settlement.
5. A fixed platform fee is split to the game treasury.
6. An operator dashboard reconciles purchases and failed deliveries.

Add pooled deposits, withdrawals, and prize custody only after the custody and refund rules are implemented and reviewed.

