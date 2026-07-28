# Build on Arc: Checkpoint 2 submission

Use this document to prepare Nexora's Encode Club Checkpoint 2 submission.

## Core project details

**Project name:** Nexora

**Team leader:** Fawaz Oyebode

**Code:** https://github.com/fawazdevx/Nexora

**Presentation:** Upload the deck to Google Slides, Canva, or DocSend, enable public link access, then paste the URL into the submission form. Do not submit a local file path or a private link.

**Tracks:**

- Agentic Economy Track, primary
- DeFi Track, secondary

### Project description

Nexora is an Arc-first financial control and payment layer for autonomous agents and USDC applications. Agents use Circle developer-controlled wallets to hold and spend USDC under onchain policies, approval queues, transaction limits, x402 payment rules, and replay protection. Nexora records receipts, notifications, memory, and reputation after settlement. The platform also provides Gateway liquidity, an open paid-API marketplace, escrow, and Save/Earn automation that reviews approved Arc vault routes every 24 hours. Developers can embed the payment and control flow through `@nexorafi/x402`.

### Short description

Nexora gives autonomous agents Circle wallets and policy-controlled USDC payments on Arc. It combines approvals, x402 settlement, Gateway liquidity, receipts, reputation, replay protection, and automated Save/Earn routing in one developer platform.

### Project image

Upload [`frontend/public/nexora-banner.png`](../frontend/public/nexora-banner.png). The image is a 1536 by 1024 PNG at about 1.7 MB, so it meets the form's PNG and 10 MB requirements.

If you generate a replacement, use this prompt:

> Create a premium landscape cover for Nexora, an Arc-first financial control layer for autonomous AI agents. Show a central violet Nexora network connecting an agent wallet, USDC payment stream, policy shield, x402 service, Gateway bridge, and verifiable receipt. Use a dark navy background with violet, mint, and cyan light. Keep the layout clean and legible at thumbnail size. Include only the word “Nexora.” Do not use partner logos, fake interface screenshots, coins, watermarks, or small body text.

## Written progress update

Nexora now runs an end-to-end autonomous USDC payment flow on Arc Testnet. A user creates an agent backed by a Circle developer-controlled wallet, funds it with USDC, sets spending rules, and selects a paid service. Nexora evaluates the payment against transaction, daily, weekly, monthly, recipient, contract, cooldown, and expiry policies. The agent pays after approval, and Nexora stores the receipt, notification, memory, and reputation result.

The paid-API Marketplace contains six Nexora services and supports chain-specific USDC settlement routes on Arc Testnet, Base Sepolia, and Arbitrum Sepolia. Arc remains the primary network. The new Base and Arbitrum routes need their publisher transactions before every service becomes available on those chains. Third-party developers can publish their own APIs without sharing Nexora's publisher wallet.

Nexora also integrates Circle Gateway for unified USDC visibility and cross-chain transfers. Save/Earn lets users place idle USDC into approved Arc strategies, reviews available vault routes after 24 hours, and reallocates only when policy permits a better route. Escrow and application-payment primitives give games, SaaS products, marketplaces, creator platforms, and commerce apps building blocks for deposits, payments, fee-aware settlement, receipts, and approvals. Each integration must implement its own entitlements, payouts, refunds, disputes, custody model, and reconciliation.

The `@nexorafi/x402` v0.3 release candidate adds x402 v1 and v2 support, CAIP-2 network identifiers, Arc/Base/Arbitrum USDC routes, Circle Agent Stack intent helpers, and guarded external-payment types. Backend and Foundry tests cover nonce replay, duplicate settlement, policy races, publisher isolation, receipt verification, Gateway address normalization, and fee accounting. Nexora remains an early, unaudited testnet product.

Next, we will deploy the current application build, publish the remaining signed Marketplace routes, release SDK v0.3 to npm, expand live service integrations, and prepare the final three-minute Arc demo. We will also continue contract hardening, monitoring, and independent security review work before any production launch.

## Suggested answer for “Which track(s)?”

Select both tracks.

**Agentic Economy Track:** Circle-backed agents hold and spend USDC on Arc through policy decisions, approval queues, x402 service payments, automated actions, and verifiable settlement records.

**DeFi Track:** Save/Earn manages idle USDC through approved vault routes, reviews allocation signals every 24 hours, and applies policy controls to deposits, reallocation, and withdrawals. Gateway, escrow, and treasury controls add programmable USDC movement around that flow.

## Presentation deck

### Slide 1: Nexora

**Title:** Nexora

**Subtitle:** The financial control layer for autonomous USDC on Arc

**Footer:** Fawaz Oyebode · Build on Arc · Checkpoint 2

Use the Nexora banner and keep this slide sparse.

### Slide 2: Autonomous agents need financial controls

- Agents can hold wallets and call services, but applications still need spending limits, approvals, settlement evidence, and recovery paths.
- Teams rebuild payment orchestration, policy checks, receipts, and accounting for each agent or application.
- Cross-chain liquidity adds wallet, route, and reconciliation risk.

### Slide 3: The Nexora control layer

Show this flow:

```text
Signal or service request
        ↓
Circle agent wallet
        ↓
Nexora policy + approval
        ↓
x402 USDC settlement on Arc
        ↓
Receipt + memory + reputation + notification
```

Add one sentence: Arc gives the flow USDC-denominated gas, EVM compatibility, and fast settlement.

### Slide 4: Working agent payment flow

- Create and fund a Circle developer-controlled agent wallet.
- Apply transaction, period, recipient, contract, cooldown, and expiry rules.
- Purchase a paid API through x402 after automated or human approval.
- Record the verified outcome and block replay.

Use screenshots from Agents, Policies, Marketplace, and Receipts.

### Slide 5: One USDC control plane

- Circle Gateway exposes aggregate and per-domain USDC balances.
- Nexora Marketplace supports Arc-first settlement with Base and Arbitrum test routes.
- Open publication lets API providers add paid services under their own wallet identity.
- Applications can reuse Nexora's policy, x402, escrow, receipt, and settlement primitives while keeping their own checkout, subscription, payout, and product ledgers.

Do not claim that every Base and Arbitrum route is live until you sign the remaining publication transactions.

### Slide 6: Save/Earn for idle USDC

- Users deposit idle USDC into the Nexora Save/Earn flow on Arc.
- The optimizer ranks approved vault routes by live signals and policy constraints.
- Nexora reviews the allocation after 24 hours and moves funds only when a better permitted route exists.
- Users retain position, earnings, and withdrawal visibility.

Label strategy ranking as a decision signal, not a yield or safety guarantee.

### Slide 7: Built for developers

- `@nexorafi/x402` v0.3 release candidate supports Express, Next.js, x402 v1/v2, and CAIP-2 networks.
- The SDK exposes payment requirements, settlement types, Circle intent controls, and receipt helpers.
- Games, SaaS products, AI workflows, marketplaces, creator platforms, and commerce apps can integrate Nexora without rebuilding each payment control.

Add this command:

```bash
npm install @nexorafi/x402@0.3
```

Mark it “available after v0.3 npm release” until publication succeeds.

### Slide 8: Security work already in the repository

- Onchain policies constrain amount, destination, service, contract, timing, and approval requirements.
- Transaction-bound authorizations and nonce checks prevent duplicate settlement.
- Backend adversarial tests cover replay, policy races, receipt mismatch, fee accounting, and publisher isolation.
- Foundry tests cover settlement, policies, reputation, proxies, escrow, and Save/Earn contracts.

Footer: Early and unaudited. Testnet use only.

### Slide 9: Checkpoint progress and next milestone

**Working:** Arc agent wallets, policies, approvals, x402 payments, Marketplace, receipts, reputation, Gateway, escrow, and Save/Earn.

**In progress:** production deployment of the current build, remaining Marketplace publication transactions, SDK v0.3 npm release, service integrations, monitoring, and security review.

**Final submission goal:** demonstrate an autonomous Arc agent receiving a request, passing policy, settling USDC, and producing a public receipt without manual wallet signing during execution.

### Slide 10: Why Arc

- USDC serves as the money layer and the gas asset.
- Fast EVM settlement suits agent-to-agent and service-payment flows.
- Circle wallets, Gateway, Agent Stack patterns, and x402 fit one Arc-first architecture.

Close with:

**Nexora gives autonomous capital a programmable boundary before and after every payment.**

Links: https://nexorafi.app · https://github.com/fawazdevx/Nexora

## Two-to-three-minute progress video

Target length: 2 minutes 40 seconds. Record the browser at 1080p and zoom enough for policy values and receipt details to remain readable.

### 0:00–0:20 | Opening

Show the landing page.

> I’m Fawaz, and I’m building Nexora, an Arc-first financial control and payment layer for autonomous agents and USDC applications. Nexora lets an agent hold funds, make a payment, and prove what happened under rules its owner set in advance.

### 0:20–0:50 | Agent wallet

Open Agents, select an Arc Testnet agent, and show its wallet and balance.

> This agent uses a Circle developer-controlled wallet on Arc. I can fund it with USDC, select its settlement network, and keep that network attached to the agent as I move through the application. Nexora also supports Base and Arbitrum test routes, while Arc remains the primary chain.

### 0:50–1:20 | Policy and approval

Open Policies and show a saved transaction limit, recipient rule, or approval requirement.

> Before the agent spends, Nexora checks transaction and period limits, recipients, contracts, cooldowns, expiry, and approval rules. A payment that fails policy never reaches settlement. A payment that needs a human decision enters the approval queue.

### 1:20–1:55 | x402 purchase

Open Marketplace, choose a service on Arc, create the payment, and approve it if required.

> Nexora’s Marketplace uses x402 for paid APIs. The agent requests a service, Nexora binds the authorization to the amount, network, recipient, and request, then the Arc wallet settles in USDC. API providers can publish under their own wallet, so the catalog can grow beyond Nexora’s six services.

### 1:55–2:15 | Receipt and security

Open Payments or Receipts and show the completed transaction.

> After settlement, Nexora stores a receipt, notification, memory event, and reputation signal. Nonce and request-hash checks stop replay. Our backend and Foundry suites test duplicate settlement, policy races, receipt mismatches, and contract behavior.

### 2:15–2:35 | DeFi and Gateway

Open Save/Earn, then show Gateway if time permits.

> Nexora also manages idle Arc USDC through Save/Earn. The optimizer ranks approved vault routes and reviews the allocation after 24 hours. Gateway provides unified USDC visibility across supported chains, so agents and applications can manage liquidity through one control surface.

### 2:35–2:45 | Close

Return to the landing page.

> Next, I’m publishing SDK v0.3, completing the remaining Marketplace routes, and hardening the system for the final Arc demo. The code is public on GitHub. Thank you.

## Submission checklist

### Repository

- Push the approved code to the public GitHub repository.
- Confirm that no `.env`, private key, Circle entity secret, API credential, or Vercel secret appears in the commit.
- Keep `README.md` at the repository root and verify its links on GitHub.
- Add the final deployment addresses only through the correct environment settings and public configuration files.

### Demo

- Run the backend on port 4000 and the frontend on port 5173 for the local recording.
- Use an Arc agent with enough testnet USDC for the payment and gas.
- Save one clear policy and test the exact service before recording.
- Show one successful transaction hash or receipt on Arc Testnet.
- Avoid showing terminal windows, environment values, wallet secrets, or unrelated browser tabs.

### Deck and video

- Build the ten slides above in Canva or Google Slides.
- Set the deck to “Anyone with the link can view.”
- Upload the progress video to YouTube or Loom as an unlisted public-view link.
- Put the video link on Slide 1 or Slide 10 if the checkpoint form has no separate video field.
- Check both links in a private browser window.

### Submission form

- Project Name: `Nexora`
- Team Member: `Fawaz Oyebode`, Leader
- Code: `https://github.com/fawazdevx/Nexora`
- Presentation: paste the public deck URL
- Tracks: select `Agentic Economy Track` and `DeFi Track`
- Image: upload `frontend/public/nexora-banner.png`
- Paste the written progress update and remove any formatting the form does not support.
- Submit before Monday, July 27, 2026 at 12:59 PM Africa/Lagos. This matches 11:59 UTC and the stated Sunday 23:59 Anywhere on Earth cutoff.
