import {useEffect, useState} from "react";
import {ArrowLeft, Code2, ExternalLink, ShieldCheck, Sparkles} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGet} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {navigateTo} from "@/lib/router";
import type {AppSnapshot} from "@/lib/api";

type Service = AppSnapshot["services"][number];

export default function MarketplaceServicePage({serviceId}: {serviceId: string}) {
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiGet<{service: Service}>(`/api/marketplace/services/${encodeURIComponent(serviceId)}`)
      .then((data) => {
        setService(data.service);
        setError("");
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Service not found"));
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

      {service ? (
        <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="panel">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">{formatKind(service.manifest.kind)}</span>
              <span className="status-pill">v{service.manifest.version}</span>
              <span className="status-pill">{service.active ? "Active" : "Inactive"}</span>
            </div>
            <h2 className="text-2xl font-semibold text-white">{service.name}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">{service.manifest.description}</p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Info label="Price" value={`${service.pricePerUnitUsdc} USDC`} />
              <Info label="Platform fee" value={`${(service.manifest.platformFeeBps / 100).toFixed(2)}%`} />
              <Info label="Ledger service" value={service.chainServiceId ? String(service.chainServiceId) : "Off-chain"} />
            </div>

            <div className="mt-6">
              <p className="text-sm font-medium text-white">Inputs</p>
              <div className="mt-3 grid gap-2">
                {service.manifest.inputSchema.length > 0 ? service.manifest.inputSchema.map((input) => (
                  <div key={input.name} className="surface flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="text-slate-300">{input.label}</span>
                    <span className="text-slate-500">{input.type}{input.required ? " · required" : ""}</span>
                  </div>
                )) : <p className="surface p-4 text-sm text-slate-400">This service does not require user input.</p>}
              </div>
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
            </div>

            <div className="panel">
              <div className="flex items-center gap-2 text-base font-medium text-white">
                <Sparkles size={18} className="text-mint" />
                Purchase flow
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                {["Choose an agent wallet", "Authorize x402 payment", "Confirm USDC settlement", "Receive structured result"].map((item) => (
                  <div key={item} className="surface px-4 py-3 text-slate-300">{item}</div>
                ))}
              </div>
              <button className="action-button mt-5 w-full" onClick={() => navigateTo("/marketplace")}>
                Try in marketplace
              </button>
            </div>

            {service.txHash ? (
              <a className="secondary-button w-full justify-center" href={service.txHash} target="_blank" rel="noreferrer">
                View publish transaction <ExternalLink size={15} />
              </a>
            ) : null}

            <div className="panel">
              <p className="section-kicker">Payment config</p>
              <div className="mt-4 grid gap-2">
                <Info label="Network" value="Arc Testnet" />
                <Info label="Asset" value="USDC" />
                <Info label="Endpoint hash" value={service.endpointHash} />
              </div>
            </div>
          </aside>
        </section>
      ) : null}
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

function formatKind(kind: string) {
  return kind.replaceAll("_", " ");
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

function CodeBlock({code}: {code: string}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.1] bg-[#050813]">
      <div className="border-b border-white/[0.08] px-4 py-2 text-xs text-slate-500">SDK example</div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6 text-slate-200"><code>{code}</code></pre>
    </div>
  );
}
