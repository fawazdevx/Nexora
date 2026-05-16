# Nexora

Nexora is a Web3 platform for AI agent commerce, programmable earning infrastructure, and autonomous USDC payments on the Arc ecosystem using Circle products.

The first contract layer is intentionally upgradeable. Each core module is deployed behind a `NexoraProxy` using an ERC1967 UUPS-style implementation, so future releases can upgrade logic while preserving proxy addresses and state.

## Apps

- `contracts/`: Foundry contracts and deployment scripts.
- `frontend/`: Vite React operator console with RainbowKit wallet connect.
- `backend/`: Node API/facilitator scaffold.

## Repository Layout

```text
contracts/
  src/
    NexoraPolicyRegistry.sol
    X402FacilitatorLedger.sol
    OperatorReputation.sol
    NexoraYieldRouter.sol
    NexoraSaveEarnVault.sol
  script/
    DeployNexoraUpgradeable.s.sol
  test/
frontend/
  App.tsx
  index.html
  vite.config.ts
backend/
docs/
  PLATFORM_BLUEPRINT.md
  UPGRADEABILITY.md
```

## Build

```shell
cd contracts
forge build
forge test
```

## Upgradeable Deployment Pattern

Deploy one implementation and one proxy per module:

```solidity
NexoraPolicyRegistry implementation = new NexoraPolicyRegistry();
NexoraProxy proxy = new NexoraProxy(
    address(implementation),
    abi.encodeCall(NexoraPolicyRegistry.initialize, (owner))
);
```

Integrations must use the proxy address. To upgrade:

```solidity
NexoraPolicyRegistry(proxy).upgradeTo(newImplementation);
```

See [docs/UPGRADEABILITY.md](docs/UPGRADEABILITY.md) for the upgrade flow and production safeguards.

## Arc Deployment

From `contracts/`:

```shell
cp .env.example .env

export ARC_CHAIN_ID=5042002
export ARC_RPC_URL=https://rpc.testnet.arc.network
export USDC_ADDRESS=0x3600000000000000000000000000000000000000
export TREASURY_ADDRESS=<your-treasury-address>
export OWNER_ADDRESS=<owner-address>
export AI_OPERATOR_ADDRESS=<agent-operator-address>
export NEXORA_FEE_BPS=250
export NEXORA_WITHDRAWAL_FEE_BPS=100

forge script script/DeployNexora.s.sol:DeployNexora \
  --rpc-url $ARC_RPC_URL \
  --chain-id $ARC_CHAIN_ID \
  --account deploytestKey \
  --sender $OWNER_ADDRESS \
  --broadcast \
  -vvv
```

Write the returned proxy addresses into `contracts/.env`:

```shell
POLICY_REGISTRY_PROXY_ADDRESS=
OPERATOR_REPUTATION_PROXY_ADDRESS=
X402_LEDGER_PROXY_ADDRESS=
YIELD_ROUTER_PROXY_ADDRESS=
SAVE_EARN_VAULT_PROXY_ADDRESS=
```

For later upgrades, keep integrations pointed at the same proxy address and run the matching upgrade script. Example:

```shell
source .env

forge script script/UpgradeNexora.s.sol:UpgradePolicyRegistry \
  --rpc-url $ARC_RPC_URL \
  --chain-id $ARC_CHAIN_ID \
  --account deploytestKey \
  --sender $OWNER_ADDRESS \
  --broadcast \
  -vvv
```

Arc docs currently list Arc Testnet as chain ID `5042002`, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`, and USDC ERC-20 interface `0x3600000000000000000000000000000000000000`.

## Frontend

From `frontend/`:

```shell
cp .env.example .env
npm install
npm run dev
```

The frontend uses `VITE_*` variables. After contract deployment, copy proxy addresses into `VITE_POLICY_REGISTRY_ADDRESS`, `VITE_X402_LEDGER_ADDRESS`, `VITE_REPUTATION_ADDRESS`, and `VITE_SAVE_EARN_VAULT_ADDRESS`.

## Local Full App

Run the backend and frontend together; the frontend calls `VITE_NEXORA_API_URL`.

```shell
cd backend
cp .env.example .env
npm install
npm run dev
```

```shell
cd frontend
cp .env.example .env
npm install
npm run dev -- --port 5173
```

The backend now loads `backend/.env`, persists app state to `NEXORA_STORE_PATH`, and exposes live endpoints for the operator snapshot, marketplace services, x402 authorizations/settlements, earn opportunities, monetization plans, Circle agent wallet requests, policy saves, payments, and reputation. On Vercel, set `VITE_NEXORA_API_URL` to the deployed backend URL; a static frontend deployment alone cannot create Circle wallets, persist marketplace data, or settle x402 requests.

Required production secrets:

```shell
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
FACILITATOR_PRIVATE_KEY=
```

Without those secrets, contract-backed frontend writes still work where the user wallet signs them, but Circle wallet creation and server-side facilitator signing report as not configured through `/api/readiness` instead of silently failing.

After deployment, add Xylonet/Synthra strategy adapters when their Arc testnet pool and receipt-token addresses are confirmed:

```solidity
ArcLendingUsdcStrategy xylonet = new ArcLendingUsdcStrategy(
  USDC_ADDRESS,
  XYLONET_RECEIPT_TOKEN,
  XYLONET_POOL,
  YIELD_ROUTER_PROXY,
  "Xylonet"
);

NexoraYieldRouter(YIELD_ROUTER_PROXY).addStrategy(address(xylonet), "Xylonet", 0);
```

## Product Blueprint

See [docs/PLATFORM_BLUEPRINT.md](docs/PLATFORM_BLUEPRINT.md) for the full architecture overview, frontend pages, backend structure, x402 facilitator flow, Circle integration flow, database schema, API routes, UX direction, MVP scope, monetization plan, roadmap, and Arc/Circle positioning.
