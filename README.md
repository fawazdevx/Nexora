# Nexora

Nexora is an Arc-first financial control layer for autonomous agents and USDC applications. It combines Circle developer-controlled wallets, onchain spending policies, approval queues, x402 settlement, Gateway liquidity, receipts, notifications, reputation, escrow, and automated Save/Earn routing.

Arc is the primary network. USDC-denominated gas and fast settlement make it the natural home for autonomous money flows. Base Sepolia and Arbitrum Sepolia extend the same agent and Marketplace experience for cross-chain testing. BOT Chain Testnet uses a separate, explicit Meridian/Permit2 route because Circle Agent Wallets are not supported there.

> Nexora is an early, unaudited testnet product. Do not treat it as a custody system or production payment processor without independent security review, operational controls, and application-specific accounting.

## What works

- Circle developer-controlled agent wallets on Arc Testnet, Base Sepolia, and Arbitrum Sepolia
- backfill of missing Base and Arbitrum wallets for compatible legacy Arc agents
- direct agent funding and persistent per-agent network selection
- daily, weekly, monthly, per-transaction, cooldown, expiry, service, recipient, and contract policies
- policy simulation, approval queues, risk alerts, and automation recipes
- an open paid-API Marketplace with USDC routes on Arc, Base, and Arbitrum
- six Nexora-operated services with one logical listing and chain-specific settlement routes
- verified third-party publication: the backend checks the publisher, ledger, service ID, endpoint, price, active state, and transaction receipt before listing a route
- x402 v1 and v2 verification and settlement through `@nexorafi/x402` v0.3
- Circle Marketplace controls for external Circle x402 services
- Circle Gateway aggregate and per-domain balances and cross-chain USDC transfer preparation
- BOT Chain Testnet payments through Meridian/Permit2 with connected-EOA policies
- public receipts, notifications, memory, reputation, revenue reporting, and replay protection
- Save/Earn automation that reviews eligible vaults every 24 hours and reallocates only when a better permitted route is available
- USDC escrow and Arc-native swap integrations

## Network model

| Network | Chain ID | Agent wallet | Marketplace asset | Settlement |
| --- | ---: | --- | --- | --- |
| Arc Testnet | 5042002 | Circle developer-controlled | USDC | Nexora x402 contracts |
| Base Sepolia | 84532 | Circle developer-controlled | USDC | Nexora x402 contracts |
| Arbitrum Sepolia | 421614 | Circle developer-controlled | USDC | Nexora x402 contracts |
| BOT Chain Testnet | 968 | Connected EOA | USDT | Meridian Permit2, guarded by Nexora policy |

BOT is not a Circle-agent network and is not a fourth Nexora Marketplace route. It appears in the shared x402 Playground and Policies surface. BOT users sign from their own EOA; Nexora checks policy before relay and records spend, reputation, receipt, and notification after Meridian reports successful settlement.

## Product boundaries

### Nexora Marketplace

`/marketplace` is the open publisher marketplace.

- Nexora's six canonical services settle through Nexora's facilitator and contracts.
- Each service can be paid in USDC on Arc Testnet, Base Sepolia, or Arbitrum Sepolia when its route is published on that chain.
- `NEXORA_MARKETPLACE_PUBLISHER_ADDRESS` identifies Nexora's canonical publisher. It does not prevent other wallets from publishing.
- Different publishers may publish the same endpoint identifier. Their listings and routes remain separate.
- BOT is deliberately excluded from this ledger-based Marketplace.

The canonical services are:

1. Website Growth Analyzer
2. GitHub Repo Analyzer
3. X Account Analyzer
4. Contract Safety Check
5. Landing Page Copy Reviewer
6. Grant Application Reviewer

### Circle Marketplace

`/circle-marketplace` is not a second catalog for Nexora's six services. It discovers third-party Circle x402 services and adds the controls those services do not provide themselves:

- agent selection and chain-route validation
- Nexora policy checks and risk flags
- human approval or rejection
- managed execution from the selected Circle developer-controlled wallet
- external Agent Stack authorization through the SDK
- receipts, notifications, memory, and automation after verified settlement

Public discovery does not depend on a shared Circle CLI login in Vercel. Production managed execution uses the selected Circle wallet ID and Circle's `signTypedData` API. An external Agent Stack client may create an intent, wait for approval, pay with its own wallet, and submit the payment response. Nexora requires a transaction hash and verifies the approved USDC transfer onchain before creating a settled receipt.

A service marked `Mainnet service` advertises only mainnet payment routes. `No compatible wallet route` means the selected Nexora agent does not have a wallet on any network accepted by that service. Discovery and intent creation remain available even when managed execution credentials are not configured.

### BOT Chain and Meridian

BOT Chain Testnet uses:

```text
network      bot-chain-testnet
chain ID     968
USDT         0x75edC9335175Fc0552D51D48439F229c10420fe3
facilitator  0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A
```

The shared `/x402/playground` flow:

1. switches the connected wallet to BOT Chain Testnet;
2. checks the USDT allowance to Permit2;
3. requests a one-time approval when needed;
4. signs a Permit2 witness bound to Meridian's facilitator;
5. asks the backend to check the connected EOA's Nexora policy;
6. relays the authorization to Meridian;
7. records policy spend and reputation through the authorized Nexora relayer;
8. stores a receipt and notification.

The enforcement boundary is explicit: a direct call to Meridian bypasses Nexora's policy, receipt, and accounting layer. If post-settlement policy accounting is temporarily unavailable, Nexora records the payment as accounting-pending and blocks another guarded payment from that EOA until reconciliation.

BOT requires only `NexoraPolicyRegistry` and `OperatorReputation`. It does not require `X402FacilitatorLedger`.

## Agent flow

1. Connect an operator wallet.
2. Create an agent. Nexora requests a Circle wallet for each enabled agent chain.
3. For a compatible legacy Arc agent, use the backfill action to derive only the missing Base and Arbitrum wallets.
4. Select the chain and fund that chain's agent wallet.
5. Save the policy on each chain where onchain enforcement is required.
6. Choose a service and settlement network.
7. Nexora evaluates policy and creates an approval when required.
8. The matching chain wallet settles the request.
9. Nexora executes the service and records the receipt, memory, notification, and reputation signal.

Backfill never replaces an existing Arc wallet or moves its funds. A legacy record must contain a Circle wallet ID that Circle can use as the derivation source. If it does not, creating a new agent is the safe fallback.

## Gateway unified USDC

Circle Gateway provides one spendable USDC balance across supported domains. Nexora displays:

- aggregate Gateway balance;
- balance by Arc, Base, and Arbitrum source domain;
- pending deposits;
- transfer fees and destination details.

A deposit is credited to Gateway only after the Gateway Wallet deposit flow succeeds. A plain ERC-20 transfer to an arbitrary address is not a Gateway deposit. Cross-chain transfers use a bytes32 recipient derived from the destination EVM address; the UI never exposes raw ABI errors such as bytes20/bytes32 mismatches.

Gateway is a liquidity and transfer layer, not an application's internal ledger. Games, marketplaces, and other apps must still reconcile each deposit, purchase, payout, refund, and withdrawal exactly once.

## Save / Earn

Save/Earn handles idle USDC under explicit user and policy controls:

1. the optimizer ranks eligible vault routes;
2. funds move only into an allowed route;
3. Nexora reviews the route after 24 hours;
4. funds remain when the current route is still best;
5. reallocation occurs only when a better permitted route is available.

Vault ranking is a decision signal, not a guarantee of yield or safety. Strategy contracts, withdrawal behavior, fees, and risk assumptions must be reviewed independently.

## Nexora as application payment infrastructure

Nexora's payment and control primitives are reusable across every integrated chain and are not limited to games or AI agents. Suitable application categories include:

- games, tournament entries, prize pools, and creator economies;
- SaaS usage, metered APIs, and subscriptions;
- AI agents, autonomous workflows, and agent-to-agent services;
- marketplaces, platform fees, and seller payouts;
- freelance work, milestones, and escrow;
- commerce, checkout, invoices, and payment links;
- creator subscriptions and digital goods;
- treasury controls, approvals, and automated allocation.

Today, applications can reuse x402 payment requirements, Circle wallet execution, policy checks, approvals, fee-aware settlement contracts, receipts, notifications, and Gateway routing. The application still owns its product ledger, user authentication, entitlement delivery, refunds, disputes, tax handling, and custody rules.

Nexora should be described as a programmable onchain payment and control layer—not as a complete Stripe replacement. Deposits, pooled balances, arbitrary payouts, and platform fees require an application-specific integration and audited custody/accounting design. See [application payment architecture](docs/application-payments.md) and the [game integration example](docs/game-payments.md).

## Repository

```text
backend/     TypeScript API, Circle wallets, Gateway, policies, Marketplace, x402, indexer
frontend/    React/Vite operator console and payment surfaces
contracts/   Foundry contracts, tests, deploy and upgrade scripts
sdk/x402/    @nexorafi/x402 v0.3 middleware, clients, types, and tests
docs/        Integration and architecture notes
```

## Local development

Install dependencies in each package:

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../sdk/x402 && npm install
cd ../../contracts && forge install
```

Run the backend on port 4000:

```bash
cd backend
PORT=4000 npm run dev
```

Run the frontend on port 5173:

```bash
cd frontend
npm run dev -- --port 5173
```

Open `http://localhost:5173`. The frontend should use:

```env
VITE_NEXORA_API_URL=http://localhost:4000
```

## Essential environment configuration

Use proxy addresses in runtime configuration. Keep private keys, Circle credentials, and Meridian credentials server-side.

### Circle and application server

```env
PORT=4000
DATABASE_URL=
CORS_ALLOWED_ORIGINS=http://localhost:5173

CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=
CIRCLE_AGENT_WALLET_ACCOUNT_TYPE=EOA
NEXORA_CIRCLE_AGENT_MARKETPLACE_ENABLED=true
NEXORA_CIRCLE_DEFAULT_CHAIN=BASE_SEPOLIA
NEXORA_CIRCLE_PAYMENT_REQUIRE_CONFIRMATION=true
NEXORA_CIRCLE_PAYMENT_MAX_USDC=5

NEXORA_MARKETPLACE_PUBLISHER_ADDRESS=
TREASURY_ADDRESS=
NEXORA_FEE_BPS=250
FACILITATOR_PRIVATE_KEY=
```

### Arc, Base, and Arbitrum

```env
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
POLICY_REGISTRY_ADDRESS=
X402_LEDGER_ADDRESS=
REPUTATION_ADDRESS=
ARC_X402_SETTLEMENT_ADDRESS=

BASE_SEPOLIA_RPC_URL=https://base-sepolia-rpc.publicnode.com
BASE_SEPOLIA_CHAIN_ID=84532
BASE_SEPOLIA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS=
BASE_SEPOLIA_X402_LEDGER_ADDRESS=
BASE_SEPOLIA_REPUTATION_ADDRESS=
BASE_SEPOLIA_X402_SETTLEMENT_ADDRESS=

ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
ARB_SEPOLIA_CHAIN_ID=421614
ARB_SEPOLIA_USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS=
ARB_SEPOLIA_X402_LEDGER_ADDRESS=
ARB_SEPOLIA_REPUTATION_ADDRESS=
ARB_SEPOLIA_X402_SETTLEMENT_ADDRESS=
```

### BOT Chain Testnet

```env
BOTCHAIN_TESTNET_RPC_URL=https://rpc.bohr.life
BOTCHAIN_TESTNET_CHAIN_ID=968
BOTCHAIN_TESTNET_USDT_ADDRESS=0x75edC9335175Fc0552D51D48439F229c10420fe3
BOTCHAIN_TESTNET_POLICY_REGISTRY_ADDRESS=
BOTCHAIN_TESTNET_REPUTATION_ADDRESS=

MERIDIAN_PUBLIC_KEY=
MERIDIAN_API_BASE=https://api.mrdn.finance/v1
MERIDIAN_SELLER_ADDRESS=
MERIDIAN_TESTNET_FACILITATOR_ADDRESS=0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A
BOTCHAIN_POLICY_RELAYER_PRIVATE_KEY=
```

The frontend needs the matching public values:

```env
VITE_ENABLE_BOTCHAIN_TESTNET=true
VITE_BOTCHAIN_TESTNET_CHAIN_ID=968
VITE_BOTCHAIN_TESTNET_RPC_URL=https://rpc.bohr.life
VITE_BOTCHAIN_TESTNET_USDT_ADDRESS=0x75edC9335175Fc0552D51D48439F229c10420fe3
VITE_BOTCHAIN_TESTNET_POLICY_REGISTRY_ADDRESS=
VITE_BOTCHAIN_TESTNET_REPUTATION_ADDRESS=
VITE_MERIDIAN_TESTNET_FACILITATOR_ADDRESS=0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A
```

## BOT policy deployment

The BOT deployment script creates only policy and reputation proxies. `BOTCHAIN_POLICY_RELAYER_ADDRESS` is required so the deployment always authorizes the backend relayer for confirmed spend and reputation updates.

```bash
cd contracts

forge script script/DeployNexoraBotCommerce.s.sol:DeployNexoraBotCommerce \
  --rpc-url $BOTCHAIN_TESTNET_RPC_URL \
  --chain-id 968 \
  --account deploytestKey \
  --sender $OWNER_ADDRESS \
  --broadcast \
  --legacy \
  -vvv
```

The address supplied as `BOTCHAIN_POLICY_RELAYER_ADDRESS` must be derived from the backend's `BOTCHAIN_POLICY_RELAYER_PRIVATE_KEY`. If it was not supplied during deployment, authorize it manually as owner:

```text
policyRegistry.setFacilitator(relayer, true)
reputation.setUpdater(relayer, true)
```

Nexora never deploys or broadcasts contracts automatically.

## SDK v0.3

Install or upgrade:

```bash
npm install @nexorafi/x402@0.3
```

If v0.2 is already published, update `sdk/x402/package.json` to the final unused `0.3.x` version, run the checks below, authenticate with npm, and publish from `sdk/x402`:

```bash
npm run typecheck
npm test
npm publish --access public
```

v0.3 adds:

- x402 v1 and v2 headers and CAIP-2 networks;
- Arc, Base, and Arbitrum USDC routes;
- safe BOT Meridian requirement and Permit2 typed-data builders;
- collision-free facilitator endpoints;
- settlement/replay response types;
- Circle Agent Stack intent, approval, authorization, and external-receipt helpers.

See the [SDK guide](sdk/x402/README.md) for Express, Next.js, BOT, and Circle examples.

## Security and verification

Nexora fails closed on unsupported chains, assets, recipients, wallet routes, expired authorizations, mismatched amounts, reverted receipts, policy violations, and replayed payment identifiers.

The test suite covers:

- EIP-3009 signature and nonce replay behavior;
- bytes32 destination normalization for Gateway;
- chain-native USDC settlement and fee accounting;
- Marketplace publisher/receipt verification and publisher isolation;
- Circle intent approval, managed wallet routing, and external receipt validation;
- BOT policy blocking before Meridian relay;
- BOT nonce replay and post-settlement accounting locks;
- policy race and money-path adversarial cases;
- proxy and contract behavior in Foundry.

Run all local checks:

```bash
cd backend && npm run typecheck && npm test
cd ../frontend && npm run typecheck && npm run build
cd ../sdk/x402 && npm run typecheck && npm test
cd ../../contracts && forge test -vvv
```

No npm publication, contract deployment, Vercel update, or live payment is performed by these commands.

## License

See the repository license files for package-specific terms.
