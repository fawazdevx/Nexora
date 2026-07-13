# Nexora

**The financial control layer for AI agents.**

Nexora is an Arc-first, USDC-native application for controlled agent commerce. It combines agent wallets, spending policies, x402 payment facilitation, paid API publishing, escrow, swap routing, Save/Earn routing, public receipts, risk alerts, and revenue analytics in one stack.

Arc is the primary deployment because USDC is native gas on Arc. That makes agent payments, stablecoin settlement, and x402 testing simpler: users do not need a separate gas token for Arc transactions.

> Network status: Swap and Save/Earn currently work only on Arc. Arbitrum Sepolia and Base Sepolia are secondary test deployments for policy, x402, escrow, and contract-interaction coverage.

## Product Surface

- **Agent wallets:** create and manage Circle agent wallets for USDC activity.
- **Policy engine:** daily limits, transaction caps, contract allowlists, recipient allowlists, service allowlists, cooldowns, policy expiry, weekly/monthly limits, and on-chain enforcement requirements.
- **Policy simulation:** test an agent payment before it happens.
- **Agent approval queue:** stage risky or manual agent payments for operator approval.
- **Risk alerts:** detect missing allowlists, policy expiry, limit usage, repeated blocked payments, and approval-window issues.
- **x402 facilitator:** expose `/x402/supported`, `/x402/verify`, and `/x402/settle` for external paid APIs.
- **Developer SDK:** publish paid endpoints with `@nexorafi/x402`.
- **Marketplace:** sell and buy per-request APIs priced in USDC.
- **Escrow:** fund, submit, verify, and release USDC work agreements.
- **Public receipts:** share safe payment, escrow, plan, and indexed on-chain receipt links.
- **Save/Earn:** deposit USDC into Nexora Save/Earn routes on Arc.
- **Swap:** compare Arc stablecoin routes and execute supported swaps.
- **Revenue analytics:** separate treasury fees from marketplace volume, plan revenue, facilitator volume, Save/Earn activity, and escrow fees.
- **On-chain indexer:** sync Arc contract events into analytics.

## Repository Layout

```text
contracts/   Foundry contracts, tests, deployment scripts, upgrade scripts
backend/     Node/TypeScript API, x402 facilitator, Circle wallet integration, marketplace execution
frontend/    Vite/React app, RainbowKit wallet connect, operator console, marketplace UI
sdk/x402/    Published x402 SDK and middleware package
```

## Marketplace Services

Nexora includes built-in x402 service templates so the marketplace has practical services available before external publishers join.

Current service categories:

- Website Growth Analyzer
- GitHub Repo Analyzer
- X Account Analyzer
- Contract Safety Check
- Wallet Activity Summary
- Landing Page Copy Reviewer
- Grant Application Reviewer
- Meeting Brief Agent
- Arc Builder Research
- Domain Name Research
- Social Content Audit
- Stablecoin Route Report
- Agent Policy Risk Review
- Launch Readiness Check
- x402 Integration Planner

Services can be published on-chain through the x402 ledger when a chain service id is available. Built-in off-chain services can also be tested through the marketplace flow for demos and development.

## Smart Contracts

Core contracts:

- `NexoraPolicyRegistry`: agent registration, spending policies, allowlists, facilitator checks.
- `X402FacilitatorLedger`: paid service publishing and USDC request settlement.
- `OperatorReputation`: reputation signal storage.
- `NexoraYieldRouter`: routes Save/Earn deposits to active strategies.
- `NexoraSaveEarnVault`: user-facing USDC Save/Earn vault.
- `NexoraEscrow`: USDC work agreement escrow.
- `NexoraProxy` / `NexoraUpgradeable`: upgradeable proxy pattern.

Use proxy addresses in frontend/backend runtime env. Keep implementation addresses only for deployment records and verification.

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
- recipient and max amount
- authorization validity window
- EIP-712 `TransferWithAuthorization` signature
- nonce/request replay protection

Settlement uses USDC `transferWithAuthorization(...)` on Arc.

## Developer SDK

The SDK package is published as:

```bash
npm install @nexorafi/x402
```

Example Express integration:

```ts
import {nexoraX402} from "@nexorafi/x402";

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl: "https://nexorafibackend.vercel.app",
    payTo: "0xPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    resource: "paid-report",
    description: "Paid report"
  }),
  (_req, res) => {
    res.json({report: "paid result"});
  }
);
```

The SDK includes:

- `NexoraX402Client`
- `nexoraX402(...)` Express-style middleware
- `withNexoraX402(...)` Next.js route helper
- payment requirement builders

See [`sdk/x402/README.md`](sdk/x402/README.md) for full SDK examples.

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

Run checks:

```bash
cd backend
npm run typecheck
npm run build

cd ../frontend
npm run typecheck
npm run build

cd ../contracts
forge test -vvv
```

## Environment

### Backend

```env
PORT=4000
DATABASE_URL=
PGSSL_REJECT_UNAUTHORIZED=true

ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_EXPLORER_URL=https://testnet.arcscan.app

ARC_STRESS_ENABLED=false
ARC_STRESS_DRY_RUN=true
ARC_STRESS_PRIVATE_KEY=
ARC_STRESS_TARGET_TPS=2
ARC_STRESS_MAX_CONCURRENCY=10
ARC_STRESS_DURATION_SECONDS=300
ARC_STRESS_MAX_TX=1000
ARC_STRESS_TRANSFER_USDC=0.000001

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
NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED=false
NEXORA_CIRCLE_CLI_PATH=circle
NEXORA_CIRCLE_DEFAULT_CHAIN=BASE
NEXORA_CIRCLE_PAYMENT_REQUIRE_CONFIRMATION=true
NEXORA_CIRCLE_PAYMENT_MAX_USDC=5

NEXORA_AUTH_SECRET=
NEXORA_REQUIRE_SIGNED_AUTH=true
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
GITHUB_TOKEN=

NEXORA_MARKETPLACE_PUBLISHER_ADDRESS=

NEXORA_APPROVAL_HISTORY_START_BLOCK=0
NEXORA_APPROVAL_LOG_CHUNK_BLOCKS=100000
NEXORA_WALLET_RISK_MAINNETS=false
```

Use a dedicated facilitator wallet for `FACILITATOR_PRIVATE_KEY`. Do not use an owner/deployer wallet, and never expose this key to frontend code.

Arc stress testing is disabled and dry-run by default. Keep `ARC_STRESS_DRY_RUN=true` for backend/dashboard load tests that do not write to chain. For live Arc Testnet sends only, fund a dedicated test wallet from the Circle faucet, set `ARC_STRESS_PRIVATE_KEY`, then set `ARC_STRESS_ENABLED=true` and `ARC_STRESS_DRY_RUN=false`. Live stress sends are restricted in code to Arc Testnet chain id `5042002`.

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

Wallet approval scans default to full historical RPC log coverage from block `0`. For faster production scans, set `NEXORA_APPROVAL_HISTORY_START_BLOCK` or a chain-specific override such as `ARC_APPROVAL_HISTORY_START_BLOCK`, `BASE_SEPOLIA_APPROVAL_HISTORY_START_BLOCK`, `ARB_SEPOLIA_APPROVAL_HISTORY_START_BLOCK`, `BASE_MAINNET_APPROVAL_HISTORY_START_BLOCK`, or `ARB_ONE_APPROVAL_HISTORY_START_BLOCK` to the USDC deployment block you trust for that chain. Use `NEXORA_APPROVAL_LOG_CHUNK_BLOCKS` or `<CHAIN>_APPROVAL_LOG_CHUNK_BLOCKS` if your RPC provider requires smaller log ranges.

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
VITE_MAINTENANCE_MODE=false
NEXT_PUBLIC_MAINTENANCE_MODE=false
```

## Contract Deployment

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

Upgrade scripts keep proxy addresses stable:

```bash
forge script script/UpgradeNexora.s.sol:UpgradeX402Ledger \
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

## Common Flows

### Save An Agent Policy

1. Connect wallet.
2. Create or select an agent wallet.
3. Set daily limit, transaction cap, and optional V2 controls.
4. Add contract, recipient, and service allowlists where needed.
5. Simulate a payment before saving.
6. Save policy on-chain.

### Publish A Paid API

1. Open Marketplace publish flow.
2. Choose a service template or define a custom manifest.
3. Set endpoint hash and per-request USDC price.
4. Publish through the x402 ledger if on-chain publishing is configured.
5. Integrate the route with `@nexorafi/x402`.

### Use The x402 Facilitator

1. API returns x402 payment requirements.
2. User or agent signs a USDC authorization.
3. API calls `POST /x402/verify`.
4. API calls `POST /x402/settle`.
5. Nexora settles the payment on Arc and records a receipt.

### Share A Public Receipt

Receipt pages use:

```text
/receipts/<receipt-id>
```

Receipts expose safe payment metadata only: amount, fee, net, parties, status, timestamps, transaction hash, and explorer URL. They do not expose private escrow deliverables or paid API execution output.

### Index On-chain Analytics

```bash
curl -X POST https://your-backend.example/api/indexer/arc/sync \
  -H "x-indexer-secret: $NEXORA_INDEXER_SECRET"

curl https://your-backend.example/api/indexer/arc/status
```

Set `ARC_INDEXER_FROM_BLOCK` to the earliest block for the current Arc proxy deployment. Keep `ARC_INDEXER_MAX_BLOCKS` modest on serverless deployments and call the sync endpoint from a cron job until cursors reach the current safe block.

## Revenue Model

Implemented revenue surfaces:

- x402 marketplace platform fees
- escrow release fees
- Save/Earn withdrawal fees, when indexed from contract events
- developer analytics monthly plan
- premium agent automation monthly plan
- other paid plan revenue
- verified builder one-time plan

Volume and revenue are intentionally separated in the dashboards. Gross marketplace volume and booked plan volume are not counted as treasury revenue unless the fee or payment is actually collected.

## Security Notes

- Contracts are upgradeable; production deployments should use multisig/timelock admin controls.
- Use proxy addresses in app env.
- Keep facilitator keys backend-only.
- Set `NEXORA_REQUIRE_SIGNED_AUTH=true` outside local development.
- Use durable storage through `DATABASE_URL`; serverless `/tmp` storage is not persistent.
- Restrict CORS with `CORS_ALLOWED_ORIGINS` in production.
- Review external vault, DEX, route, and strategy integrations separately before mainnet usage.
- Nexora is currently testnet software.

## Status

Nexora is actively in development. Arc is the primary deployment. Arbitrum Sepolia and Base Sepolia are used for multi-chain test coverage. Swap and Save/Earn are Arc-only until more non-Arc integrations are completed.
