import {useEffect, useMemo, useState} from "react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {Activity, ArrowRight, BriefcaseBusiness, Check, CircleDollarSign, Code2, Copy, Crown, ExternalLink, Landmark, Play, Plus, RefreshCw, Rocket, Store, X} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {AgentAvatar} from "@/components/AgentAvatar";
import {apiGet, apiUrlFor} from "@/lib/api";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {navigateTo} from "@/lib/router";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Snapshot = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>;
type Service = Snapshot["services"][number];
type Payment = Snapshot["payments"][number];

type DeveloperDashboard = {
  address: string;
  services: Service[];
  payments: Payment[];
  summary: {
    publishedServices: number;
    totalExecutions: number;
    grossRevenueUsdc: number;
    platformRevenueUsdc: number;
    netRevenueUsdc: number;
    activeEscrows: number;
  };
};

const RANGES: Array<{key: string; label: string; days: number | null}> = [
  {key: "7d", label: "7D", days: 7},
  {key: "30d", label: "30D", days: 30},
  {key: "all", label: "All", days: null}
];

const endpoints: Array<{method: "GET" | "POST"; path: string}> = [
  {method: "GET", path: "/x402/supported"},
  {method: "POST", path: "/x402/verify"},
  {method: "POST", path: "/x402/settle"}
];

function paymentNet(payment: Payment) {
  return payment.publisherNetUsdc ?? payment.amountUsdc - (payment.platformFeeUsdc ?? 0);
}
function paymentGross(payment: Payment) {
  return payment.grossAmountUsdc ?? payment.amountUsdc;
}

export default function DeveloperDashboardPage() {
  const {address} = useAccount();
  const [dashboard, setDashboard] = useState<DeveloperDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState("30d");
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const operator = address ?? "";

  async function load() {
    if (!operator) {
      setLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const result = await apiGet<DeveloperDashboard>(`/api/developers/${encodeURIComponent(operator)}/dashboard`);
      setDashboard(result);
    } catch {
      setDashboard(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator]);

  const services = dashboard?.services ?? [];
  const allPayments = dashboard?.payments ?? [];
  const activeEscrows = dashboard?.summary.activeEscrows ?? 0;

  const rangeDays = RANGES.find((item) => item.key === range)?.days ?? null;
  const cutoff = rangeDays ? Date.now() - rangeDays * 86_400_000 : 0;

  const settled = useMemo(
    () => allPayments.filter((payment) => payment.status === "settled" && Date.parse(payment.createdAt) >= cutoff),
    [allPayments, cutoff]
  );

  const gross = settled.reduce((total, payment) => total + paymentGross(payment), 0);
  const net = settled.reduce((total, payment) => total + paymentNet(payment), 0);
  const fee = gross - net;
  const feePct = gross > 0 ? (fee / gross) * 100 : 0;

  const serviceRows = useMemo(() => {
    const rows = services.map((service) => {
      const rowsForService = settled.filter((payment) => payment.serviceId === service.id);
      const g = rowsForService.reduce((total, payment) => total + paymentGross(payment), 0);
      const n = rowsForService.reduce((total, payment) => total + paymentNet(payment), 0);
      const lastAt = rowsForService.reduce((latest, payment) => Math.max(latest, Date.parse(payment.createdAt)), 0);
      return {service, executions: rowsForService.length, gross: g, net: n, lastAt};
    });
    return rows.sort((a, b) => b.gross - a.gross);
  }, [services, settled]);

  const totalGrossForShare = serviceRows.reduce((total, row) => total + row.gross, 0);
  const topPerformer = serviceRows.find((row) => row.gross > 0) ?? null;

  const dailySeries = useMemo(() => buildDailySeries(settled, rangeDays ?? 30), [settled, rangeDays]);
  const peak = Math.max(...dailySeries.map((day) => day.net), 0.0001);

  const feed = useMemo(() => {
    const filtered = serviceFilter ? settled.filter((payment) => payment.serviceId === serviceFilter) : settled;
    return [...filtered].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [settled, serviceFilter]);
  const todayCount = settled.filter((payment) => Date.parse(payment.createdAt) >= startOfToday()).length;
  const todayNet = settled.filter((payment) => Date.parse(payment.createdAt) >= startOfToday()).reduce((total, payment) => total + paymentNet(payment), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Developer dashboard"
        title="Hosted x402 revenue"
        description="Track published APIs, marketplace revenue, facilitator fees, and active escrows."
        action={
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => void load()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh</button>
            <button className="secondary-button" onClick={() => navigateTo("/x402/playground")}>Playground</button>
            <button className="action-button" onClick={() => navigateTo("/marketplace/new")}>Publish API <ArrowRight size={16} /></button>
          </div>
        }
      />

      {/* Range filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-white/[0.1] bg-white/[0.03] p-1">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setRange(item.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${range === item.key ? "bg-plasma/20 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">Showing {rangeDays ? `last ${rangeDays} days` : "all time"}</span>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={Store} label="Services" value={services.length} loading={loading} />
        <StatMetric variant="panel" icon={Activity} label="Executions" value={settled.length} loading={loading} />
        <StatMetric variant="panel" icon={CircleDollarSign} label="Gross USDC" value={gross} prefix="$" decimals={2} loading={loading} />
        <StatMetric variant="panel" icon={Landmark} label="Net to you" value={net} prefix="$" decimals={2} loading={loading} accent />
      </section>

      {/* Revenue chart + identity/split */}
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Net revenue</p>
              <h2 className="mt-1 text-xl font-bold text-white">Daily earnings</h2>
            </div>
            <span className="text-xs text-slate-500">Today: <b className="text-white">{todayCount}</b> exec · <b className="text-mint">${todayNet.toFixed(2)}</b></span>
          </div>
          {loading ? (
            <div className="shimmer mt-5 h-40 w-full rounded-xl" />
          ) : dailySeries.every((day) => day.net === 0) ? (
            <p className="mt-8 text-center text-sm text-slate-500">No settled revenue in this range yet.</p>
          ) : (
            <div className="mt-5 flex h-40 items-end gap-1">
              {dailySeries.map((day) => (
                <div key={day.label} className="group relative flex flex-1 flex-col items-center justify-end">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-plasma/60 to-mint/80 transition-all duration-200 group-hover:from-plasma group-hover:to-mint"
                    style={{height: `${Math.max(2, (day.net / peak) * 100)}%`}}
                  />
                  <div className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded-md border border-white/10 bg-[#0c0f18] px-2 py-1 text-[11px] text-white shadow-lg group-hover:block">
                    {day.label} · ${day.net.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <p className="section-kicker">Operator</p>
          {address ? (
            <div className="mt-4 flex items-center gap-3">
              <AgentAvatar seed={address} label={null} size={40} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-mono text-sm text-white">{shortAddress(address)} <CopyIcon value={address} label="address" /></p>
                <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/address/${address}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-orchid">Explorer <ExternalLink size={11} /></a>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">Connect your wallet to view your developer revenue.</p>
          )}

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span>Revenue split</span>
              <span className="text-slate-400">fee ~{feePct.toFixed(1)}%</span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full bg-gradient-to-r from-mint to-emerald-500" style={{width: `${gross > 0 ? (net / gross) * 100 : 0}%`}} />
              <div className="h-full bg-plasma/60" style={{width: `${gross > 0 ? (fee / gross) * 100 : 0}%`}} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-mint"><span className="h-2 w-2 rounded-full bg-mint" /> Net ${net.toFixed(2)}</span>
              <span className="flex items-center gap-1.5 text-orchid"><span className="h-2 w-2 rounded-full bg-plasma/60" /> Fee ${fee.toFixed(2)}</span>
            </div>
          </div>

          <button onClick={() => navigateTo("/escrow")} className="surface mt-5 flex w-full items-center justify-between px-4 py-3 text-sm transition hover:border-plasma/30">
            <span className="flex items-center gap-2 text-slate-300"><BriefcaseBusiness size={15} className="text-orchid" /> Active escrows</span>
            <b className="text-white">{activeEscrows}</b>
          </button>
        </div>
      </section>

      {/* Top performer */}
      {!loading && topPerformer ? (
        <section className="panel relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(245,158,11,0.08),transparent_45%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber/30 bg-amber/10 text-amber"><Crown size={22} /></span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber">Top performer</p>
                <p className="truncate text-lg font-bold text-white">{topPerformer.service.name}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-5 text-sm">
              <div><p className="text-slate-500">Net</p><p className="font-bold text-mint">${topPerformer.net.toFixed(2)}</p></div>
              <div><p className="text-slate-500">Executions</p><p className="font-bold text-white">{topPerformer.executions}</p></div>
              <div><p className="text-slate-500">Share</p><p className="font-bold text-white">{totalGrossForShare > 0 ? ((topPerformer.gross / totalGrossForShare) * 100).toFixed(0) : 0}%</p></div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Per-service revenue */}
      <section className="panel">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Your services</p>
            <h2 className="mt-1 text-xl font-bold text-white">Revenue by service</h2>
          </div>
          <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => navigateTo("/marketplace/new")}><Plus size={15} /> Publish</button>
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((index) => <div key={index} className="shimmer h-16 w-full rounded-xl" />)}</div>
        ) : serviceRows.length === 0 ? (
          address ? (
            <GetStarted />
          ) : (
            <EmptyState icon={<Store size={24} />} title="Connect your wallet" copy="Connect a wallet to see your published services and revenue." className="border-0 bg-transparent p-0 shadow-none" />
          )
        ) : (
          <div className="grid gap-2">
            {serviceRows.map((row) => {
              const share = totalGrossForShare > 0 ? (row.gross / totalGrossForShare) * 100 : 0;
              const active = serviceFilter === row.service.id;
              return (
                <div key={row.service.id} className={`surface px-4 py-3 transition ${active ? "border-plasma/40" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setServiceFilter(active ? null : row.service.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <AgentAvatar seed={row.service.id} label={row.service.name} size={34} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-white">{row.service.name}</p>
                          <span className={`h-1.5 w-1.5 rounded-full ${row.service.active ? "bg-mint" : "bg-slate-600"}`} />
                          {row.service.featured ? <span className="rounded-full border border-amber/25 bg-amber/10 px-1.5 py-0.5 text-[10px] font-bold text-amber">Featured</span> : null}
                          {!row.service.chainServiceId ? <span className="rounded-full border border-white/[0.12] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">Off-chain</span> : null}
                        </div>
                        <p className="text-xs text-slate-500">{row.executions} exec · {row.lastAt > 0 ? `last ${timeAgo(new Date(row.lastAt).toISOString())}` : "no earnings yet"}</p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2 text-right">
                      <div>
                        <p className="font-bold text-mint">${row.net.toFixed(2)}</p>
                        <p className="text-[11px] text-slate-500">{share.toFixed(0)}% · ${row.gross.toFixed(2)} gross</p>
                      </div>
                      <CopyIcon value={row.service.id} label="service id" />
                      <button type="button" onClick={() => navigateTo(`/marketplace/services/${encodeURIComponent(row.service.id)}`)} className="text-slate-500 transition hover:text-orchid" aria-label="View service page"><ExternalLink size={14} /></button>
                    </div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r from-plasma to-mint" style={{width: `${share}%`}} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent executions */}
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Activity</p>
            <h2 className="mt-1 text-xl font-bold text-white">Recent executions</h2>
          </div>
          {serviceFilter ? (
            <button type="button" onClick={() => setServiceFilter(null)} className="inline-flex items-center gap-1.5 rounded-full border border-plasma/30 bg-plasma/10 px-3 py-1 text-xs font-semibold text-orchid">
              {services.find((service) => service.id === serviceFilter)?.name ?? "Filtered"} <X size={12} />
            </button>
          ) : null}
        </div>
        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((index) => <div key={index} className="shimmer h-12 w-full rounded-xl" />)}</div>
          ) : feed.length === 0 ? (
            <p className="text-sm text-slate-400">No paid executions in this range. Settled marketplace payments will appear here.</p>
          ) : (
            <ol className="relative ml-1.5 border-l border-white/[0.1]">
              {feed.slice(0, 8).map((payment) => (
                <li key={payment.id} className="relative mb-3 pl-6 last:mb-0">
                  <span className="absolute -left-[7px] top-3.5 h-3 w-3 rounded-full border-2 border-[#12101b] bg-mint" />
                  <div className="surface flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{payment.serviceName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>{timeAgo(payment.createdAt)}</span>
                        {payment.payer ? <><span className="text-slate-700">·</span><span className="font-mono">{shortAddress(payment.payer)}</span></> : null}
                        {payment.txHash ? (
                          <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${payment.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-orchid transition hover:text-white">View tx <ExternalLink size={11} /></a>
                        ) : null}
                      </p>
                    </div>
                    <span className="font-bold text-white">${paymentNet(payment).toFixed(2)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Integrate callout */}
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">x402 facilitator</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Integrate Nexora directly</h2>
            <p className="muted-copy mt-3 max-w-2xl">External APIs can return x402 payment requirements, then call Nexora to verify and settle a signed USDC authorization on Arc.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => navigateTo("/x402/playground")}><Play size={15} /> Playground</button>
            <button className="action-button" onClick={() => navigateTo("/docs/api")}><Code2 size={15} /> Integration guide</button>
          </div>
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-3">
          {endpoints.map((endpoint) => (
            <div key={endpoint.path} className="surface flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${endpoint.method === "GET" ? "bg-cyan/15 text-cyan" : "bg-plasma/15 text-orchid"}`}>{endpoint.method}</span>
                <span className="truncate font-mono text-sm text-white">{endpoint.path}</span>
              </div>
              <CopyIcon value={apiUrlFor(endpoint.path)} label="endpoint URL" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function GetStarted() {
  const steps = [
    {icon: Plus, title: "Publish a service", copy: "Define an x402 API priced per request in USDC.", cta: "Publish API", href: "/marketplace/new"},
    {icon: Code2, title: "Integrate the SDK", copy: "Protect your route with the Nexora middleware.", cta: "Read docs", href: "/docs/api"},
    {icon: Rocket, title: "Earn USDC", copy: "Settled payments and revenue appear here.", cta: "Open playground", href: "/x402/playground"}
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={step.title} className="surface flex flex-col p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-plasma/30 bg-plasma/10 text-xs font-bold text-orchid">{index + 1}</span>
              <Icon size={16} className="text-orchid" />
            </div>
            <p className="mt-3 font-semibold text-white">{step.title}</p>
            <p className="mt-1 flex-1 text-sm leading-6 text-slate-400">{step.copy}</p>
            <button onClick={() => navigateTo(step.href)} className="secondary-button mt-3 w-full justify-center text-sm">{step.cta}</button>
          </div>
        );
      })}
    </div>
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

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function buildDailySeries(payments: Payment[], days: number) {
  const span = Math.min(Math.max(days, 7), 30);
  const buckets: Array<{label: string; net: number}> = [];
  const dayMs = 86_400_000;
  const todayStart = startOfToday();
  for (let i = span - 1; i >= 0; i--) {
    const dayStart = todayStart - i * dayMs;
    const date = new Date(dayStart);
    buckets.push({label: `${date.getMonth() + 1}/${date.getDate()}`, net: 0});
  }
  for (const payment of payments) {
    const t = Date.parse(payment.createdAt);
    const index = span - 1 - Math.floor((todayStart - new Date(t).setHours(0, 0, 0, 0)) / dayMs);
    if (index >= 0 && index < span) buckets[index].net += paymentNet(payment);
  }
  return buckets;
}
