# Nexora

**The financial control layer for AI agents.**

Nexora is an Arc-first, USDC-native infrastructure app for AI agents, developers, and service operators. It combines agent wallets, onchain spending policies, x402 facilitation, paid API publishing, escrow, swap routing, Save/Earn routing, reputation, and treasury tracking in one stack.

Arc is the primary deployment because USDC is native gas on Arc, which makes agent payments and x402 settlement simpler to build and test.

## What Nexora Does

- **Agent wallets:** create and manage Circle agent wallets for autonomous USDC activity.
- **Onchain policies:** configure daily spend limits, transaction caps, contract allowlists, and recipient allowlists.
- **x402 facilitator:** expose `/x402/supported`, `/x402/verify`, and `/x402/settle` endpoints for external paid APIs.
- **Paid API marketplace:** publish API/service manifests with per-execution USDC pricing.
- **USDC settlement:** record and settle paid requests through the Nexora facilitator ledger.
- **Escrow:** create USDC work agreements with fund, submit, verify, release, and cancel flows.
- **Save/Earn:** deposit USDC into the Nexora vault and route toward approved Arc strategies.
- **Swap:** compare Arc liquidity routes for stablecoin swaps.
- **Reputation and revenue:** track settled payments, service activity, treasury fees, and operator reputation.

> Current network note: Swap and Save/Earn currently work only on Arc. Arbitrum Sepolia and Base Sepolia are secondary test deployments for contract interactions.

## Repository Layout

```text
contracts/   Foundry smart contracts, tests, deployment scripts, upgrade scripts
backend/     Node/TypeScript API, x402 facilitator, Circle wallet integration, marketplace execution
frontend/    Vite/React app, RainbowKit wallet connect, operator console, landing page
sdk/x402/    Developer SDK and middleware for integrating Nexora x402 payments
```

## Smart Contracts

Core contracts:

- `NexoraPolicyRegistry`: agent registration, spending policy, allowlists, facilitator checks.
- `X402FacilitatorLedger`: paid service publishing and USDC request settlement.
- `OperatorReputation`: reputation signal storage.
- `NexoraYieldRouter`: routes Save/Earn deposits to active strategies.
- `NexoraSaveEarnVault`: user-facing USDC Save/Earn vault.
- `NexoraEscrow`: USDC work agreement escrow.
- `NexoraProxy` / `NexoraUpgradeable`: upgradeable proxy pattern.

Integrations should use proxy addresses, not implementation addresses.

## x402 Facilitator

Nexora exposes facilitator endpoints for external APIs:

```text
GET  /x402/supported
POST /x402/verify
POST /x402/settle
```

The facilitator validates:

- x402 version and scheme
- supported network and asset
- payment recipient
- max amount
- authorization time window
- EIP-712 `TransferWithAuthorization` signature
- replay protection through nonce/request hash tracking

Settlement uses USDC `transferWithAuthorization(...)` on Arc.

### Developer SDK

The local SDK lives in `sdk/x402` and provides:

- `NexoraX402Client`
- `nexoraX402(...)` Express-style middleware
- `withNexoraX402(...)` Next.js route helper
- payment requirement builders

Example:

```ts
import {nexoraX402} from "@nexora/x402";

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl: "https://nexorafibackend.vercel.app",
    payTo: "0xPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet"
  }),
  (_req, res) => {
    res.json({report: "paid result"});
  }
);
```

See `sdk/x402/README.md` for Express and Next.js examples.

Backend-only facilitator env:

```env
FACILITATOR_SIGNING_MODE=server
FACILITATOR_PRIVATE_KEY=0x...
```

Use a dedicated facilitator wallet. Do not use your owner/deployer key, and never expose this key to the frontend.

## Local Development

Install dependencies:

```bash
cd backend
npm install

cd ../frontend
npm install

cd ../contracts
forge install
```

Run backend:

```bash
cd backend
npm run dev
```

Run frontend:

```bash
cd frontend
npm run dev
```

Run contract tests:

```bash
cd contracts
forge test -vvv
```

Typecheck:

```bash
cd backend
npm run typecheck

cd ../frontend
npm run typecheck
```

## Environment Variables

### Backend

```env
PORT=4000
DATABASE_URL=
PGSSL_REJECT_UNAUTHORIZED=true

ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_EXPLORER_URL=https://testnet.arcscan.app

USDC_ADDRESS=0x3600000000000000000000000000000000000000
POLICY_REGISTRY_ADDRESS=
REPUTATION_ADDRESS=
X402_LEDGER_ADDRESS=
YIELD_ROUTER_ADDRESS=
SAVE_EARN_VAULT_ADDRESS=
NEXORA_ESCROW_ADDRESS=
TREASURY_ADDRESS=

CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=

NEXORA_AUTH_SECRET=
NEXORA_REQUIRE_SIGNED_AUTH=false
NEXORA_ADMIN_SECRET=
NEXORA_WEBHOOK_SECRET=
NEXORA_INDEXER_SECRET=
CORS_ALLOWED_ORIGINS=

ARC_INDEXER_FROM_BLOCK=0
ARC_INDEXER_MAX_BLOCKS=5000
ARC_INDEXER_CONFIRMATIONS=2

FACILITATOR_SIGNING_MODE=server
FACILITATOR_PRIVATE_KEY=

SYNTHRA_API_KEY=
SYNTHRA_API_URL=https://trading-api.synthra.org
```

Optional multi-chain testnet env:

```env
ARB_SEPOLIA_RPC_URL=
ARB_SEPOLIA_CHAIN_ID=421614
ARB_SEPOLIA_USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS=
ARB_SEPOLIA_REPUTATION_ADDRESS=
ARB_SEPOLIA_X402_LEDGER_ADDRESS=
ARB_SEPOLIA_YIELD_ROUTER_ADDRESS=
ARB_SEPOLIA_SAVE_EARN_VAULT_ADDRESS=
ARB_SEPOLIA_NEXORA_ESCROW_ADDRESS=

BASE_SEPOLIA_RPC_URL=https://base-sepolia-rpc.publicnode.com
BASE_SEPOLIA_CHAIN_ID=84532
BASE_SEPOLIA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS=
BASE_SEPOLIA_REPUTATION_ADDRESS=
BASE_SEPOLIA_X402_LEDGER_ADDRESS=
BASE_SEPOLIA_YIELD_ROUTER_ADDRESS=
BASE_SEPOLIA_SAVE_EARN_VAULT_ADDRESS=
BASE_SEPOLIA_NEXORA_ESCROW_ADDRESS=
```

### Frontend

```env
VITE_NEXORA_API_URL=http://localhost:4000
VITE_WC_PROJECT_ID=

VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_ARC_EXPLORER_URL=https://testnet.arcscan.app
VITE_ARC_NAMES_REGISTRY_ADDRESS=

VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_POLICY_REGISTRY_ADDRESS=
VITE_REPUTATION_ADDRESS=
VITE_X402_LEDGER_ADDRESS=
VITE_YIELD_ROUTER_ADDRESS=
VITE_SAVE_EARN_VAULT_ADDRESS=
VITE_NEXORA_ESCROW_ADDRESS=

VITE_ENABLE_ARBITRUM_SEPOLIA=true
VITE_ENABLE_BASE_SEPOLIA=true
```

## Deploy Contracts

From `contracts/`:

```bash
set -a
source .env
set +a

forge script script/DeployNexora.s.sol:DeployNexora \
  --rpc-url $ARC_RPC_URL \
  --chain-id $ARC_CHAIN_ID \
  --account deploytestKey \
  --sender $OWNER_ADDRESS \
  --broadcast \
  -vvv
```

For upgrades, keep app env pointed at the same proxy addresses and run the relevant script:

```bash
forge script script/UpgradeNexora.s.sol:UpgradePolicyRegistry \
  --rpc-url $ARC_RPC_URL \
  --chain-id $ARC_CHAIN_ID \
  --account deploytestKey \
  --sender $OWNER_ADDRESS \
  --broadcast \
  -vvv
```

Available upgrade entrypoints:

- `UpgradePolicyRegistry`
- `UpgradeOperatorReputation`
- `UpgradeX402Ledger`
- `UpgradeYieldRouter`
- `UpgradeSaveEarnVault`
- `UpgradeNexoraEscrow`

## Example Product Flows

### Save an Agent Policy

1. Connect wallet.
2. Create or select an agent wallet.
3. Set daily limit and transaction cap.
4. Optionally choose contract and recipient allowlists.
5. Save policy onchain.

### Publish a Paid API

1. Open Marketplace publish flow.
2. Choose a service template such as Website Analyzer or GitHub Repo Analyzer.
3. Set endpoint manifest and USDC price.
4. Publish onchain through the x402 ledger.

### Use x402 Facilitator

1. Your API returns x402 payment requirements.
2. User or agent signs a USDC authorization.
3. Your API calls `POST /x402/verify`.
4. Your API calls `POST /x402/settle`.
5. Nexora settles the payment on Arc and records it.

### Index Onchain Analytics

The backend can index Arc contract events into the app store so revenue, policy, escrow, Save/Earn, and marketplace analytics are backed by chain events instead of only local app records.

```bash
curl -X POST https://your-backend.example/api/indexer/arc/sync \
  -H "x-indexer-secret: $NEXORA_INDEXER_SECRET"

curl https://your-backend.example/api/indexer/arc/status
```

Set `ARC_INDEXER_FROM_BLOCK` to the earliest Nexora deployment block for the current Arc proxy deployment. Keep `ARC_INDEXER_MAX_BLOCKS` modest on serverless deployments so each sync scans a bounded block range. Run the sync endpoint from a cron job until cursors reach the current safe block.

### Escrow

1. Creator creates a work agreement.
2. Creator funds escrow.
3. Counterparty submits work.
4. Creator verifies and releases USDC.

## Security Notes

- Contracts are upgradeable; production deployments should use multisig/timelock admin controls.
- The facilitator private key must be backend-only and dedicated to settlement.
- Serverless deployments should use durable storage through `DATABASE_URL`; `/tmp` storage is not persistent.
- External vault, DEX, and strategy integrations should be reviewed separately before mainnet usage.
- Nexora is currently testnet software.

## Status

Nexora is actively in development. Arc is the primary deployment. Arbitrum Sepolia and Base Sepolia are used for multi-chain test coverage. Swap and Save/Earn are Arc-only until more non-Arc integrations are completed.
