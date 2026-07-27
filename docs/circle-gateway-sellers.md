# Circle x402 integration boundary

This document records the current Circle integration boundary. Nexora does not expose its six canonical Marketplace services as duplicate Circle Gateway seller routes.

## Nexora Marketplace

Nexora's six services live in `/marketplace` and settle through Nexora's facilitator and chain-specific Marketplace contracts on Arc Testnet, Base Sepolia, and Arbitrum Sepolia.

## Circle Marketplace

`/circle-marketplace` discovers third-party Circle x402 services. Nexora adds:

- agent and network route validation;
- spending policies and risk checks;
- approval and rejection;
- managed Circle developer-wallet execution;
- external Agent Stack authorization;
- verified receipts, memory, notifications, and automation.

Production discovery does not depend on a shared Circle CLI login. Managed execution signs the x402 EIP-712 authorization through the selected Circle developer-controlled wallet. External Agent Stack completion requires a verifiable onchain USDC transfer before Nexora records settlement.

Circle Gateway remains Nexora's unified USDC balance and cross-chain transfer layer. It is not a second seller catalog for Nexora's canonical APIs.
