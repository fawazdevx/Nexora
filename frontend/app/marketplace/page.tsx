import {useMemo, useState} from "react";
import {Activity, ArrowUpRight, BadgeCheck, CalendarCheck, CheckCircle2, ExternalLink, FileSearch, GitFork, Globe, Layers, MessageSquareText, Plus, ReceiptText, Route, Search, ShieldCheck, Sparkles, Star, Store, Twitter, Wallet, Loader2, type LucideIcon} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {AgentPicker} from "@/components/AgentPicker";
import {AgentAvatar} from "@/components/AgentAvatar";
import {apiPost} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {settleX402Request, type NexoraStructuredMemo} from "@/lib/contracts";
import {executionArgs, formatCategory, formatKind, sampleInputForService, serviceCategory, serviceInputLabel, serviceInputPlaceholder, serviceReadiness, type MarketplaceCategoryKey} from "@/lib/marketplace";

type Service = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["services"][number];
type SortKey = "featured" | "priceAsc" | "priceDesc" | "name";
type PrivacyScope = "public" | "selective" | "private";

const PRIVACY_OPTIONS: Array<{value: PrivacyScope; label: string; copy: string}> = [
  {value: "selective", label: "Selective", copy: "Budget, policy, and intent only"},
  {value: "private", label: "Private", copy: "Scope and timestamp only"},
  {value: "public", label: "Public", copy: "Full purchase metadata"}
];

const CATEGORIES: Array<{key: MarketplaceCategoryKey; label: string; icon: LucideIcon}> = [
  {key: "all", label: "All", icon: Store},
  {key: "builder", label: "Builder", icon: FileSearch},
  {key: "security", label: "Security", icon: ShieldCheck},
  {key: "wallet", label: "Wallet", icon: Wallet},
  {key: "content", label: "Content", icon: MessageSquareText},
  {key: "stablecoin", label: "Stablecoin", icon: Route}
];

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

function kindIcon(kind: string) {
  if (kind.includes("website")) return Globe;
  if (kind.includes("github")) return GitFork;
  if (kind.includes("x_account") || kind.includes("twitter")) return Twitter;
  if (kind.includes("meeting")) return CalendarCheck;
  if (kind.includes("domain")) return BadgeCheck;
  if (kind.includes("social")) return MessageSquareText;
  if (kind.includes("route")) return Route;
  if (kind.includes("launch") || kind.includes("integration") || kind.includes("builder")) return FileSearch;
  return ShieldCheck;
}

function txToast(title: string, hash: string) {
  const href = `${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
  return (
    <span>
      {title} ·{" "}
      <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-mint underline-offset-2 hover:underline">
        View tx
      </a>
    </span>
  );
}

export default function MarketplacePage() {
  const {address, isConnected} = useAccount();
  const [serviceInputs, setServiceInputs] = useState<Record<string, string>>({});
  const [serviceResults, setServiceResults] = useState<Record<string, unknown>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [privacyScope, setPrivacyScope] = useState<PrivacyScope>("selective");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MarketplaceCategoryKey>("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("featured");
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const services = snapshot.data?.services ?? [];
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];

  const kinds = useMemo(() => Array.from(new Set(services.map((service) => service.manifest.kind))), [services]);
  const settledVolume = snapshot.data?.stats.usdcSettled ?? 0;
  const onchainServices = services.filter((service) => service.chainServiceId).length;
  const featuredServices = services.filter((service) => service.featured).length;

  const visibleServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = services.filter((service) => {
      if (categoryFilter !== "all" && serviceCategory(service) !== categoryFilter) return false;
      if (kindFilter !== "all" && service.manifest.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        service.name.toLowerCase().includes(q) ||
        service.manifest.description.toLowerCase().includes(q) ||
        service.manifest.kind.toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "priceAsc") return Number(a.pricePerUnitUsdc) - Number(b.pricePerUnitUsdc);
      if (sort === "priceDesc") return Number(b.pricePerUnitUsdc) - Number(a.pricePerUnitUsdc);
      if (sort === "name") return a.name.localeCompare(b.name);
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    });
    return sorted;
  }, [services, query, categoryFilter, kindFilter, sort]);

  async function purchase(service: Service) {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before purchasing an x402 service.");
      return;
    }
    if (!selectedAgent) {
      toast.error("Create an agent wallet before purchasing an API.");
      return;
    }
    if (!service.chainServiceId) {
      toast.error("This service must be published on the Arc ledger before purchase.");
      return;
    }
    setBusyId(service.id);
    const toastId = toast.loading(`Authorizing x402 payment for ${service.name}…`);
    try {
      const requestHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}` as `0x${string}`;
      const result = await apiPost<{authorizationId: string; status: string; settlement: {amountUsdc: number; memo?: NexoraStructuredMemo | null}}>("/api/x402/authorize", {
        serviceId: service.id,
        payer: address,
        agentId: selectedAgent.id,
        privacyScope,
        requestHash,
        units: 1
      });
      let txHash: string | null = null;
      let memoSettlement: Awaited<ReturnType<typeof settleX402Request>> | null = null;
      const canUseCircleAgentSettlement = Boolean(selectedAgent.circleWalletId);
      if (!canUseCircleAgentSettlement) {
        toast.loading(`Approve ${result.settlement.amountUsdc} USDC and confirm settlement…`, {id: toastId});
        memoSettlement = await settleX402Request({
          chainServiceId: service.chainServiceId,
          requestHash,
          payer: address,
          units: 1,
          amountUsdc: String(result.settlement.amountUsdc),
          memo: result.settlement.memo ?? null
        });
        txHash = memoSettlement.settleHash;
      } else if (canUseCircleAgentSettlement) {
        toast.loading(`Agent wallet settling ${service.name} on Arc with memo receipt…`, {id: toastId});
      }
      const settlement = await apiPost<{status: string; txHash?: string | null}>("/api/x402/settle", {
        authorizationId: result.authorizationId,
        agentId: canUseCircleAgentSettlement ? selectedAgent.id : undefined,
        txHash,
        memo: memoSettlement?.memo ?? result.settlement.memo ?? null,
        targetContract: memoSettlement?.targetContract,
        callDataHash: memoSettlement?.callDataHash,
        memoIndex: memoSettlement?.memoIndex
      });
      if (settlement.status === "pending_settlement") {
        await snapshot.refetch();
        toast.success(`Agent settlement is pending on Circle. Execute ${service.name} after the Arc transaction confirms.`, {id: toastId});
        return;
      }
      toast.loading(`Executing ${service.name}…`, {id: toastId});
      const execution = await apiPost<{result: unknown}>(`/api/marketplace/services/${service.id}/execute`, {
        payer: address,
        authorizationId: result.authorizationId,
        args: executionArgs(service, serviceInputs[service.id] ?? "")
      });
      await snapshot.refetch();
      setServiceResults((current) => ({...current, [service.id]: execution.result}));
      if (settlement.txHash) {
        toast.success(txToast(`Purchased ${service.name}`, settlement.txHash), {id: toastId});
      } else {
        toast.success(`Settlement recorded for ${service.name}.`, {id: toastId});
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Service purchase failed", {id: toastId});
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="x402 marketplace"
        title="APIs and agent services priced in USDC"
        description="Discover monetized tools that agents can purchase per request under operator-defined policy limits."
        action={<a href="/marketplace/new" onClick={(event) => navigate(event, "/marketplace/new")} className="action-button"><Plus size={17} /> Publish API</a>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatMetric variant="panel" icon={Store} label="Services" value={services.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={CheckCircle2} label="On-chain ready" value={onchainServices} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ShieldCheck} label="Settled volume" value={settledVolume} prefix="$" decimals={2} loading={snapshot.isLoading} accent />
      </div>

      <section className="panel grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div>
          <p className="section-kicker">Agent service directory</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Purchase-ready tools with receipts, policy checks, and Arc settlement</h2>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <TrustFact icon={ReceiptText} label="Receipts" value="Memo-backed" />
            <TrustFact icon={ShieldCheck} label="Policy" value="Agent guarded" />
            <TrustFact icon={Sparkles} label="Featured" value={`${featuredServices} curated`} />
          </div>
        </div>
        <div className="surface p-4">
          <p className="text-sm font-semibold text-white">Marketplace quality gates</p>
          <div className="mt-3 grid gap-2">
            {["Published on x402 ledger", "Structured input and output schema", "Receipt link after settlement", "Publisher address visible"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={15} className="text-mint" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {snapshot.error ? <p className="rounded-xl border border-magenta/35 bg-gradient-to-br from-magenta/15 to-magenta/10 p-4 text-sm font-semibold text-magenta shadow-[0_0_20px_rgba(236,72,153,0.15)]">{snapshot.error instanceof Error ? snapshot.error.message : "Marketplace API unavailable"}</p> : null}

      <div className="panel flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-sm font-bold text-white">
          <ShieldCheck size={18} className="text-mint drop-shadow-[0_0_12px_rgba(110,231,183,0.5)]" />
          Agent used for purchases
        </div>
        <AgentPicker agents={agents} value={selectedAgent} onChange={setSelectedAgentId} />
      </div>

      <div className="panel flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-white">Memo privacy</p>
          <p className="mt-1 text-xs text-slate-400">Choose what purchase context is written into public memo data.</p>
        </div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
          {PRIVACY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPrivacyScope(option.value)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${privacyScope === option.value ? "border-mint/40 bg-mint/10 text-white" : "border-white/[0.1] bg-white/[0.04] text-slate-300 hover:border-mint/30"}`}
            >
              <span className="block font-semibold">{option.label}</span>
              <span className="mt-1 block text-xs text-slate-500">{option.copy}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Search + filter + sort */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.key}
              type="button"
              onClick={() => setCategoryFilter(category.key)}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${categoryFilter === category.key ? "border-mint/40 bg-mint/10 text-white" : "border-white/[0.1] bg-white/[0.04] text-slate-300 hover:border-mint/30 hover:text-white"}`}
            >
              <Icon size={15} />
              {category.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3">
          <Search size={16} className="shrink-0 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search services…"
            className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="field max-w-[180px] bg-slate-950 text-sm text-white">
          <option value="featured">Featured first</option>
          <option value="priceAsc">Price: low to high</option>
          <option value="priceDesc">Price: high to low</option>
          <option value="name">Name: A–Z</option>
        </select>
      </div>
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={kindFilter === "all"} onClick={() => setKindFilter("all")} />
          {kinds.map((kind) => (
            <FilterChip key={kind} label={formatKind(kind)} active={kindFilter === kind} onClick={() => setKindFilter(kind)} />
          ))}
        </div>
      ) : null}

      {snapshot.isLoading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1].map((index) => (
            <div key={index} className="panel space-y-4">
              <div className="flex items-center gap-3">
                <div className="shimmer h-12 w-12 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="shimmer h-4 w-40 rounded" />
                  <div className="shimmer h-3 w-24 rounded" />
                </div>
              </div>
              <div className="shimmer h-16 w-full rounded-xl" />
              <div className="shimmer h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : services.length === 0 ? (
        !isConnected ? (
          <EmptyState icon={<Wallet size={26} />} title="Connect your wallet" copy="Connect a wallet to browse and purchase x402 services, or publish your own." />
        ) : (
          <EmptyState
            icon={<Store size={26} />}
            title="No APIs published yet"
            copy="Be the first to publish an x402 service priced per request in USDC."
            action={<a href="/marketplace/new" onClick={(event) => navigate(event, "/marketplace/new")} className="action-button"><Plus size={16} /> Publish API</a>}
          />
        )
      ) : visibleServices.length === 0 ? (
        <EmptyState icon={<Search size={26} />} title="No matches" copy="No services match your search or filter. Try a different term or clear the filter." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {visibleServices.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              busy={busyId === service.id}
              disabled={!isConnected || !selectedAgent || !service.chainServiceId || Boolean(busyId)}
              input={serviceInputs[service.id] ?? ""}
              onInput={(value) => setServiceInputs((current) => ({...current, [service.id]: value}))}
              onSample={() => setServiceInputs((current) => ({...current, [service.id]: sampleInputForService(service)}))}
              onPurchase={() => void purchase(service)}
              result={serviceResults[service.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrustFact({icon: Icon, label, value}: {icon: LucideIcon; label: string; value: string}) {
  return (
    <div className="surface px-3 py-3">
      <span className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
        <Icon size={14} className="text-orchid" />
        {label}
      </span>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function FilterChip({label, active, onClick}: {label: string; active: boolean; onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold capitalize transition ${active ? "border-plasma/40 bg-gradient-to-br from-plasma/[0.2] to-plasma/[0.08] text-white" : "border-white/[0.1] bg-white/[0.04] text-slate-300 hover:border-plasma/30 hover:text-white"}`}
    >
      {label}
    </button>
  );
}

function ServiceCard({
  service,
  busy,
  disabled,
  input,
  onInput,
  onSample,
  onPurchase,
  result
}: {
  service: Service;
  busy: boolean;
  disabled: boolean;
  input: string;
  onInput: (value: string) => void;
  onSample: () => void;
  onPurchase: () => void;
  result: unknown;
}) {
  const Icon = kindIcon(service.manifest.kind);
  const inputLabel = serviceInputLabel(service);
  const category = serviceCategory(service);
  const readiness = serviceReadiness(service);
  const trust = service.trust;
  return (
    <article className="group panel relative overflow-hidden transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-plasma/[0.06] blur-3xl transition-all duration-500 group-hover:bg-plasma/[0.12]" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-gradient-to-br from-plasma/15 to-plasma/5 text-orchid">
            <Icon size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-bold text-white">{service.name}</h3>
              {service.featured ? (
                <span className="flex items-center gap-1 rounded-full border border-amber/30 bg-amber/10 px-2 py-0.5 text-[11px] font-bold text-amber">
                  <Star size={11} />
                  Featured
                </span>
              ) : null}
              {service.chainServiceId ? (
                <span className="flex items-center gap-1 rounded-full border border-mint/25 bg-mint/10 px-2 py-0.5 text-[11px] font-bold text-mint">
                  <CheckCircle2 size={11} />
                  Verified route
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full border border-amber/25 bg-amber/10 px-2 py-0.5 text-[11px] font-bold text-amber">
                  Publish required
                </span>
              )}
              {trust ? <TrustBadge score={trust.score} tier={trust.tier} /> : null}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <AgentAvatar seed={service.publisherAddress} size={16} />
              {shortAddress(service.publisherAddress)}
              <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/address/${service.publisherAddress}`} target="_blank" rel="noreferrer" className="text-slate-500 transition hover:text-orchid" aria-label="View publisher on explorer">
                <ExternalLink size={12} />
              </a>
            </p>
          </div>
        </div>
        <div className="shrink-0 rounded-xl border border-mint/25 bg-mint/10 px-3 py-1.5 text-right">
          <p className="text-lg font-bold text-mint">${service.pricePerUnitUsdc}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">/ request</p>
        </div>
      </div>

      <div className="relative mt-4 grid gap-2.5 text-sm sm:grid-cols-2">
        <StatusMetric icon={Layers} label="Settlement" value={service.chainServiceId ? `Ledger #${service.chainServiceId}` : "Not published"} tone={service.chainServiceId ? "mint" : "amber"} />
        <StatusMetric icon={Activity} label="Health" value={readiness.label} tone={readiness.tone} />
        <StatusMetric icon={ReceiptText} label="Receipt" value="Memo-backed" tone="mint" />
        <StatusMetric icon={ShieldCheck} label="Trust" value={trust ? `${trust.score}/100` : "New"} tone={trust && trust.score >= 60 ? "mint" : trust && trust.score >= 40 ? "amber" : "slate"} />
      </div>

      {trust ? (
        <div className="relative mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <TrustMetric label="Settled" value={`${trust.settledPayments}`} />
          <TrustMetric label="Buyers" value={`${trust.uniqueBuyers}`} />
          <TrustMetric label="Volume" value={`$${trust.totalVolumeUsdc.toFixed(2)}`} />
        </div>
      ) : null}

      <div className="relative mt-4 rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] p-5 backdrop-blur-sm">
        <p className="text-sm font-semibold leading-6 text-white">{service.manifest.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="status-pill">{formatCategory(category)}</span>
          <span className="status-pill">{formatKind(service.manifest.kind)}</span>
          <span className="status-pill">v{service.manifest.version}</span>
          {service.manifest.outputSchema.slice(0, 4).map((item) => <span key={item} className="status-pill">{item}</span>)}
        </div>
      </div>

      {inputLabel ? (
        <label className="relative mt-4 grid gap-2.5 text-sm font-semibold text-slate-300">
          <span className="flex items-center justify-between gap-3">
            {inputLabel}
            <button type="button" onClick={onSample} className="text-xs font-bold text-mint transition hover:text-white">
              Use sample
            </button>
          </span>
          <input
            className="field"
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder={serviceInputPlaceholder(service)}
          />
        </label>
      ) : null}

      <div className="relative mt-4 flex items-center gap-3">
        <button onClick={onPurchase} className="action-button flex-1" disabled={disabled}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? "Processing…" : "Purchase per execution"}
        </button>
        <button type="button" onClick={() => navigateTo(`/marketplace/services/${encodeURIComponent(service.id)}`)} className="secondary-button px-3" aria-label="Public service page">
          <ArrowUpRight size={16} />
        </button>
      </div>

      {busy ? <div className="shimmer mt-4 h-20 w-full rounded-xl" /> : <ServiceResult result={result} />}
    </article>
  );
}

function TrustBadge({score, tier}: {score: number; tier: string}) {
  const tone = score >= 78 ? "border-mint/30 bg-mint/10 text-mint" : score >= 60 ? "border-cyan/30 bg-cyan/10 text-cyan" : score >= 40 ? "border-amber/30 bg-amber/10 text-amber" : "border-white/[0.12] bg-white/[0.04] text-slate-400";
  return (
    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold capitalize ${tone}`}>
      <ShieldCheck size={11} />
      {tier} {score}
    </span>
  );
}

function TrustMetric({label, value}: {label: string; value: string}) {
  return (
    <span className="surface px-3 py-2">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <b className="mt-1 block text-white">{value}</b>
    </span>
  );
}

function StatusMetric({icon: Icon, label, value, tone}: {icon: LucideIcon; label: string; value: string; tone: "mint" | "amber" | "slate"}) {
  const toneClass = tone === "mint" ? "text-mint" : tone === "amber" ? "text-amber" : "text-slate-300";
  return (
    <span className="surface flex items-center gap-2 px-3 py-2.5 font-medium">
      <Icon size={14} className={toneClass} />
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <b className={`block truncate font-bold ${toneClass}`}>{value}</b>
      </span>
    </span>
  );
}

function ServiceResult({result}: {result: unknown}) {
  if (!result || typeof result !== "object") return null;
  const data = result as Record<string, unknown>;
  const status = stringValue(data.status) ?? "ok";

  if (status !== "ok") {
    return (
      <div className="relative mt-5 rounded-xl border border-magenta/35 bg-gradient-to-br from-magenta/15 to-magenta/10 p-5 shadow-[0_0_20px_rgba(236,72,153,0.15)]">
        <p className="text-sm font-bold text-magenta">{stringValue(data.message) ?? "Service returned an error"}</p>
        {stringValue(data.detail) ? <p className="mt-3 text-xs leading-5 text-slate-300">{stringValue(data.detail)}</p> : null}
      </div>
    );
  }

  if ("headings" in data || "wordCount" in data || "canonical" in data) return <WebsiteResult data={data} />;
  if ("stars" in data || "forks" in data || "readmeSummary" in data) return <GitHubResult data={data} />;
  if ("account" in data || "score" in data) return <XResult data={data} />;
  if ("agenda" in data || "questions" in data || "followUps" in data || "integrationIdeas" in data || "steps" in data || "requirements" in data || "securityNotes" in data || "checks" in data || "recommendations" in data || "recommendedPolicy" in data || "gaps" in data || "risks" in data || "suggestions" in data) return <StructuredServiceResult data={data} />;

  return (
    <div className="relative mt-5 rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] p-5 backdrop-blur-sm">
      <p className="text-sm font-bold text-white">{stringValue(data.summary) ?? "Service result"}</p>
      {stringValue(data.note) ? <p className="mt-3 text-sm leading-6 text-slate-400">{stringValue(data.note)}</p> : null}
    </div>
  );
}

function StructuredServiceResult({data}: {data: Record<string, unknown>}) {
  const checks = arrayValue(data.checks);
  const issues = arrayValue(data.issues);
  const recommendations = arrayValue(data.recommendations);
  const gaps = arrayValue(data.gaps);
  const strengths = arrayValue(data.strengths);
  const agenda = arrayValue(data.agenda);
  const questions = arrayValue(data.questions);
  const followUps = arrayValue(data.followUps);
  const integrationIdeas = arrayValue(data.integrationIdeas);
  const steps = arrayValue(data.steps);
  const requirements = arrayValue(data.requirements);
  const securityNotes = arrayValue(data.securityNotes);
  const risks = arrayValue(data.risks);
  const suggestions = arrayValue(data.suggestions);
  return (
    <div className="surface mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-orchid">Service result</p>
          <h4 className="mt-2 text-base font-semibold text-white">{stringValue(data.riskLevel) ? `Risk: ${stringValue(data.riskLevel)}` : stringValue(data.summary) ?? "Analysis complete"}</h4>
        </div>
        {numberValue(data.score) !== null ? <span className="status-pill">Score {numberValue(data.score)}</span> : null}
      </div>
      {stringValue(data.summary) ? <p className="mt-3 text-sm leading-6 text-slate-300">{stringValue(data.summary)}</p> : null}
      <ResultList title="Checks" items={checks} />
      <ResultList title="Issues" items={issues} />
      <ResultList title="Risks" items={risks} />
      <ResultList title="Strengths" items={strengths} />
      <ResultList title="Gaps" items={gaps} />
      <ResultList title="Agenda" items={agenda} />
      <ResultList title="Questions" items={questions} />
      <ResultList title="Follow-ups" items={followUps} />
      <ResultList title="Integration ideas" items={integrationIdeas} />
      <ResultList title="Steps" items={steps} />
      <ResultList title="Requirements" items={requirements} />
      <ResultList title="Security notes" items={securityNotes} />
      <ResultList title="Recommendations" items={recommendations} />
      <ResultList title="Suggestions" items={suggestions} />
    </div>
  );
}

function WebsiteResult({data}: {data: Record<string, unknown>}) {
  const links = arrayValue(data.links).slice(0, 4);
  const headings = arrayValue(data.headings).slice(0, 5);
  const url = stringValue(data.url);
  return (
    <div className="surface mt-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-orchid">Website analysis</p>
          <h4 className="mt-2 text-base font-semibold text-white">{stringValue(data.title) ?? "Untitled"}</h4>
          {stringValue(data.description) ? <p className="mt-2 text-sm leading-6 text-slate-300">{stringValue(data.description)}</p> : null}
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="secondary-button px-3 py-2 text-xs">
            <ExternalLink size={14} />
            Open
          </a>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <ResultMetric label="Words" value={numberValue(data.wordCount)} />
        <ResultMetric label="Links found" value={links.length} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{stringValue(data.summary)}</p>
      {headings.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Page headings</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {headings.map((heading, index) => <span key={`${heading}-${index}`} className="status-pill">{String(heading)}</span>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GitHubResult({data}: {data: Record<string, unknown>}) {
  const url = stringValue(data.url);
  return (
    <div className="surface mt-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-orchid">GitHub analysis</p>
          <h4 className="mt-2 text-base font-semibold text-white">{stringValue(data.repo)}</h4>
          <p className="mt-2 text-sm leading-6 text-slate-300">{stringValue(data.description) || stringValue(data.signal)}</p>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="secondary-button px-3 py-2 text-xs">
            <ExternalLink size={14} />
            Repo
          </a>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <ResultMetric icon={<Star size={14} />} label="Stars" value={numberValue(data.stars)} />
        <ResultMetric icon={<GitFork size={14} />} label="Forks" value={numberValue(data.forks)} />
        <ResultMetric label="Issues" value={numberValue(data.openIssues)} />
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <ResultMetric label="Language" value={stringValue(data.language)} />
        <ResultMetric label="License" value={stringValue(data.license)} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{stringValue(data.readmeSummary)}</p>
      {stringValue(data.signal) ? <p className="mt-3 text-sm font-medium text-mint">{stringValue(data.signal)}</p> : null}
    </div>
  );
}

function XResult({data}: {data: Record<string, unknown>}) {
  const account = objectValue(data.account);
  const metrics = objectValue(data.metrics);
  return (
    <div className="surface mt-4 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-orchid">X account analysis</p>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-white">{stringValue(account.name) ?? stringValue(account.username) ?? "X account"}</h4>
          {stringValue(account.username) ? <p className="mt-1 text-sm text-slate-400">@{stringValue(account.username)}</p> : null}
        </div>
        <span className="status-pill">Score {numberValue(data.score)}</span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <ResultMetric label="Followers" value={numberValue(metrics.followers)} />
        <ResultMetric label="Following" value={numberValue(metrics.following)} />
        <ResultMetric label="Posts" value={numberValue(metrics.tweets)} />
      </div>
      <p className="mt-4 text-sm font-medium text-mint">{stringValue(data.summary)}</p>
    </div>
  );
}

function ResultMetric({label, value, icon}: {label: string; value?: string | number | null; icon?: React.ReactNode}) {
  return (
    <div className="surface flex items-center justify-between gap-3 px-3 py-2">
      <span className="flex items-center gap-2 text-slate-400">{icon}{label}</span>
      <b className="text-white">{value ?? "N/A"}</b>
    </div>
  );
}

function ResultList({title, items}: {title: string; items: unknown[]}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <div className="mt-2 grid gap-2">
        {items.slice(0, 5).map((item, index) => (
          <div key={`${title}-${index}`} className="surface px-3 py-2 text-sm text-slate-300">{String(item)}</div>
        ))}
      </div>
    </div>
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
