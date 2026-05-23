import {useState} from "react";
import {ExternalLink, GitFork, Plus, Star} from "lucide-react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {apiPost} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {settleX402Request} from "@/lib/contracts";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

export default function MarketplacePage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const [serviceInputs, setServiceInputs] = useState<Record<string, string>>({});
  const [serviceResults, setServiceResults] = useState<Record<string, unknown>>({});
  const snapshot = useAppSnapshot();

  async function purchase(service: NonNullable<typeof snapshot.data>["services"][number]) {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before purchasing an x402 service.");
      return;
    }
    setStatus(`Authorizing x402 payment for ${service.name}...`);
    try {
      const requestHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}` as `0x${string}`;
      const result = await apiPost<{authorizationId: string; status: string; settlement: {amountUsdc: number}}>("/api/x402/authorize", {
        serviceId: service.id,
        payer: address,
        requestHash,
        units: 1
      });
      let txHash: string | null = null;
      if (service.chainServiceId) {
        setStatus(`Submitting USDC approval and x402 settlement for ${service.name}...`);
        const tx = await settleX402Request({
          chainServiceId: service.chainServiceId,
          requestHash,
          payer: address,
          units: 1,
          amountUsdc: String(result.settlement.amountUsdc)
        });
        txHash = tx.settleHash;
      }
      await apiPost("/api/x402/settle", {authorizationId: result.authorizationId, txHash});
      const execution = await apiPost<{result: unknown}>(`/api/marketplace/services/${service.id}/execute`, {
        payer: address,
        args: executionArgs(service, serviceInputs[service.id] ?? "")
      });
      await snapshot.refetch();
      setServiceResults((current) => ({...current, [service.id]: execution.result}));
      setStatus(
        txHash
          ? `Purchased ${service.name} for ${shortAddress(address)}. Settlement: ${txHash}`
          : `Recorded test purchase for ${service.name}.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Service purchase failed");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="x402 marketplace"
        title="APIs and agent services priced in USDC"
        description="Discover monetized tools that agents can purchase per request under operator-defined policy limits."
        action={<a href="/marketplace/new" onClick={(event) => navigate(event, "/marketplace/new")} className="action-button"><Plus size={16} /> Publish API</a>}
      />
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
      {snapshot.error ? <p className="rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{snapshot.error instanceof Error ? snapshot.error.message : "Marketplace API unavailable"}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(snapshot.data?.services ?? []).map((service) => (
          <article key={service.id} className="panel relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-white">{service.name}</h3>
                <p className="text-sm text-slate-400">Published by {shortAddress(service.publisherAddress)}</p>
              </div>
              <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">x402</span>
            </div>
            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              <span className="surface px-3 py-2">Price <b className="text-white">${service.pricePerUnitUsdc}</b></span>
              <span className="surface px-3 py-2">Ledger <b className="text-white">{service.chainServiceId ?? "Off-chain"}</b></span>
              <span className="surface px-3 py-2">Featured <b className="text-white">{service.featured ? "Yes" : "No"}</b></span>
            </div>
            {serviceInputLabel(service) ? (
              <label className="mt-5 grid gap-2 text-sm text-slate-300">
                {serviceInputLabel(service)}
                <input
                  className="field"
                  value={serviceInputs[service.id] ?? ""}
                  onChange={(event) => setServiceInputs((current) => ({...current, [service.id]: event.target.value}))}
                  placeholder={serviceInputPlaceholder(service)}
                />
              </label>
            ) : null}
            <button onClick={() => void purchase(service)} className="action-button mt-5 w-full" disabled={!isConnected}>
              {service.chainServiceId ? "Purchase per execution" : "Test purchase"}
            </button>
            <ServiceResult result={serviceResults[service.id]} />
          </article>
        ))}
        {!snapshot.isLoading && (snapshot.data?.services.length ?? 0) === 0 ? (
          <div className="panel lg:col-span-2">
            <p className="text-sm text-slate-300">No APIs have been published yet. Publish the first x402 service from the developer console.</p>
          </div>
        ) : null}
      </div>

    </div>
  );
}

function ServiceResult({result}: {result: unknown}) {
  if (!result || typeof result !== "object") return null;
  const data = result as Record<string, unknown>;
  const status = stringValue(data.status) ?? "ok";

  if (status !== "ok") {
    return (
      <div className="mt-4 rounded-md border border-magenta/25 bg-magenta/10 p-4">
        <p className="text-sm font-medium text-magenta">{stringValue(data.message) ?? "Service returned an error"}</p>
        {stringValue(data.detail) ? <p className="mt-2 text-xs leading-5 text-slate-300">{stringValue(data.detail)}</p> : null}
      </div>
    );
  }

  if ("headings" in data || "wordCount" in data || "canonical" in data) return <WebsiteResult data={data} />;
  if ("stars" in data || "forks" in data || "readmeSummary" in data) return <GitHubResult data={data} />;
  if ("account" in data || "score" in data) return <XResult data={data} />;

  return (
    <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.035] p-4">
      <p className="text-sm font-medium text-white">{stringValue(data.summary) ?? "Service result"}</p>
      {stringValue(data.note) ? <p className="mt-2 text-sm leading-6 text-slate-400">{stringValue(data.note)}</p> : null}
    </div>
  );
}

function WebsiteResult({data}: {data: Record<string, unknown>}) {
  const links = arrayValue(data.links).slice(0, 4);
  const headings = arrayValue(data.headings).slice(0, 5);
  const url = stringValue(data.url);
  return (
    <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.035] p-4">
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
    <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.035] p-4">
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
    <div className="mt-4 rounded-md border border-white/[0.08] bg-white/[0.035] p-4">
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

function isXAnalyzer(service: {name: string; endpointHash: string}) {
  const marker = `${service.name} ${service.endpointHash}`.toLowerCase();
  return marker.includes("x account") || marker.includes("x-account") || marker.includes("twitter");
}

function isWebsiteAnalyzer(service: {name: string; endpointHash: string}) {
  const marker = `${service.name} ${service.endpointHash}`.toLowerCase();
  return marker.includes("website") || marker.includes("url analyzer") || marker.includes("site analyzer");
}

function isGitHubAnalyzer(service: {name: string; endpointHash: string}) {
  const marker = `${service.name} ${service.endpointHash}`.toLowerCase();
  return marker.includes("github") || marker.includes("repo analyzer") || marker.includes("repository");
}

function serviceInputLabel(service: {name: string; endpointHash: string}) {
  if (isXAnalyzer(service)) return "X account";
  if (isWebsiteAnalyzer(service)) return "Website URL";
  if (isGitHubAnalyzer(service)) return "GitHub repository";
  return "";
}

function serviceInputPlaceholder(service: {name: string; endpointHash: string}) {
  if (isXAnalyzer(service)) return "@username";
  if (isWebsiteAnalyzer(service)) return "https://example.com";
  if (isGitHubAnalyzer(service)) return "owner/repo or GitHub URL";
  return "";
}

function executionArgs(service: {name: string; endpointHash: string}, value: string) {
  if (isXAnalyzer(service)) return {handle: value};
  if (isWebsiteAnalyzer(service)) return {url: value};
  if (isGitHubAnalyzer(service)) return {repo: value};
  return {};
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
