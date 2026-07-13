import {useEffect, useState} from "react";
import {ArrowLeft, CheckCircle2, Code2, ExternalLink, Layers, ReceiptText, ShieldCheck, Sparkles} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGet} from "@/lib/api";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {navigateTo} from "@/lib/router";
import {formatCategory, formatKind, sampleInputForService, serviceCategory, serviceReadiness} from "@/lib/marketplace";
import type {AppSnapshot} from "@/lib/api";

type Service = AppSnapshot["services"][number];

export default function MarketplaceServicePage({serviceId}: {serviceId: string}) {
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiGet<{service: Service}>(`/api/marketplace/services/${encodeURIComponent(serviceId)}`)
      .then((data) => {
        if (!active) return;
        setService(data.service);
        setError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setService(null);
        setError(requestError instanceof Error ? requestError.message : "Service not found");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serviceId]);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Public API"
        title={service?.name ?? "Marketplace service"}
        description={service?.manifest.description ?? "Review pricing, manifest details, publisher reputation inputs, and purchase readiness."}
        action={<button className="secondary-button" onClick={() => navigateTo("/marketplace")}><ArrowLeft size={16} /> Marketplace</button>}
      />

      {error ? <p className="rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{error}</p> : null}

      {loading && !service ? (
        <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="panel space-y-4">
            <div className="shimmer h-6 w-48 rounded" />
            <div className="shimmer h-8 w-64 rounded" />
            <div className="shimmer h-4 w-full rounded" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((item) => <div key={item} className="shimmer h-16 rounded-xl" />)}
            </div>
            <div className="shimmer h-40 w-full rounded-xl" />
          </div>
          <aside className="space-y-5">
            {[0, 1, 2].map((item) => <div key={item} className="shimmer h-40 w-full rounded-xl" />)}
          </aside>
        </section>
      ) : null}

      {service ? (
        <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="panel">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="status-pill">{formatCategory(serviceCategory(service))}</span>
              <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">{formatKind(service.manifest.kind)}</span>
              <span className="status-pill">v{service.manifest.version}</span>
              <span className="status-pill">{service.active ? "Active" : "Inactive"}</span>
              {service.chainServiceId ? (
                <span className="status-pill border-mint/25 bg-mint/10 text-mint">
                  <CheckCircle2 size={13} />
                  On-chain ready
                </span>
              ) : null}
            </div>
            <h2 className="text-2xl font-semibold text-white">{service.name}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">{service.manifest.description}</p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Price" value={`${service.pricePerUnitUsdc} USDC`} />
              <Info label="Ledger service" value={service.chainServiceId ? `#${service.chainServiceId}` : "Not published"} />
              <Info label="Receipt" value={service.chainServiceId ? "Memo-backed" : "After publish"} />
              <Info label="Platform fee" value={`${(service.manifest.platformFeeBps / 100).toFixed(2)}%`} />
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <ReadinessMetric label="Settlement" value={service.chainServiceId ? "Arc ledger" : "Publish required"} tone={service.chainServiceId ? "mint" : "amber"} />
              <ReadinessMetric label="Trust" value={service.trust ? `${service.trust.score}/100 ${service.trust.tier}` : serviceReadiness(service).label} tone={service.trust && service.trust.score >= 60 ? "mint" : service.trust && service.trust.score >= 40 ? "amber" : serviceReadiness(service).tone} />
              <ReadinessMetric label="Schema" value={`${service.manifest.inputSchema.length} input / ${service.manifest.outputSchema.length} outputs`} tone="slate" />
            </div>

            {service.trust ? <TrustScorePanel trust={service.trust} /> : null}

            <div className="mt-6">
              <p className="text-sm font-medium text-white">Inputs</p>
              <div className="mt-3 grid gap-2">
                {service.manifest.inputSchema.length > 0 ? service.manifest.inputSchema.map((input) => (
                  <div key={input.name} className="surface grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto]">
                    <div>
                      <span className="font-medium text-slate-200">{input.label}</span>
                      <p className="mt-1 break-all text-xs text-slate-500">{input.name}</p>
                    </div>
                    <span className="text-slate-500">{input.type}{input.required ? " · required" : ""}</span>
                  </div>
                )) : <p className="surface p-4 text-sm text-slate-400">This service does not require user input.</p>}
              </div>
              {service.manifest.inputSchema.length > 0 ? (
                <div className="surface mt-3 px-4 py-3 text-sm">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Sample input</p>
                  <p className="mt-2 break-words font-medium text-white">{sampleInputForService(service)}</p>
                </div>
              ) : null}
            </div>

            <div className="mt-6">
              <p className="text-sm font-medium text-white">Outputs</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {service.manifest.outputSchema.map((item) => <span key={item} className="status-pill">{item}</span>)}
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Code2 size={16} className="text-orchid" />
                API integration
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Builders can protect a compatible endpoint with the Nexora x402 SDK and use this service manifest as the paid route definition.
              </p>
              <CodeBlock code={serviceSnippet(service)} />
            </div>
          </div>

          <aside className="space-y-5">
            <div className="panel">
              <div className="flex items-center gap-2 text-sm uppercase tracking-[0.16em] text-orchid">
                <ShieldCheck size={15} />
                Publisher
              </div>
              <p className="mt-4 break-all font-mono text-white">{service.publisherAddress}</p>
              <p className="mt-2 text-sm text-slate-400">{shortAddress(service.publisherAddress)}</p>
              <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/address/${service.publisherAddress}`} target="_blank" rel="noreferrer" className="secondary-button mt-4 min-h-10 w-full justify-center px-4 py-2 text-sm">
                View publisher <ExternalLink size={14} />
              </a>
            </div>

            {service.trust ? (
              <div className="panel">
                <p className="section-kicker">Trust inputs</p>
                <div className="mt-4 grid gap-2">
                  <Info label="Settled purchases" value={String(service.trust.settledPayments)} />
                  <Info label="Unique buyers" value={String(service.trust.uniqueBuyers)} />
                  <Info label="Publisher sales" value={String(service.trust.publisherSales)} />
                  <Info label="Failed attempts" value={String(service.trust.failedPayments)} />
                </div>
              </div>
            ) : null}

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-medium text-white">
                <Layers size={18} className="text-mint" />
                Settlement route
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <CheckRow label="Published on x402 ledger" active={Boolean(service.chainServiceId)} />
                <CheckRow label="Arc Testnet USDC settlement" active={Boolean(service.chainServiceId)} />
                <CheckRow label="Structured memo receipt" active={Boolean(service.chainServiceId)} />
                <CheckRow label="Publisher address visible" active={Boolean(service.publisherAddress)} />
              </div>
              {service.txHash ? (
                <a className="secondary-button mt-5 min-h-10 w-full justify-center px-4 py-2 text-sm" href={explorerTx(service.txHash)} target="_blank" rel="noreferrer">
                  Publish transaction <ExternalLink size={14} />
                </a>
              ) : null}
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-medium text-white">
                <Sparkles size={18} className="text-mint" />
                Purchase flow
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                {["Choose or fund an agent wallet", "Select memo privacy", "Authorize x402 payment", "Receive receipt and result"].map((item) => (
                  <div key={item} className="surface px-4 py-3 text-slate-300">{item}</div>
                ))}
              </div>
              <button className="action-button mt-5 w-full" onClick={() => navigateTo("/marketplace")}>
                Try in marketplace
              </button>
            </div>

            <div className="panel">
              <p className="section-kicker">Payment config</p>
              <div className="mt-4 grid gap-2">
                <Info label="Network" value="Arc Testnet" />
                <Info label="Asset" value="USDC" />
                <Info label="Endpoint hash" value={service.endpointHash} />
                <Info label="Revenue route" value="Publisher net + treasury fee" />
              </div>
            </div>
          </aside>
        </section>
      ) : null}
    </div>
  );
}

function TrustScorePanel({trust}: {trust: NonNullable<Service["trust"]>}) {
  const tone = trust.score >= 78 ? "text-mint" : trust.score >= 60 ? "text-cyan" : trust.score >= 40 ? "text-amber" : "text-slate-300";
  return (
    <div className="mt-6 rounded-xl border border-white/[0.1] bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Service reputation</p>
          <h3 className={`mt-2 text-2xl font-bold capitalize ${tone}`}>{trust.tier} · {trust.score}/100</h3>
        </div>
        <span className="status-pill border-mint/25 bg-mint/10 text-mint">{trust.onchainReady ? "On-chain route" : "Needs ledger route"}</span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
        <Info label="Volume" value={`${trust.totalVolumeUsdc.toFixed(2)} USDC`} />
        <Info label="Receipts" value={`${Math.round(trust.receiptCoverage * 100)}%`} />
        <Info label="Buyers" value={String(trust.uniqueBuyers)} />
        <Info label="Settled" value={String(trust.settledPayments)} />
      </div>
      {trust.reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {trust.reasons.map((reason) => <span key={reason} className="status-pill">{reason}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function ReadinessMetric({label, value, tone}: {label: string; value: string; tone: "mint" | "amber" | "slate"}) {
  const toneClass = tone === "mint" ? "text-mint" : tone === "amber" ? "text-amber" : "text-slate-300";
  return (
    <div className="surface flex items-center gap-3 px-4 py-3">
      {label === "Settlement" ? <Layers size={16} className={toneClass} /> : label === "Health" ? <CheckCircle2 size={16} className={toneClass} /> : <ReceiptText size={16} className={toneClass} />}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
        <p className={`mt-1 truncate text-sm font-semibold ${toneClass}`}>{value}</p>
      </div>
    </div>
  );
}

function CheckRow({label, active}: {label: string; active: boolean}) {
  return (
    <div className="surface flex items-center gap-2 px-4 py-3 text-slate-300">
      <CheckCircle2 size={15} className={active ? "text-mint" : "text-amber"} />
      <span>{label}</span>
    </div>
  );
}

function Info({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 font-medium text-white">{value}</p>
    </div>
  );
}

function serviceSnippet(service: Service) {
  const inputExample = service.manifest.inputSchema[0]?.name ?? "input";
  return `import { nexoraX402 } from "@nexorafi/x402";

app.post(
  "/api/${service.endpointHash}",
  nexoraX402({
    facilitatorUrl: "https://nexorafibackend.vercel.app",
    payTo: "${service.publisherAddress}",
    asset: "0x3600000000000000000000000000000000000000",
    price: "${service.pricePerUnitUsdc}",
    network: "arc-testnet",
    resource: "${service.endpointHash}",
    description: "${escapeSnippet(service.name)}"
  }),
  async (req, res) => {
    const ${inputExample} = req.body.${inputExample};
    res.json({ ok: true, ${inputExample} });
  }
);`;
}

function escapeSnippet(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function explorerTx(txHash: string) {
  if (txHash.startsWith("http://") || txHash.startsWith("https://")) return txHash;
  return `${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

function CodeBlock({code}: {code: string}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.1] bg-[#050813]">
      <div className="border-b border-white/[0.08] px-4 py-2 text-xs text-slate-500">SDK example</div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-slate-200"><code>{code}</code></pre>
    </div>
  );
}
