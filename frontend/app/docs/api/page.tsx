import {useEffect, useState} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  Check,
  CircleDollarSign,
  Code2,
  Copy,
  ExternalLink,
  Gamepad2,
  Github,
  Layers3,
  Play,
  Server,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {JsonViewer} from "@/components/JsonViewer";
import {navigateTo} from "@/lib/router";

const facilitatorUrl = "https://nexorafibackend.vercel.app";
const sdkRepo = "https://github.com/fawazdevx/Nexora";
const arcUsdc = "0x3600000000000000000000000000000000000000";

const sections = [
  {id: "quickstart", label: "Quickstart"},
  {id: "networks", label: "Networks"},
  {id: "sdk", label: "SDK"},
  {id: "endpoints", label: "API"},
  {id: "applications", label: "Applications"},
  {id: "games", label: "Games"},
  {id: "circle", label: "Circle"},
  {id: "security", label: "Security"}
];

const installCommands: Record<string, string> = {
  npm: "npm install @nexorafi/x402@0.3",
  pnpm: "pnpm add @nexorafi/x402@0.3",
  yarn: "yarn add @nexorafi/x402@0.3"
};

const networks = [
  {
    name: "Arc Testnet",
    id: "arc-testnet",
    caip2: "eip155:5042002",
    asset: "USDC",
    settlement: "EIP-3009",
    status: "Primary demo"
  },
  {
    name: "Base Sepolia",
    id: "base-sepolia",
    caip2: "eip155:84532",
    asset: "USDC",
    settlement: "EIP-3009",
    status: "Testnet route"
  },
  {
    name: "Arbitrum Sepolia",
    id: "arbitrum-sepolia",
    caip2: "eip155:421614",
    asset: "USDC",
    settlement: "EIP-3009",
    status: "Testnet route"
  },
  {
    name: "BOT Chain Testnet",
    id: "bot-chain-testnet",
    caip2: "eip155:968",
    asset: "USDT",
    settlement: "Meridian + Permit2",
    status: "Testnet route"
  }
];

const sdkTabs = [
  {
    key: "express",
    label: "Express",
    language: "ts" as const,
    code: `import express from "express";
import {nexoraX402} from "@nexorafi/x402";

const app = express();

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL!,
    payTo: process.env.PUBLISHER_ADDRESS!,
    asset: "${arcUsdc}",
    price: "0.05",
    network: "arc-testnet",
    x402Version: 2,
    resource: "https://api.example.com/paid-report",
    description: "Paid growth report",
    onReceipt: async ({verification, settlement}) => {
      await grantUsageOnce(settlement?.transaction, verification.payer);
    }
  }),
  (req, res) => res.json({
    report: "paid result",
    payer: req.x402?.verification.payer,
    transaction: req.x402?.settlement?.transaction
  })
);`
  },
  {
    key: "next",
    label: "Next.js",
    language: "ts" as const,
    code: `import {withNexoraX402} from "@nexorafi/x402";

export const POST = withNexoraX402(
  {
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL!,
    payTo: process.env.PUBLISHER_ADDRESS!,
    asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    price: "0.02",
    network: "arbitrum-sepolia",
    x402Version: 2,
    resource: "https://api.example.com/risk-check",
    description: "Arbitrum risk check"
  },
  async (_request, context) => Response.json({
    ok: true,
    payer: context.verification.payer,
    transaction: context.settlement?.transaction
  })
);`
  },
  {
    key: "bot",
    label: "BOT Chain",
    language: "ts" as const,
    code: `import {
  NexoraX402Client,
  buildMeridianPermit2Payload,
  buildPermit2WitnessTypedData,
  createMeridianPaymentRequirements,
  randomPermit2Nonce
} from "@nexorafi/x402";

const requirements = createMeridianPaymentRequirements({
  facilitatorUrl: process.env.NEXORA_FACILITATOR_URL!,
  price: "0.01",
  resource: "https://game.example.com/actions/mint",
  description: "Mint one game item"
});

const nonce = randomPermit2Nonce();
const deadline = String(Math.floor(Date.now() / 1000) + 300);
const typedData = buildPermit2WitnessTypedData({
  token: requirements.asset,
  amount: requirements.maxAmountRequired,
  facilitator: requirements.payTo,
  chainId: 968,
  nonce,
  deadline
});

const signature = await wallet.signTypedData(typedData);
const payment = buildMeridianPermit2Payload({
  network: "bot-chain-testnet",
  signature,
  owner: wallet.account.address,
  token: requirements.asset,
  amount: requirements.maxAmountRequired,
  facilitator: requirements.payTo,
  nonce,
  deadline
});

const client = new NexoraX402Client(process.env.NEXORA_FACILITATOR_URL!);
const settlement = await client.settle(payment, requirements);`
  },
  {
    key: "agent-stack",
    label: "Agent Stack",
    language: "ts" as const,
    code: `import {NexoraX402Client} from "@nexorafi/x402";

const nexora = new NexoraX402Client(process.env.NEXORA_API_URL!, {
  authorizationToken: signedNexoraSession
});

const intent = await nexora.createCirclePaymentIntent({
  operatorAddress,
  agentId,
  walletAddress,
  serviceUrl,
  chain: "BASE_SEPOLIA",
  data: {query: "BTC"}
});

await nexora.approveCirclePaymentIntent(intent.id, operatorAddress);
const authorization = await nexora.circlePaymentIntentAuthorization(
  intent.id,
  operatorAddress
);

if (!authorization.approved) throw new Error("Payment is not approved");

const paid = await externalCircleAgent.pay(
  authorization.payment.serviceUrl,
  authorization.payment.data
);

await nexora.completeCirclePaymentIntent(intent.id, {
  operatorAddress,
  paymentResponse: paid.paymentResponse,
  result: paid.result
});`
  },
  {
    key: "manifest",
    label: "Manifest",
    language: "ts" as const,
    code: `import {createNexoraServiceManifest} from "@nexorafi/x402";

const manifest = createNexoraServiceManifest({
  name: "Wallet Risk + Approval Scan",
  endpointHash: "wallet-risk-approval-scan-v1",
  kind: "wallet_risk_approval_scan",
  price: "0.05",
  outputSchema: ["wallet", "riskLevel", "checks", "recommendedPolicy"]
});

console.log(manifest.policyHints);`
  }
];

const lifecycle = [
  "Your route returns an x402 payment challenge.",
  "The client signs the chain-specific payment authorization.",
  "Nexora verifies the network, asset, amount, recipient, signature, and policy.",
  "The selected facilitator settles the payment and rejects replay.",
  "Your application records the receipt and grants the result once."
];

const integrationRoles = [
  {need: "Managed agent wallet", nexora: "Circle developer-controlled wallet", application: "Map the wallet to the user, agent, or treasury role."},
  {need: "Paid API or metered action", nexora: "x402 requirements, verification, settlement, and receipt", application: "Deliver the result once and store the receipt against the order."},
  {need: "Spending controls", nexora: "Policy Registry, approval queue, and risk checks", application: "Choose limits, reviewers, expiry, and escalation rules."},
  {need: "Cross-chain USDC", nexora: "Circle Gateway routing and balance views", application: "Reconcile source deposits and destination delivery."},
  {need: "Milestone payment", nexora: "Escrow contract and receipt", application: "Define evidence, deadlines, disputes, and refunds."},
  {need: "Audit trail", nexora: "Receipts, notifications, reputation, and memory", application: "Keep business records and reconcile exceptions."}
];

const useCases = [
  {title: "SaaS and APIs", copy: "Charge per request, seat action, report, model call, or usage unit. Match each receipt to the customer usage record."},
  {title: "Marketplaces", copy: "Bind the seller, product, amount, fee, and idempotency key before settlement. Deliver each purchase once."},
  {title: "Subscriptions", copy: "Create one intent per billing period. A successful receipt extends access once, including after retries."},
  {title: "Escrow and work", copy: "Lock funds against a milestone, deadline, counterparty, and dispute policy before work begins."},
  {title: "Games and prizes", copy: "Sell items or entries through paid actions and keep gameplay state separate from custody accounting."},
  {title: "Agents and treasury", copy: "Apply transaction caps, allowlists, cooldowns, and approval thresholds before an automated wallet spends."}
];

const gameFlows = [
  {action: "Player wallet", component: "Circle user-controlled or modular wallet, or connected EOA", game: "Link the wallet to the player and define recovery."},
  {action: "Item or API purchase", component: "Nexora x402 settlement and receipt", game: "Grant the item once for the payment request ID."},
  {action: "Prize pool", component: "Dedicated audited prize-pool or escrow contract", game: "Define entry, winner, cancellation, refund, and deadline rules."},
  {action: "Player payout", component: "Policy-controlled Circle payout wallet", game: "Authorize payouts from trusted game state and reject duplicate IDs."},
  {action: "Refund or dispute", component: "Escrow or refund workflow", game: "Define evidence, decision authority, and eligibility."}
];

const moneyInvariants = [
  "Give every deposit, purchase, payout, refund, and withdrawal a unique idempotency key.",
  "Change an entitlement or internal balance only after a verified receipt.",
  "Do not use one receipt for two business operations.",
  "Derive the token, amount, recipient, chain, and fee from trusted server state.",
  "Reconcile internal balances with Circle or onchain balances.",
  "Send failed delivery after successful payment into a refund or recovery workflow."
];

const securityNotes = [
  "Keep facilitator credentials, Circle secrets, relayer keys, and authenticated session tokens on the server.",
  "Use HTTPS for application and facilitator traffic.",
  "Configure the network, asset, recipient, resource, amount, and validity window for every paid route.",
  "Do not deliver paid content or grant an entitlement before settlement succeeds.",
  "Store one idempotency key and one verified receipt for each business operation.",
  "Keep payout and withdrawal authority away from untrusted clients.",
  "Treat mainnet support as unavailable until contracts, wallets, monitoring, and accounting controls pass production review.",
  "Obtain an independent audit before production custody or high-value settlement."
];

const sourceReferences = [
  {title: "Application payments", path: "docs/application-payments.md", description: "Architecture, use cases, responsibilities, and money invariants."},
  {title: "Game payments", path: "docs/game-payments.md", description: "Player wallets, purchases, prize pools, payouts, and reconciliation."},
  {title: "Circle integration boundary", path: "docs/circle-gateway-sellers.md", description: "Nexora Marketplace, Circle services, and Gateway responsibilities."},
  {title: "SDK package guide", path: "sdk/x402/README.md", description: "Package exports, migration notes, and code examples."}
];

export default function ApiDocsPage() {
  const active = useActiveSection(sections.map((section) => section.id));
  const [pm, setPm] = useState("npm");
  const [sdkTab, setSdkTab] = useState("express");
  const tab = sdkTabs.find((item) => item.key === sdkTab) ?? sdkTabs[0];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="Developer documentation · SDK v0.3"
        title="Build policy-aware x402 payments"
        description="Use Nexora in APIs, SaaS products, games, marketplaces, and agent workflows across supported and integrated chains. This guide covers the SDK, facilitator API, application boundaries, and production controls."
        action={
          <div className="flex flex-wrap gap-3">
            <a className="secondary-button" href="https://www.npmjs.com/package/@nexorafi/x402" target="_blank" rel="noreferrer">
              npm v0.3 <ExternalLink size={15} />
            </a>
            <button className="action-button" onClick={() => navigateTo("/x402/playground")}>
              Open playground <ArrowRight size={16} />
            </button>
          </div>
        }
      />

      <nav aria-label="Documentation sections" className="sticky top-[68px] z-20 -mx-1 flex gap-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0a0814]/90 px-2 py-2 backdrop-blur-xl scrollbar-hide">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(section.id)?.scrollIntoView({behavior: "smooth", block: "start"});
            }}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${active === section.id ? "bg-gradient-to-br from-plasma/[0.2] to-plasma/[0.08] text-white" : "text-slate-400 hover:text-white"}`}
          >
            {section.label}
          </a>
        ))}
      </nav>

      <section className="grid gap-4 md:grid-cols-3">
        <DocMetric icon={<Boxes size={18} />} label="Current release" value="SDK v0.3" href="https://www.npmjs.com/package/@nexorafi/x402" external />
        <DocMetric icon={<Code2 size={18} />} label="Protocol support" value="x402 v1 + v2" onClick={() => scrollToSection("sdk")} />
        <DocMetric icon={<Layers3 size={18} />} label="Active testnets" value="4 network routes" onClick={() => scrollToSection("networks")} />
      </section>

      <section id="quickstart" className="panel scroll-mt-28">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="section-kicker">Quickstart</p>
              <span className="rounded-full border border-mint/25 bg-mint/10 px-2 py-0.5 text-[11px] font-semibold text-mint">Live on npm</span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white">Protect your first paid route</h2>
            <p className="muted-copy mt-3 max-w-3xl">
              Install the package in your server application, choose a supported route, and configure the payment recipient, asset, price, and resource URL. The middleware returns a 402 challenge until the client submits a valid payment.
            </p>
          </div>
          <a className="secondary-button" href={sdkRepo} target="_blank" rel="noreferrer"><Github size={15} /> Source</a>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-white/[0.1] bg-white/[0.03] p-1">
            {Object.keys(installCommands).map((manager) => (
              <button
                key={manager}
                type="button"
                onClick={() => setPm(manager)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${pm === manager ? "bg-plasma/20 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {manager}
              </button>
            ))}
          </div>
          <CopyPill text={installCommands[pm]} />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FeatureCard title="Modern x402" copy="Create v2 CAIP-2 challenges while keeping v1 header compatibility." />
          <FeatureCard title="Multi-chain routes" copy="Use Arc, Base, and Arbitrum USDC routes from one package." />
          <FeatureCard title="Permit2 support" copy="Build policy-guarded BOT Chain USDT authorizations through Meridian." />
          <FeatureCard title="External agents" copy="Create, approve, and verify Circle Agent Stack payment intents." />
        </div>
      </section>

      <section id="networks" className="panel scroll-mt-28">
        <p className="section-kicker">Network reference</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Supported testnet routes</h2>
        <p className="muted-copy mt-3 max-w-3xl">
          Network types describe SDK compatibility. A payment route is live only when Nexora has configured and verified its contracts, token, RPC, facilitator, and policy controls.
        </p>
        <div className="mt-5 overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="min-w-[780px] w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Network</th>
                <th className="px-4 py-3 font-semibold">SDK name</th>
                <th className="px-4 py-3 font-semibold">CAIP-2</th>
                <th className="px-4 py-3 font-semibold">Asset</th>
                <th className="px-4 py-3 font-semibold">Settlement</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {networks.map((network) => (
                <tr key={network.id} className="text-slate-300">
                  <td className="px-4 py-3 font-semibold text-white">{network.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{network.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{network.caip2}</td>
                  <td className="px-4 py-3">{network.asset}</td>
                  <td className="px-4 py-3">{network.settlement}</td>
                  <td className="px-4 py-3"><span className="rounded-full border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-xs">{network.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <FeatureCard title="Seller wallet" copy="The seller address receives USDT. It needs no starting USDT and needs tBOT only when it sends a transaction." icon={<CircleDollarSign size={17} />} />
          <FeatureCard title="Policy relayer" copy="A separate backend wallet records policy spend and reputation. Fund it with tBOT for gas, not USDT." icon={<Server size={17} />} />
          <FeatureCard title="Buyer wallet" copy="The buyer holds USDT and uses tBOT when an onchain token approval is required. Permit2 payment signatures are offchain." icon={<WalletCards size={17} />} />
        </div>
        <div className="mt-4 rounded-xl border border-amber/20 bg-amber/[0.07] px-4 py-3 text-sm leading-6 text-slate-300">
          BOT Chain mainnet remains disabled. Testnet policy, reputation, relayer, and settlement settings must not be reused as mainnet configuration.
        </div>
      </section>

      <section id="sdk" className="panel scroll-mt-28">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">SDK reference</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Choose an integration path</h2>
            <p className="muted-copy mt-3 max-w-3xl">The package ships as ESM with TypeScript declarations. Middleware handles payment challenges, verification, settlement, response headers, and receipt callbacks.</p>
          </div>
          <div className="flex max-w-2xl flex-wrap justify-end gap-1 rounded-lg border border-white/[0.1] bg-white/[0.03] p-1">
            {sdkTabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSdkTab(item.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${sdkTab === item.key ? "bg-plasma/20 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5">
          <JsonViewer title={`${tab.label} · @nexorafi/x402@0.3`} language={tab.language} code={tab.code} maxHeight="620px" />
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="surface p-5">
            <p className="text-sm font-semibold text-white">x402 headers</p>
            <div className="mt-4 grid gap-3 text-sm">
              <ProtocolRow version="v1" request="X-PAYMENT" challenge="PAYMENT-REQUIRED" receipt="X-PAYMENT-RESPONSE" />
              <ProtocolRow version="v2" request="PAYMENT-SIGNATURE" challenge="PAYMENT-REQUIRED" receipt="PAYMENT-RESPONSE" />
            </div>
          </div>
          <div className="surface p-5">
            <p className="text-sm font-semibold text-white">Required route fields</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-400">
              <Field name="facilitatorUrl" detail="Nexora API origin" />
              <Field name="payTo" detail="Recipient or required facilitator" />
              <Field name="asset" detail="Token contract address" />
              <Field name="price" detail="Decimal token amount" />
              <Field name="network" detail="SDK network name" />
              <Field name="resource" detail="Stable paid-resource URL" />
            </div>
          </div>
        </div>
      </section>

      <section id="endpoints" className="grid scroll-mt-28 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="panel">
          <p className="section-kicker">Facilitator API</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Call the protocol directly</h2>
          <p className="muted-copy mt-3">SDK clients call these routes for you. Direct integrations send payment requirements and the signed payment payload as JSON.</p>
          <div className="mt-5 grid gap-3">
            <Endpoint method="GET" path="/api/x402/supported" detail="Returns active x402 versions, schemes, networks, assets, and settlement methods." />
            <Endpoint method="POST" path="/api/x402/verify" detail="Validates the payload against its payment requirements without granting the resource." />
            <Endpoint method="POST" path="/api/x402/facilitator-settle" detail="Settles a verified authorization, records the receipt, and rejects replay." />
          </div>

          <h3 className="mt-7 text-lg font-semibold text-white">Circle Agent Stack intents</h3>
          <div className="mt-4 grid gap-3">
            <Endpoint method="POST" path="/api/circle/agent-marketplace/intents" detail="Creates a policy-aware external payment intent." tryable={false} />
            <Endpoint method="POST" path="/api/payment-intents/:id/approve" detail="Approves a pending intent for the authenticated operator." tryable={false} />
            <Endpoint method="GET" path="/api/payment-intents/:id/authorization" detail="Returns the approved payment details for external execution." tryable={false} />
            <Endpoint method="POST" path="/api/payment-intents/:id/external-receipt" detail="Verifies the onchain payment before Nexora records settlement." tryable={false} />
          </div>
        </div>

        <aside className="panel">
          <p className="section-kicker">Payment lifecycle</p>
          <ol className="mt-5 space-y-0">
            {lifecycle.map((item, index) => (
              <li key={item} className="relative flex gap-3 pb-6 last:pb-0">
                {index < lifecycle.length - 1 ? <span className="absolute left-[13px] top-7 h-full w-px bg-white/[0.1]" /> : null}
                <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-plasma/40 bg-plasma/15 text-xs font-bold text-orchid">{index + 1}</span>
                <span className="pt-1 text-sm leading-6 text-slate-300">{item}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-mint/20 bg-mint/[0.06] p-4 text-sm leading-6 text-slate-300">
            External Agent Stack completion requires a transaction hash. Nexora verifies the approved chain, asset, payer, recipient, amount, and successful receipt before it marks the intent settled.
          </div>
        </aside>
      </section>

      <section id="applications" className="panel scroll-mt-28">
        <p className="section-kicker">Application integration</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Use Nexora as the payment and control layer</h2>
        <p className="muted-copy mt-3 max-w-4xl">
          Nexora handles chain-aware payment requirements, wallet execution, policy checks, approvals, receipts, and Gateway routing. Your application owns user accounts, entitlements, refunds, disputes, tax treatment, custody rules, and its internal ledger.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {useCases.map((useCase) => <FeatureCard key={useCase.title} title={useCase.title} copy={useCase.copy} />)}
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="min-w-[820px] w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Application need</th>
                <th className="px-4 py-3 font-semibold">Nexora or Circle</th>
                <th className="px-4 py-3 font-semibold">Your application</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {integrationRoles.map((row) => (
                <tr key={row.need} className="align-top text-slate-300">
                  <td className="px-4 py-3 font-semibold text-white">{row.need}</td>
                  <td className="px-4 py-3 leading-6">{row.nexora}</td>
                  <td className="px-4 py-3 leading-6">{row.application}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <JsonViewer
            title="Suggested application boundary"
            language="bash"
            code={`POST /payment-intents\nPOST /payment-intents/:id/approve\nPOST /payment-intents/:id/execute\nPOST /payments/:id/reconcile\nPOST /payout-intents\nPOST /refund-intents\nGET  /receipts/:id\nGET  /ledger/accounts/:id`}
            maxHeight="360px"
          />
          <div className="surface p-5">
            <p className="text-sm font-semibold text-white">Money invariants</p>
            <ol className="mt-4 grid gap-3">
              {moneyInvariants.map((item, index) => (
                <li key={item} className="flex gap-3 text-sm leading-6 text-slate-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-xs font-semibold text-orchid">{index + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="games" className="panel scroll-mt-28">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-plasma/20 bg-plasma/10 p-2 text-orchid"><Gamepad2 size={20} /></span>
          <div>
            <p className="section-kicker">Game integration</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Start with one paid game action</h2>
          </div>
        </div>
        <p className="muted-copy mt-4 max-w-4xl">
          A practical first release sells one item or tournament entry in USDC or the configured integrated-chain asset. Nexora creates the payment requirement and receipt; the game grants the item only after verified settlement.
        </p>

        <div className="mt-5 overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="min-w-[840px] w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Money action</th>
                <th className="px-4 py-3 font-semibold">Nexora or Circle component</th>
                <th className="px-4 py-3 font-semibold">Game responsibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {gameFlows.map((row) => (
                <tr key={row.action} className="align-top text-slate-300">
                  <td className="px-4 py-3 font-semibold text-white">{row.action}</td>
                  <td className="px-4 py-3 leading-6">{row.component}</td>
                  <td className="px-4 py-3 leading-6">{row.game}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <FeatureCard title="1. Verify" copy="Wait for a successful receipt before changing player state." />
          <FeatureCard title="2. Grant once" copy="Use the payment request ID as the purchase idempotency key." />
          <FeatureCard title="3. Reconcile" copy="Match purchases and payouts to custody or onchain balances." />
        </div>
      </section>

      <section id="circle" className="panel scroll-mt-28">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-cyan/20 bg-cyan/10 p-2 text-cyan"><CircleDollarSign size={20} /></span>
          <div>
            <p className="section-kicker">Circle integration boundary</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Wallets, Marketplace, and Gateway</h2>
          </div>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <FeatureCard title="Nexora Marketplace" copy="Nexora publishers register services and settle through Nexora's network-specific routes, policies, and receipts." />
          <FeatureCard title="Circle Agent Stack" copy="External agents request Nexora approval, execute with their own Circle wallet, then submit a verifiable onchain receipt." />
          <FeatureCard title="Circle Gateway" copy="Gateway unifies USDC liquidity across supported domains. Your application still owns its spendable balance and reconciliation ledger." />
        </div>
        <div className="mt-5 rounded-xl border border-white/[0.09] bg-white/[0.03] p-5">
          <p className="text-sm font-semibold text-white">Marketplace rule</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Nexora does not duplicate its canonical services as Circle Gateway seller routes. The Circle Marketplace view discovers compatible third-party x402 services and adds Nexora policy, approval, managed execution, and receipt verification.
          </p>
        </div>
      </section>

      <section id="security" className="grid scroll-mt-28 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="panel">
          <p className="section-kicker">Security and production</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Integration checklist</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {securityNotes.map((item) => (
              <div key={item} className="surface flex items-start gap-3 px-4 py-3 text-sm leading-6 text-slate-300">
                <ShieldCheck size={16} className="mt-1 shrink-0 text-mint" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="panel">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-orchid" />
            <p className="section-kicker">Repository references</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">This page includes the integration guidance from these source documents. Use the links for version history or contributions.</p>
          <div className="mt-5 grid gap-3">
            {sourceReferences.map((reference) => (
              <a
                key={reference.path}
                href={`${sdkRepo}/blob/master/${reference.path}`}
                target="_blank"
                rel="noreferrer"
                className="surface group block p-4 transition hover:border-plasma/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{reference.title}</p>
                  <ArrowUpRight size={14} className="text-slate-600 transition group-hover:text-orchid" />
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{reference.description}</p>
                <p className="mt-2 break-all font-mono text-[11px] text-slate-600">{reference.path}</p>
              </a>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({behavior: "smooth", block: "start"});
}

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      {rootMargin: "-25% 0px -60% 0px", threshold: [0, 0.5, 1]}
    );
    ids.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return active;
}

function DocMetric({icon, label, value, href, onClick, external}: {icon: React.ReactNode; label: string; value: string; href?: string; onClick?: () => void; external?: boolean}) {
  const interactive = Boolean(href || onClick);
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-orchid">{icon}{label}</div>
        {interactive ? <ArrowUpRight size={15} className="text-slate-600 transition group-hover:text-orchid" /> : null}
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </>
  );
  const className = `panel group ${interactive ? "cursor-pointer transition hover:border-plasma/30" : ""}`;
  if (href) return <a className={className} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{content}</a>;
  if (onClick) return <button type="button" className={`${className} w-full text-left`} onClick={onClick}>{content}</button>;
  return <div className={className}>{content}</div>;
}

function FeatureCard({title, copy, icon}: {title: string; copy: string; icon?: React.ReactNode}) {
  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2">
        {icon ? <span className="text-orchid">{icon}</span> : null}
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
    </div>
  );
}

function Endpoint({method, path, detail, tryable = true}: {method: "GET" | "POST"; path: string; detail: string; tryable?: boolean}) {
  const resolvedPath = path.includes(":id") ? path.replace(":id", "<intent-id>") : path;
  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${method === "GET" ? "bg-cyan/15 text-cyan" : "bg-plasma/15 text-orchid"}`}>{method}</span>
        <span className="min-w-0 flex-1 break-all font-mono text-sm text-white">{path}</span>
        <CopyIcon value={`${facilitatorUrl}${resolvedPath}`} label="endpoint URL" />
        {tryable ? (
          <button type="button" onClick={() => navigateTo("/x402/playground")} className="inline-flex items-center gap-1 text-xs font-semibold text-orchid transition hover:text-white">
            <Play size={11} /> Try
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
    </div>
  );
}

function ProtocolRow({version, request, challenge, receipt}: {version: string; request: string; challenge: string; receipt: string}) {
  return (
    <div className="grid grid-cols-[42px_1fr] gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
      <span className="font-semibold text-orchid">{version}</span>
      <div className="grid gap-1 font-mono text-xs text-slate-300 sm:grid-cols-3">
        <span>{request}</span><span>{challenge}</span><span>{receipt}</span>
      </div>
    </div>
  );
}

function Field({name, detail}: {name: string; detail: string}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
      <p className="font-mono text-xs text-orchid">{name}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function CopyPill({text}: {text: string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <button type="button" onClick={copy} className="inline-flex max-w-full items-center gap-3 rounded-lg border border-white/[0.1] bg-[#050813] px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-plasma/40">
      <span className="text-slate-500">$</span>
      <span className="truncate">{text}</span>
      <span className="ml-1 text-slate-500">{copied ? <Check size={14} className="text-mint" /> : <Copy size={14} />}</span>
    </button>
  );
}

function CopyIcon({value, label}: {value: string; label: string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`Copied ${label}`);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <button type="button" onClick={copy} className="shrink-0 text-slate-500 transition hover:text-white" aria-label={`Copy ${label}`}>
      {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
    </button>
  );
}
