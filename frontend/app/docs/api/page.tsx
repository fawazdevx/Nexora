import {useEffect, useState} from "react";
import {ArrowRight, ArrowUpRight, Check, Copy, ExternalLink, Github, Play, Server, ShieldCheck, WalletCards} from "lucide-react";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {JsonViewer} from "@/components/JsonViewer";
import {navigateTo} from "@/lib/router";
import {arcTestnet} from "@/lib/arc";

const facilitatorUrl = "https://nexorafibackend.vercel.app";
const arcUsdc = "0x3600000000000000000000000000000000000000";
const sdkRepo = "https://github.com/fawazdev/nexora";

const sections = [
  {id: "quickstart", label: "Quickstart"},
  {id: "sdk", label: "SDK"},
  {id: "endpoints", label: "Endpoints"},
  {id: "lifecycle", label: "Lifecycle"},
  {id: "config", label: "Config"},
  {id: "security", label: "Security"}
];

const installCommands: Record<string, string> = {
  npm: "npm install @nexorafi/x402",
  pnpm: "pnpm add @nexorafi/x402",
  yarn: "yarn add @nexorafi/x402"
};

const sdkTabs = [
  {
    key: "express",
    label: "Express",
    language: "ts" as const,
    code: `import express from "express";
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
);`
  },
  {
    key: "next",
    label: "Next.js",
    language: "ts" as const,
    code: `import { withNexoraX402 } from "@nexorafi/x402";

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
);`
  },
  {
    key: "manifest",
    label: "Manifest",
    language: "ts" as const,
    code: `import { createNexoraServiceManifest } from "@nexorafi/x402";

const manifest = createNexoraServiceManifest({
  name: "Wallet Risk + Approval Scan",
  endpointHash: "wallet-risk-approval-scan-v1",
  kind: "wallet_risk_approval_scan",
  price: "0.05",
  outputSchema: ["wallet", "riskLevel", "checks", "recommendedPolicy"]
});

console.log(manifest.policyHints);`
  },
  {
    key: "webhook",
    label: "Webhook",
    language: "ts" as const,
    code: `import { createWebhookExecutor } from "@nexorafi/x402";

export const POST = createWebhookExecutor(async ({ args }) => {
  return {
    status: "ok",
    summary: "Paid execution complete",
    input: args
  };
});`
  },
  {
    key: "curl",
    label: "curl",
    language: "bash" as const,
    code: `# 1. Call the paid route — the server replies 402 with requirements
curl -i https://your-api.example.com/paid-report

# 2. Retry with the signed x402 payment header
curl https://your-api.example.com/paid-report \\
  -H 'x-payment: <base64 signed Arc USDC payload>'`
  }
];

const lifecycle = [
  "API returns x402 payment requirements",
  "Client signs the Arc USDC payment payload",
  "Nexora verifies amount, recipient, asset, network, and signature",
  "Nexora settles payment and blocks replay",
  "Your API returns the paid response"
];

const securityNotes = [
  "Use HTTPS for API and facilitator traffic.",
  "Keep payout wallets explicit per service.",
  "Use stable resource identifiers for paid routes.",
  "Do not serve paid content before verification succeeds.",
  "Use settle: false only for intentional verify-only flows.",
  "Use live provider APIs before advertising compliance, liquidation, APY, or market-data results as definitive."
];

export default function ApiDocsPage() {
  const active = useActiveSection(sections.map((section) => section.id));
  const [pm, setPm] = useState("npm");
  const [sdkTab, setSdkTab] = useState("express");
  const tab = sdkTabs.find((item) => item.key === sdkTab) ?? sdkTabs[0];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="API docs"
        title="Integrate Nexora x402 payments"
        description="Protect APIs with Arc USDC payments using Nexora's facilitator, SDK middleware, and marketplace service manifests."
        action={
          <div className="flex flex-wrap gap-3">
            <button className="secondary-button" onClick={() => navigateTo("/x402/playground")}>Playground</button>
            <button className="action-button" onClick={() => navigateTo("/marketplace/new")}>Publish API <ArrowRight size={16} /></button>
          </div>
        }
      />

      {/* Section nav */}
      <nav className="sticky top-[68px] z-20 -mx-1 flex gap-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0a0814]/80 px-2 py-2 backdrop-blur-xl scrollbar-hide">
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
        <DocMetric icon={<WalletCards size={18} />} label="Payment asset" value="Arc USDC" href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/address/${arcUsdc}`} external />
        <DocMetric icon={<Server size={18} />} label="Facilitator" value="Nexora x402" href={facilitatorUrl} external />
        <DocMetric icon={<ShieldCheck size={18} />} label="Protection" value="Verify + settle" onClick={() => navigateTo("/x402/playground")} />
      </section>

      <section id="quickstart" className="panel scroll-mt-28">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Quickstart</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Add paid access to an API route.</h2>
            <p className="muted-copy mt-3 max-w-3xl">
              Install the SDK, point it at the Nexora facilitator endpoint, then define the recipient wallet, Arc USDC asset, and per-request price.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="secondary-button" href="https://www.npmjs.com/package/@nexorafi/x402" target="_blank" rel="noreferrer">NPM <ExternalLink size={15} /></a>
            <a className="secondary-button" href={sdkRepo} target="_blank" rel="noreferrer"><Github size={15} /> Source</a>
          </div>
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
      </section>

      {/* SDK examples with language tabs */}
      <section id="sdk" className="panel scroll-mt-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-kicker">SDK</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Protect a route</h2>
          </div>
          <div className="inline-flex rounded-lg border border-white/[0.1] bg-white/[0.03] p-1">
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
          <JsonViewer title={`${tab.label} · protect-route`} language={tab.language} code={tab.code} maxHeight="460px" />
        </div>
      </section>

      <section id="endpoints" className="grid scroll-mt-28 gap-5 lg:grid-cols-[1fr_380px]">
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

        <aside id="lifecycle" className="panel scroll-mt-28">
          <p className="section-kicker">Payment lifecycle</p>
          <ol className="mt-5 space-y-0">
            {lifecycle.map((item, index) => (
              <li key={item} className="relative flex gap-3 pb-5 last:pb-0">
                {index < lifecycle.length - 1 ? <span className="absolute left-[13px] top-7 h-full w-px bg-white/[0.1]" /> : null}
                <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-plasma/40 bg-plasma/15 text-xs font-bold text-orchid">{index + 1}</span>
                <span className="pt-1 text-sm leading-6 text-slate-300">{item}</span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section id="config" className="grid scroll-mt-28 gap-5 lg:grid-cols-2">
        <div className="panel">
          <p className="section-kicker">Configuration</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Required service fields</h2>
          <div className="mt-5 grid gap-3">
            <ConfigRow label="facilitatorUrl" value={facilitatorUrl} copyable />
            <ConfigRow label="payTo" value="Publisher wallet receiving payment" />
            <ConfigRow label="asset" value={arcUsdc} copyable />
            <ConfigRow label="price" value='USDC decimal string, for example "0.05"' />
            <ConfigRow label="network" value="arc-testnet" copyable />
          </div>
        </div>

        <div id="security" className="panel scroll-mt-28">
          <p className="section-kicker">Security notes</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Production checklist</h2>
          <div className="mt-5 grid gap-3">
            {securityNotes.map((item) => (
              <div key={item} className="surface flex items-start gap-3 px-4 py-3 text-sm text-slate-300">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-mint" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
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
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-orchid">
          {icon}
          {label}
        </div>
        {interactive ? <ArrowUpRight size={15} className="text-slate-600 transition group-hover:text-orchid" /> : null}
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
    </>
  );
  const className = `panel group ${interactive ? "cursor-pointer transition hover:border-plasma/30" : ""}`;
  if (href) {
    return <a className={className} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{content}</a>;
  }
  if (onClick) {
    return <button type="button" className={`${className} w-full text-left`} onClick={onClick}>{content}</button>;
  }
  return <div className={className}>{content}</div>;
}

function Endpoint({method, path, detail}: {method: "GET" | "POST"; path: string; detail: string}) {
  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${method === "GET" ? "bg-cyan/15 text-cyan" : "bg-plasma/15 text-orchid"}`}>{method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-white">{path}</span>
        <CopyIcon value={`${facilitatorUrl}${path}`} label="endpoint URL" />
        <button type="button" onClick={() => navigateTo("/x402/playground")} className="inline-flex items-center gap-1 text-xs font-semibold text-orchid transition hover:text-white">
          <Play size={11} /> Try
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{detail}</p>
    </div>
  );
}

function ConfigRow({label, value, copyable}: {label: string; value: string; copyable?: boolean}) {
  return (
    <div className="surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        {copyable ? <CopyIcon value={value} label={label} /> : null}
      </div>
      <p className="mt-2 break-all font-mono text-sm text-white">{value}</p>
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
    <button type="button" onClick={copy} className="inline-flex items-center gap-3 rounded-lg border border-white/[0.1] bg-[#050813] px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-plasma/40">
      <span className="text-slate-500">$</span>
      {text}
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
