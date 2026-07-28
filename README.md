# Nexora

Nexora is an Arc-first financial control layer for autonomous agents and USDC applications. It combines Circle developer-controlled wallets, onchain spending policies, approval queues, x402 settlement, Gateway liquidity, receipts, notifications, reputation, escrow, and automated Save/Earn routing.

Arc is the primary network. USDC-denominated gas and fast settlement make it the natural home for autonomous money flows. Base Sepolia and Arbitrum Sepolia extend the same agent and Marketplace experience for cross-chain testing. BOT Chain Testnet uses a separate, explicit Meridian/Permit2 route because Circle Agent Wallets are not supported there.

Nexora gives autonomous agents a Circle developer-controlled wallet and enforces spending rules before USDC leaves it. Agents can buy x402 APIs on Arc, route idle USDC into approved strategies, and leave receipts that an operator can audit.

> The current build is an unaudited testnet product. It is not ready to hold production funds or process mainnet payments.

## The problem

An autonomous wallet can sign transactions, but an operator still needs transaction limits, approval rules, replay protection, receipts, and liquidity controls. Teams often rebuild these controls for each agent and paid service.

Nexora puts those controls in one payment layer. The operator defines policy, the agent requests a payment, and Nexora checks the request before the selected Circle wallet settles it.

## Arc and Circle

Arc is Nexora's primary network. USDC-denominated gas keeps costs predictable, while fast finality suits agent payments and paid API calls.

| Component | Role in Nexora |
| --- | --- |
| Arc | Primary chain for policy-controlled USDC payments and the hackathon demo |
| Circle Developer-Controlled Wallets | Create and operate wallets for autonomous agents |
| USDC | Payment asset and Arc gas token |
| Circle Gateway | Show unified USDC liquidity and prepare cross-chain transfers |
| x402 | Price API requests and bind payment authorization to each request |
| Circle Agent Stack patterns | Support approval, managed execution, and external payment verification |

## End-to-end demo

1. An operator connects a wallet and creates an agent.
2. Nexora creates the agent's Circle developer-controlled wallet on Arc.
3. The operator funds the agent with testnet USDC and defines spending policy.
4. The agent selects a paid API from the Marketplace.
5. Nexora checks the amount, recipient, service, cooldown, expiry, and approval rules.
6. The Circle wallet settles the approved x402 request in USDC.
7. Nexora records the receipt, notification, memory event, and reputation result.

## Current build

- Circle-backed agent wallets on Arc Testnet, Base Sepolia, and Arbitrum Sepolia
- transaction, period, recipient, service, contract, cooldown, and expiry policies
- human approval queues, policy simulation, and risk alerts
- six code-defined paid API services with standard Circle Gateway x402 seller endpoints
- x402 v1 and v2 authorization, verification, settlement, and replay protection
- Circle Gateway balance views and cross-chain transfer preparation
- Save/Earn automation for approved Arc vault routes
- public receipts, notifications, reputation, revenue reporting, and escrow

The Arc testnet path provides the primary ledger-settlement demo. Circle Gateway Nanopayments expose the same six services on Arc Testnet, Base Sepolia, and Arbitrum Sepolia without requiring a separate Marketplace contract publication on each network.

## System overview

```text
Operator policy
      |
      v
Nexora policy and approval engine
      |
      v
Circle developer-controlled wallet
      |
      v
Arc x402 USDC settlement ---> Paid API
      |
      v
Receipt, notification, memory, and reputation
```

Nexora binds each authorization to the network, token, amount, recipient, request, and nonce. The backend verifies the resulting transaction before it marks a payment as settled.

## Marketplace

The open Marketplace supports independent publishers. Nexora verifies the publisher, ledger route, service identifier, endpoint, price, active state, and publication receipt before it displays a service.

Nexora's own service catalog is defined in source code and exposed through standard x402 seller endpoints. An unpaid request returns HTTP `402` with Circle Gateway payment requirements. A compatible client signs the authorization and retries with `payment-signature`; the paid request returns the service result and `payment-response` receipt. The public catalog is available at `/api/marketplace/catalog`, `/api/circle/nanopayments/catalog`, and `/.well-known/x402`. Add `?version=1` to the well-known route for legacy verified-ledger discovery.

Nexora provides six reference services:

1. Website Growth Analyzer
2. GitHub Repo Analyzer
3. X Account Analyzer
4. Contract Safety Check
5. Landing Page Copy Reviewer
6. Grant Application Reviewer

The Marketplace uses Circle Gateway for Nexora-owned x402 endpoints and keeps verified Marketplace ledgers as optional routes for policy, reputation, receipts, and independent publishers. The Circle Marketplace view adds Nexora policy checks and approval controls to compatible third-party x402 services. An agent can use a managed Circle wallet or submit a verifiable payment from an external Agent Stack client.

## Gateway and Save/Earn

Circle Gateway gives the operator an aggregate USDC view across supported domains and settles Nexora's x402 Nanopayment endpoints. Nexora displays the total balance, source-domain balances, pending deposits, fees, and destination details.

Save/Earn ranks approved Arc vault routes for idle USDC. The automation reviews a position after 24 hours and reallocates funds only when policy permits a better route. Vault ranking does not guarantee yield or safety.

## Meridian interoperability experiment

The shared x402 Playground also tests USDT payments on BOT Chain through Meridian and Permit2. This route sits outside the Arc and Circle agent-wallet path.

Meridian acts as the payment facilitator. It validates the signed Permit2 authorization, settles the USDT transfer, and returns the settlement result. Nexora checks policy before it sends the authorization and records the result after settlement. Meridian removes the need for Nexora to build a second payment facilitator on BOT Chain; Nexora still owns its policy, receipt, and reputation accounting.

## Network support

| Network | Wallet model | Asset | Status |
| --- | --- | --- | --- |
| Arc Testnet | Circle developer-controlled wallet | USDC | Primary end-to-end demo |
| Base Sepolia | Circle developer-controlled wallet | USDC | Gateway x402 seller and agent-wallet payment route |
| Arbitrum Sepolia | Circle developer-controlled wallet | USDC | Gateway x402 seller and agent-wallet payment route |
| BOT Chain Testnet | Connected EOA with Meridian Permit2 | USDT | Optional interoperability experiment |

## SDK

The `@nexorafi/x402` v0.3 SDK is live on npm.

```bash
npm install @nexorafi/x402@0.3
```

It provides:

- x402 v1 and v2 headers and CAIP-2 network identifiers
- Arc, Base, and Arbitrum USDC route types
- payment requirement, authorization, settlement, and replay types
- Circle intent, approval, external receipt, and BOT Permit2 helpers

Developers building on supported or integrated chains can use the SDK to add paid game actions, API calls, marketplace purchases, and other metered resources. Applications manage their own authentication, player balances, entitlements, refunds, payouts, and internal ledger.

See the [SDK guide](sdk/x402/README.md) for integration examples.

## Repository

```text
backend/     TypeScript API, Circle wallets, policies, Marketplace, Gateway, and indexer
frontend/    React and Vite operator console
contracts/   Foundry contracts, tests, and deployment scripts
sdk/x402/    x402 middleware, clients, types, and tests
docs/        Application integration and architecture notes
```

## Run locally

Install each package:

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../sdk/x402 && npm install
cd ../../contracts && forge install
```

Start the backend:

```bash
cd backend
PORT=4000 npm run dev
```

Start the frontend in a second terminal:

```bash
cd frontend
VITE_NEXORA_API_URL=http://localhost:4000 npm run dev -- --port 5173
```

Open `http://localhost:5173`. Circle-backed wallet operations require server credentials from a Circle developer account. Store credentials in untracked server environment files and keep them out of the browser bundle.

The Gateway seller defaults to testnet. It requires a public seller wallet address through `NEXORA_MARKETPLACE_PUBLISHER_ADDRESS`. Set `NEXORA_PUBLIC_API_URL` to the trusted public backend origin when managed agent wallets buy Nexora services. `NEXORA_CIRCLE_GATEWAY_SELLER_MODE=mainnet` does not activate mainnet by itself; `NEXORA_ENABLE_AGENT_MAINNETS=true` is also required. Keep Circle API credentials, entity secrets, database URLs, and wallet keys out of Git.

`.nexora-data/store.json` is an ignored local fallback for mutable development state. It is not the Marketplace catalog and must not be committed. Hosted deployments should use persistent storage through `DATABASE_URL`.

## Verification

Run the package and contract checks:

```bash
cd backend && npm run typecheck && npm test
cd ../frontend && npm run typecheck && npm run build
cd ../sdk/x402 && npm run typecheck && npm test
cd ../../contracts && forge test -vvv
```

The tests cover authorization replay, duplicate settlement, policy races, publisher isolation, receipt verification, Gateway address normalization, fee accounting, and proxy behavior.

## Application integrations

Teams can reuse Nexora's x402 requirements, Circle wallet execution, policies, approvals, receipts, and Gateway routing in games, SaaS products, marketplaces, and agent services. Each application remains responsible for authentication, entitlements, refunds, disputes, tax handling, and its internal ledger.

See the [application payment architecture](docs/application-payments.md) and [game integration example](docs/game-payments.md).

## Security

Nexora rejects unsupported chains, assets, recipients, wallet routes, expired authorizations, mismatched amounts, reverted receipts, policy violations, and replayed payment identifiers. Production use requires an independent contract audit, operational monitoring, and application-specific accounting controls.

## License

The `@nexorafi/x402` SDK is available under the MIT License. This repository does not declare a license for the remaining source code.
