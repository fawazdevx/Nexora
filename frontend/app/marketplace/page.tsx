import {useMemo, useState} from "react";
import {ArrowUpRight, ExternalLink, GitFork, Globe, Plus, Search, ShieldCheck, Sparkles, Star, Store, Twitter, Wallet, Loader2} from "lucide-react";
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
import {settleX402Request} from "@/lib/contracts";

type Service = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["services"][number];
type SortKey = "featured" | "priceAsc" | "priceDesc" | "name";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

function kindIcon(kind: string) {
  if (kind.includes("website")) return Globe;
  if (kind.includes("github")) return GitFork;
  if (kind.includes("x_account") || kind.includes("twitter")) return Twitter;
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
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("featured");
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const services = snapshot.data?.services ?? [];
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];

  const kinds = useMemo(() => Array.from(new Set(services.map((service) => service.manifest.kind))), [services]);
  const avgPrice = services.length > 0 ? services.reduce((total, service) => total + Number(service.pricePerUnitUsdc || 0), 0) / services.length : 0;
  const settledVolume = snapshot.data?.stats.usdcSettled ?? 0;

  const visibleServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = services.filter((service) => {
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
  }, [services, query, kindFilter, sort]);

  async function purchase(service: Service) {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before purchasing an x402 service.");
      return;
    }
    if (!selectedAgent) {
      toast.error("Create an agent wallet before purchasing an API.");
      return;
    }
    setBusyId(service.id);
    const toastId = toast.loading(`Authorizing x402 payment for ${service.name}…`);
    try {
      const requestHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}` as `0x${string}`;
      const result = await apiPost<{authorizationId: string; status: string; settlement: {amountUsdc: number}}>("/api/x402/authorize", {
        serviceId: service.id,
        payer: address,
        agentId: selectedAgent.id,
        requestHash,
        units: 1
      });
      if (!service.chainServiceId) {
        throw new Error("This service is not published on-chain yet.");
      }
      toast.loading(`Approve ${result.settlement.amountUsdc} USDC and confirm settlement…`, {id: toastId});
      const walletSettlement = await settleX402Request({
        chainServiceId: service.chainServiceId,
        requestHash,
        payer: address,
        units: 1,
        amountUsdc: String(result.settlement.amountUsdc)
      });
      const settlement = await apiPost<{status: string; txHash?: string | null}>("/api/x402/settle", {
        authorizationId: result.authorizationId,
        txHash: walletSettlement.settleHash
      });
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
        toast.success(`Purchased ${service.name} with agent policy enforced.`, {id: toastId});
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
        <StatMetric variant="panel" icon={Sparkles} label="Avg price" value={avgPrice} prefix="$" decimals={2} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ShieldCheck} label="Settled volume" value={settledVolume} prefix="$" decimals={2} loading={snapshot.isLoading} accent />
      </div>

      {snapshot.error ? <p className="rounded-xl border border-magenta/35 bg-gradient-to-br from-magenta/15 to-magenta/10 p-4 text-sm font-semibold text-magenta shadow-[0_0_20px_rgba(236,72,153,0.15)]">{snapshot.error instanceof Error ? snapshot.error.message : "Marketplace API unavailable"}</p> : null}

      <div className="panel flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-sm font-bold text-white">
          <ShieldCheck size={18} className="text-mint drop-shadow-[0_0_12px_rgba(110,231,183,0.5)]" />
          Agent used for purchases
        </div>
        <AgentPicker agents={agents} value={selectedAgent} onChange={setSelectedAgentId} />
      </div>

      {/* Search + filter + sort */}
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
              disabled={!isConnected || !selectedAgent || Boolean(busyId)}
              input={serviceInputs[service.id] ?? ""}
              onInput={(value) => setServiceInputs((current) => ({...current, [service.id]: value}))}
              onPurchase={() => void purchase(service)}
              result={serviceResults[service.id]}
            />
          ))}
        </div>
      )}
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
  onPurchase,
  result
}: {
  service: Service;
  busy: boolean;
  disabled: boolean;
  input: string;
  onInput: (value: string) => void;
  onPurchase: () => void;
  result: unknown;
}) {
  const Icon = kindIcon(service.manifest.kind);
  const inputLabel = serviceInputLabel(service);
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
        <span className="surface px-3 py-2.5 font-medium">Ledger <b className="font-bold text-white">{service.chainServiceId ?? "Off-chain"}</b></span>
        <span className="surface px-3 py-2.5 font-medium">Platform fee <b className="font-bold text-white">{(service.manifest.platformFeeBps / 100).toFixed(2)}%</b></span>
      </div>

      <div className="relative mt-4 rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] p-5 backdrop-blur-sm">
        <p className="text-sm font-semibold leading-6 text-white">{service.manifest.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="status-pill">{formatKind(service.manifest.kind)}</span>
          <span className="status-pill">v{service.manifest.version}</span>
          {service.manifest.outputSchema.slice(0, 4).map((item) => <span key={item} className="status-pill">{item}</span>)}
        </div>
      </div>

      {inputLabel ? (
        <label className="relative mt-4 grid gap-2.5 text-sm font-semibold text-slate-300">
          {inputLabel}
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
          {busy ? "Processing…" : service.chainServiceId ? "Purchase per execution" : "Test purchase"}
        </button>
        <button type="button" onClick={() => navigateTo(`/marketplace/services/${encodeURIComponent(service.id)}`)} className="secondary-button px-3" aria-label="Public service page">
          <ArrowUpRight size={16} />
        </button>
      </div>

      {busy ? <div className="shimmer mt-4 h-20 w-full rounded-xl" /> : <ServiceResult result={result} />}
    </article>
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
  if ("checks" in data || "recommendations" in data || "recommendedPolicy" in data || "gaps" in data) return <StructuredServiceResult data={data} />;

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
      <ResultList title="Strengths" items={strengths} />
      <ResultList title="Gaps" items={gaps} />
      <ResultList title="Recommendations" items={recommendations} />
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

function serviceInputLabel(service: {manifest: {inputSchema: Array<{label: string}>}}) {
  return service.manifest.inputSchema[0]?.label ?? "";
}

function serviceInputPlaceholder(service: {manifest: {inputSchema: Array<{placeholder?: string}>}}) {
  return service.manifest.inputSchema[0]?.placeholder ?? "";
}

function executionArgs(service: {manifest: {kind: string; inputSchema: Array<{name: string}>}}, value: string) {
  const field = service.manifest.inputSchema[0]?.name;
  if (field) return {[field]: value};
  if (service.manifest.kind === "x_account_analyzer") return {handle: value};
  if (service.manifest.kind === "website_analyzer") return {url: value};
  if (service.manifest.kind === "github_repo_analyzer") return {repo: value};
  return {};
}

function formatKind(value: string) {
  return value.replaceAll("_", " ");
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
