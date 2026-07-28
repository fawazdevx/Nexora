# Circle Gateway x402 sellers

Nexora exposes its six reference services as standard HTTP x402 seller endpoints backed by Circle Gateway Nanopayments. The service definitions live in source code. Mutable payment records, agent state, ledger route indexes, and receipts live in the configured data store.

Deleting `.nexora-data/store.json` does not delete the public catalog. That file is an ignored local fallback and must not be committed.

## Public catalog

Use either catalog endpoint:

```text
GET /api/marketplace/catalog
GET /api/circle/nanopayments/catalog
GET /.well-known/x402
```

The combined Marketplace catalog includes:

- the six code-defined Gateway seller resources;
- environment and network readiness;
- the public seller address;
- optional verified Marketplace ledger routes.

The well-known endpoint defaults to the code-defined x402 v2 Gateway catalog. `/.well-known/x402?version=1` preserves legacy discovery for verified ledger routes.

The six service resources use this shape:

```text
POST /api/circle/nanopayments/services/:endpointHash
```

An unpaid request returns HTTP `402` and a base64-encoded `payment-required` header. After the buyer signs one accepted requirement, it retries the same request with `payment-signature`. A successful response returns HTTP `200`, the service output, and a `payment-response` header.

Example unpaid request:

```bash
curl -i \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"repo":"circlefin/x402"}' \
  https://your-api.example/api/circle/nanopayments/services/github-repo-analyzer-v1
```

## Testnet configuration

The default mode is testnet and accepts Arc Testnet, Base Sepolia, and Arbitrum Sepolia.

```dotenv
NEXORA_MARKETPLACE_PUBLISHER_ADDRESS=0xYourPublicSellerWallet
NEXORA_PUBLIC_API_URL=https://your-api.example
NEXORA_CIRCLE_GATEWAY_SELLER_ENABLED=true
NEXORA_CIRCLE_GATEWAY_SELLER_MODE=testnet
CIRCLE_GATEWAY_FACILITATOR_URL=https://gateway-api-testnet.circle.com
```

`NEXORA_CIRCLE_GATEWAY_SELLER_NETWORKS` may restrict the seller to a subset of the networks allowed by the selected mode. Use comma-separated CAIP-2 identifiers, for example:

```dotenv
NEXORA_CIRCLE_GATEWAY_SELLER_NETWORKS=eip155:5042002,eip155:84532,eip155:421614
```

The seller address and public API URL are public. Nexora uses the configured API origin for server-managed agent purchases so an untrusted request host cannot redirect a signed payment. Circle API keys, entity secrets, database credentials, relayer keys, and wallet private keys are private server settings.

## Mainnet lock

Mainnet remains disabled unless both controls are explicit:

```dotenv
NEXORA_CIRCLE_GATEWAY_SELLER_MODE=mainnet
NEXORA_ENABLE_AGENT_MAINNETS=true
```

In mainnet mode, the default seller networks are Base and Arbitrum One and the default facilitator is `https://gateway-api.circle.com`. Review the seller wallet, price, production data providers, monitoring, refund process, and legal requirements before enabling real-USDC payments.

## Ledger routes

Nexora's Marketplace ledgers remain useful for independent publisher listings, onchain service identifiers, reputation, policy integration, and ledger-native receipts. They are not required to make the six Nexora-owned Gateway endpoints discoverable or payable.

After publishing canonical ledger routes, a maintainer can verify and import the publication receipt without exposing a private key:

```bash
cd backend
npm run marketplace:reconcile -- --chain 5042002 --tx 0xPublicationTransactionHash
```

The command reads `NEXORA_MARKETPLACE_PUBLISHER_ADDRESS`, verifies the transaction and active onchain routes, and stores only public route data. It never accepts a private key and never sends a transaction.

## Verification

Seller integration tests cover:

- unpaid request returns HTTP `402`;
- testnet requirements include Arc Testnet, Base Sepolia, and Arbitrum Sepolia;
- paid retry returns HTTP `200` and `payment-response`;
- mainnet stays locked without both activation settings;
- a clean local store does not inject service listings.
