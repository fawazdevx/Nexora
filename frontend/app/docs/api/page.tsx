import {ArrowRight, CheckCircle2, Code2, Copy, ExternalLink, Server, ShieldCheck, WalletCards} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {navigateTo} from "@/lib/router";

const facilitatorUrl = "https://nexorafibackend.vercel.app";
const arcUsdc = "0x3600000000000000000000000000000000000000";

export default function ApiDocsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="API docs"
        title="Integrate Nexora x402 payments"
        description="Protect APIs with Arc USDC payments using Nexora's facilitator, SDK middleware, and marketplace service manifests."
        action={<div className="flex flex-wrap gap-3"><button className="secondary-button" onClick={() => navigateTo("/x402/playground")}>Playground</button><button className="action-button" onClick={() => navigateTo("/marketplace/new")}>Publish API <ArrowRight size={16} /></button></div>}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <DocMetric icon={<WalletCards size={18} />} label="Payment asset" value="Arc USDC" />
        <DocMetric icon={<Server size={18} />} label="Facilitator" value="Nexora x402" />
        <DocMetric icon={<ShieldCheck size={18} />} label="Protection" value="Verify + settle" />
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Quickstart</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Add paid access to an API route.</h2>
            <p className="muted-copy mt-3 max-w-3xl">
              Install the SDK, point it at the Nexora facilitator endpoint, then define the recipient wallet, Arc USDC asset, and per-request price.
            </p>
          </div>
          <a className="secondary-button" href="https://www.npmjs.com/package/@nexorafi/x402" target="_blank" rel="noreferrer">
            NPM package <ExternalLink size={15} />
          </a>
        </div>
        <CodeBlock code="npm install @nexorafi/x402" />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <ExampleCard
          title="Express middleware"
          detail="Protect an endpoint and return a structured result only after x402 verification and settlement."
          code={`import express from "express";
import { nexoraX402 } from "@nexorafi/x402";

const app = express();

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl: "${facilitatorUrl}",
    payTo: "0xYourPublisherWallet",
    asset: "${arcUsdc}",
    price: "0.05",
    network: "arc-testnet",
    description: "Website growth report"
  }),
  (_req, res) => {
    res.json({ report: "paid result" });
  }
);`}
        />
        <ExampleCard
          title="Next.js route handler"
          detail="Use the route wrapper when your paid API runs in a Next.js app or serverless route."
          code={`import { withNexoraX402 } from "@nexorafi/x402";

export const GET = withNexoraX402(
  {
    facilitatorUrl: "${facilitatorUrl}",
    payTo: "0xYourPublisherWallet",
    asset: "${arcUsdc}",
    price: "0.05",
    network: "arc-testnet",
    description: "Paid API response"
  },
  async (_request, context) => {
    return Response.json({
      ok: true,
      payer: context.verification.payer,
      tx: context.settlement?.transaction
    });
  }
);`}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="panel">
          <p className="section-kicker">Protocol endpoints</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Raw facilitator API</h2>
          <p className="muted-copy mt-3">
            Use these endpoints directly if you are not using the SDK. SDK users normally do not need to call them manually.
          </p>
          <div className="mt-5 grid gap-3">
            <Endpoint method="GET" path="/x402/supported" detail="Returns supported x402 schemes, networks, and Arc USDC asset configuration." />
            <Endpoint method="POST" path="/x402/verify" detail="Validates the signed payment payload against the payment requirements before your API returns data." />
            <Endpoint method="POST" path="/x402/settle" detail="Settles the signed authorization and records the payment through Nexora." />
          </div>
        </div>

        <aside className="panel">
          <p className="section-kicker">Payment lifecycle</p>
          <div className="mt-5 grid gap-3">
            {[
              "API returns x402 payment requirements",
              "Client signs the Arc USDC payment payload",
              "Nexora verifies amount, recipient, asset, network, and signature",
              "Nexora settles payment and blocks replay",
              "Your API returns the paid response"
            ].map((item) => (
              <div key={item} className="surface flex items-start gap-3 px-4 py-3 text-sm text-slate-300">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-mint" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="panel">
          <p className="section-kicker">Configuration</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Required service fields</h2>
          <div className="mt-5 grid gap-3">
            <ConfigRow label="facilitatorUrl" value={facilitatorUrl} />
            <ConfigRow label="payTo" value="Publisher wallet receiving payment" />
            <ConfigRow label="asset" value={arcUsdc} />
            <ConfigRow label="price" value='USDC decimal string, for example "0.05"' />
            <ConfigRow label="network" value="arc-testnet" />
          </div>
        </div>

        <div className="panel">
          <p className="section-kicker">Security notes</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Production checklist</h2>
          <div className="mt-5 grid gap-3">
            {[
              "Use HTTPS for API and facilitator traffic.",
              "Keep payout wallets explicit per service.",
              "Use stable resource identifiers for paid routes.",
              "Do not serve paid content before verification succeeds.",
              "Use settle: false only for intentional verify-only flows."
            ].map((item) => (
              <div key={item} className="surface px-4 py-3 text-sm text-slate-300">{item}</div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function DocMetric({icon, label, value}: {icon: React.ReactNode; label: string; value: string}) {
  return (
    <div className="panel">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-orchid">
        {icon}
        {label}
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function ExampleCard({title, detail, code}: {title: string; detail: string; code: string}) {
  return (
    <div className="panel">
      <div className="flex items-center gap-2 text-base font-semibold text-white">
        <Code2 size={18} className="text-orchid" />
        {title}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
      <CodeBlock code={code} />
    </div>
  );
}

function CodeBlock({code}: {code: string}) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.1] bg-[#050813]">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2 text-xs text-slate-500">
        <span>Copy into your app</span>
        <Copy size={14} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-slate-200"><code>{code}</code></pre>
    </div>
  );
}

function Endpoint({method, path, detail}: {method: string; path: string; detail: string}) {
  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="status-pill border-mint/25 bg-mint/10 text-mint">{method}</span>
        <span className="font-mono text-sm text-white">{path}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
    </div>
  );
}

function ConfigRow({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 break-all font-mono text-sm text-white">{value}</p>
    </div>
  );
}
