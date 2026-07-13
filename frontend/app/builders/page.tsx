import {useEffect, useState} from "react";
import {ArrowRight, BadgeCheck, Store, WalletCards} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGet, type AppSnapshot} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {navigateTo} from "@/lib/router";

type Builder = {
  address: string;
  services: AppSnapshot["services"];
  serviceCount: number;
  settledPayments: number;
  grossVolumeUsdc: number;
  platformFeesUsdc: number;
  featured: boolean;
  firstPublishedAt?: string | null;
};

export default function BuildersPage() {
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiGet<{builders: Builder[]}>("/api/public/builders")
      .then((data) => {
        if (!active) return;
        setBuilders(data.builders);
        setError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Builder directory unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const services = builders.reduce((sum, builder) => sum + builder.serviceCount, 0);
  const volume = builders.reduce((sum, builder) => sum + builder.grossVolumeUsdc, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="Builder directory"
        title="Public API builders on Nexora"
        description="Discover builders publishing x402 services, paid APIs, and agent-ready tools across the Nexora marketplace."
        action={<button className="action-button" onClick={() => navigateTo("/marketplace/new")}>Publish API <ArrowRight size={16} /></button>}
      />

      {error ? <p className="rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{error}</p> : null}

      {loading ? (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="panel"><div className="shimmer h-10 w-10 rounded-lg" /><div className="shimmer mt-4 h-3 w-20 rounded" /><div className="shimmer mt-3 h-7 w-24 rounded" /></div>)}
          </section>
          <section className="grid gap-5 lg:grid-cols-2">
            {[0, 1].map((item) => <div key={item} className="panel"><div className="shimmer h-40 w-full rounded-xl" /></div>)}
          </section>
        </>
      ) : (
        <>
      <section className="grid gap-4 md:grid-cols-3">
        <Metric icon={<WalletCards size={18} />} label="Builders" value={builders.length} />
        <Metric icon={<Store size={18} />} label="Services" value={services} />
        <Metric icon={<BadgeCheck size={18} />} label="Settled volume" value={`$${volume.toFixed(2)}`} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        {builders.map((builder) => (
          <article key={builder.address} className="panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">{shortAddress(builder.address)}</h2>
                  {builder.featured ? <span className="status-pill border-mint/25 bg-mint/10 text-mint">Featured</span> : null}
                </div>
                <p className="mt-2 break-all font-mono text-xs text-slate-500">{builder.address}</p>
              </div>
              {builder.services[0]?.id ? (
                <button className="secondary-button min-h-10 px-4 py-2 text-sm" onClick={() => navigateTo(`/marketplace/services/${encodeURIComponent(builder.services[0].id)}`)}>
                  View service
                </button>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Info label="Services" value={String(builder.serviceCount)} />
              <Info label="Payments" value={String(builder.settledPayments)} />
              <Info label="Volume" value={`$${builder.grossVolumeUsdc.toFixed(2)}`} />
            </div>

            <div className="mt-5 grid gap-2">
              {builder.services.slice(0, 3).map((service) => (
                <button key={service.id} className="surface px-4 py-3 text-left transition hover:border-plasma/30" onClick={() => navigateTo(`/marketplace/services/${encodeURIComponent(service.id)}`)}>
                  <p className="font-medium text-white">{service.name}</p>
                  <p className="mt-1 text-sm text-slate-400">{service.pricePerUnitUsdc} USDC per call · {service.manifest.kind.replaceAll("_", " ")}</p>
                </button>
              ))}
            </div>
          </article>
        ))}
      </section>

      {builders.length === 0 && !error ? (
        <div className="panel">
          <p className="text-sm text-slate-400">No public builders yet. Publish the first x402 API from the marketplace console.</p>
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}

function Metric({icon, label, value}: {icon: React.ReactNode; label: string; value: string | number}) {
  return (
    <div className="panel">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">{icon}</div>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function Info({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 font-semibold text-white">{value}</p>
    </div>
  );
}
