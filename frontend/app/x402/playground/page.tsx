import {useEffect, useMemo, useState} from "react";
import {Activity, CheckCircle2, Copy, ExternalLink, KeyRound, Play, RadioTower, RefreshCw, Search, Server, ShieldCheck, Users, XCircle} from "lucide-react";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {JsonViewer, type JsonStatus} from "@/components/JsonViewer";
import {apiGet, apiPost, apiUrlFor} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";

type Analytics = {
  summary: {
    verifications: number;
    settlements: number;
    failed: number;
    volumeUsdc: number;
    activeIntegrators: number;
  };
  recentEvents: Array<{
    id: string;
    kind: "verify" | "settle";
    status: "success" | "failed";
    payer?: string | null;
    payTo?: string | null;
    network?: string | null;
    amountUsdc?: number;
    requestHash?: string | null;
    reason?: string | null;
    txHash?: string | null;
    createdAt: string;
  }>;
};

type Readiness = {
  ready: boolean;
  missing: string[];
  items: Array<{
    key: string;
    label: string;
    configured: boolean;
    requiredFor: string;
  }>;
};

const sampleBody = {
  paymentRequirements: {
    scheme: "exact",
    network: "arc-testnet",
    maxAmountRequired: "50000",
    resource: "https://api.example.com/paid-report",
    description: "Paid report",
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000"
  },
  paymentPayload: {
    x402Version: 1,
    scheme: "exact",
    network: "arc-testnet",
    payload: {
      authorization: {
        from: "0xPayerWallet",
        to: "0xYourPublisherWallet",
        value: "50000",
        validAfter: "0",
        validBefore: "1893456000",
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000001"
      },
      signature: "0x..."
    }
  }
};

const emptySettleBody = {
  paymentRequirements: sampleBody.paymentRequirements,
  paymentPayload: sampleBody.paymentPayload
};

const endpoints: Array<{method: "GET" | "POST"; path: string}> = [
  {method: "GET", path: "/x402/supported"},
  {method: "POST", path: "/x402/verify"},
  {method: "POST", path: "/x402/settle"}
];

const sdkSnippet = `npm install @nexorafi/x402

import { nexoraX402 } from "@nexorafi/x402";

app.get("/paid-report",
  nexoraX402({
    facilitatorUrl: "${apiUrlFor("")}",
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet"
  }),
  (_req, res) => res.json({ ok: true })
);`;

type EventFilter = "all" | "verify" | "settle" | "success" | "failed";

export default function X402PlaygroundPage() {
  const [supported, setSupported] = useState<unknown>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requestText, setRequestText] = useState(() => JSON.stringify(sampleBody, null, 2));
  const [settleText, setSettleText] = useState(() => JSON.stringify(emptySettleBody, null, 2));
  const [verifyResult, setVerifyResult] = useState<unknown>(null);
  const [verifyStatus, setVerifyStatus] = useState<JsonStatus | undefined>(undefined);
  const [settleResult, setSettleResult] = useState<unknown>(null);
  const [settleStatus, setSettleStatus] = useState<JsonStatus | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [filter, setFilter] = useState<EventFilter>("all");
  const [query, setQuery] = useState("");

  const jsonError = useMemo(() => {
    try {
      JSON.parse(requestText);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid JSON";
    }
  }, [requestText]);

  const settleJsonError = useMemo(() => {
    try {
      JSON.parse(settleText);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid JSON";
    }
  }, [settleText]);

  const curl = useMemo(() => {
    let body = requestText;
    try {
      body = JSON.stringify(JSON.parse(requestText));
    } catch {
      /* keep raw text if unparseable */
    }
    return `curl -X POST ${apiUrlFor("/x402/verify")} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  }, [requestText]);

  const settleCurl = useMemo(() => {
    let body = settleText;
    try {
      body = JSON.stringify(JSON.parse(settleText));
    } catch {
      /* keep raw text if unparseable */
    }
    return `curl -X POST ${apiUrlFor("/x402/settle")} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  }, [settleText]);

  async function refresh() {
    setRefreshing(true);
    try {
      const [supportedResult, analyticsResult, readinessResult] = await Promise.all([
        apiGet("/x402/supported"),
        apiGet<Analytics>("/api/x402/analytics"),
        apiGet<Readiness>("/api/readiness")
      ]);
      setSupported(supportedResult);
      setAnalytics(analyticsResult);
      setReadiness(readinessResult);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Facilitator console unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSampleVerify() {
    if (jsonError) {
      toast.error("Fix the request JSON before running.");
      return;
    }
    setRunning(true);
    const toastId = toast.loading("Sending verification request…");
    const startedAt = performance.now();
    try {
      const result = await apiPost<Record<string, unknown>>("/x402/verify", JSON.parse(requestText));
      const ms = Math.round(performance.now() - startedAt);
      const valid = !(result && typeof result === "object" && result.isValid === false);
      setVerifyResult(result);
      setVerifyStatus({label: valid ? "200 OK" : "200 · invalid", tone: valid ? "ok" : "error", detail: `${ms} ms`});
      toast.success("Verification response received.", {id: toastId});
      void refresh();
    } catch (error) {
      const ms = Math.round(performance.now() - startedAt);
      setVerifyResult({error: error instanceof Error ? error.message : "Verification failed"});
      setVerifyStatus({label: "Request failed", tone: "error", detail: `${ms} ms`});
      toast.success("Returned an expected validation response.", {id: toastId});
    } finally {
      setRunning(false);
    }
  }

  async function runSampleSettle() {
    if (settleJsonError) {
      toast.error("Fix the settle JSON before running.");
      return;
    }
    setSettling(true);
    const toastId = toast.loading("Sending settlement request...");
    const startedAt = performance.now();
    try {
      const result = await apiPost<Record<string, unknown>>("/x402/settle", JSON.parse(settleText));
      const ms = Math.round(performance.now() - startedAt);
      const success = Boolean(result?.success);
      setSettleResult(result);
      setSettleStatus({label: success ? "Settled" : "Not settled", tone: success ? "ok" : "error", detail: `${ms} ms`});
      toast[success ? "success" : "error"](success ? "Settlement submitted." : "Settlement rejected.", {id: toastId});
      void refresh();
    } catch (error) {
      const ms = Math.round(performance.now() - startedAt);
      setSettleResult({error: error instanceof Error ? error.message : "Settlement failed"});
      setSettleStatus({label: "Request failed", tone: "error", detail: `${ms} ms`});
      toast.error(error instanceof Error ? error.message : "Settlement failed", {id: toastId});
    } finally {
      setSettling(false);
    }
  }

  const summary = analytics?.summary;
  const events = analytics?.recentEvents ?? [];
  const facilitatorItems = useMemo(() => {
    const keys = new Set(["DATABASE_URL", "FACILITATOR_PRIVATE_KEY", "X402_LEDGER_ADDRESS", "TREASURY_ADDRESS"]);
    return readiness?.items.filter((item) => keys.has(item.key)) ?? [];
  }, [readiness]);
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((event) => {
      if (filter === "verify" && event.kind !== "verify") return false;
      if (filter === "settle" && event.kind !== "settle") return false;
      if (filter === "success" && event.status !== "success") return false;
      if (filter === "failed" && event.status !== "failed") return false;
      if (!q) return true;
      return [event.payer, event.payTo, event.reason, event.txHash, event.requestHash, event.network]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [events, filter, query]);
  const ready = readiness?.ready ?? false;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="x402 facilitator"
        title="Facilitator console"
        description="Monitor supported x402 configuration, verify signed USDC authorizations, test settlement, and inspect live facilitator events."
        action={
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button className="secondary-button" onClick={() => navigateTo("/docs/api")}>API docs</button>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatMetric variant="panel" icon={RadioTower} label="Verifications" value={summary?.verifications ?? 0} loading={loading} />
        <StatMetric variant="panel" icon={CheckCircle2} label="Settlements" value={summary?.settlements ?? 0} loading={loading} />
        <StatMetric variant="panel" icon={XCircle} label="Failed" value={summary?.failed ?? 0} loading={loading} />
        <StatMetric variant="panel" icon={Activity} label="Volume" value={summary?.volumeUsdc ?? 0} prefix="$" decimals={2} loading={loading} accent />
        <StatMetric variant="panel" icon={Users} label="Integrators" value={summary?.activeIntegrators ?? 0} loading={loading} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-kicker">Operational readiness</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Facilitator health</h2>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${ready ? "border-mint/25 bg-mint/10 text-mint" : "border-amber/25 bg-amber/10 text-amber"}`}>
              {ready ? "Ready" : "Needs config"}
            </span>
          </div>
          <div className="mt-5 grid gap-2">
            {loading ? (
              [0, 1, 2, 3].map((index) => <div key={index} className="shimmer h-14 w-full rounded-xl" />)
            ) : facilitatorItems.length === 0 ? (
              <p className="text-sm text-slate-400">Readiness details are unavailable.</p>
            ) : (
              facilitatorItems.map((item) => (
                <div key={item.key} className="surface flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{item.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.requiredFor}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${item.configured ? "border-mint/25 bg-mint/10 text-mint" : "border-magenta/25 bg-magenta/10 text-magenta"}`}>
                    {item.configured ? "Configured" : "Missing"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <p className="section-kicker">Live integration</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Developer endpoints</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Use these URLs in external API middleware, SDK examples, and manual tests.</p>
          <div className="mt-5 grid gap-2">
            {endpoints.map((endpoint) => (
              <div key={endpoint.path} className="surface flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${endpoint.method === "GET" ? "bg-cyan/15 text-cyan" : "bg-plasma/15 text-orchid"}`}>{endpoint.method}</span>
                  <span className="truncate font-mono text-sm text-white">{apiUrlFor(endpoint.path)}</span>
                </div>
                <CopyMini value={apiUrlFor(endpoint.path)} />
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniFact icon={<Server size={16} />} label="Network" value="Arc Testnet" />
            <MiniFact icon={<ShieldCheck size={16} />} label="Scheme" value="exact" />
            <MiniFact icon={<KeyRound size={16} />} label="Asset" value="USDC" />
          </div>
        </div>
      </section>

      {/* Request → Response */}
      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Verify endpoint</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Request</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => setRequestText(JSON.stringify(sampleBody, null, 2))}>Reset</button>
              <button className="action-button" onClick={() => void runSampleVerify()} disabled={running || Boolean(jsonError)}>
                {running ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                {running ? "Running…" : "Run"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">POST {apiUrlFor("/x402/verify")}</p>
          <textarea
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            spellCheck={false}
            className="mt-4 min-h-[320px] w-full rounded-xl border border-white/[0.1] bg-[#050813] p-4 font-mono text-[13px] leading-6 text-slate-200 outline-none transition focus:border-plasma/50"
          />
          {jsonError ? <p className="mt-2 text-xs font-medium text-magenta">Invalid JSON: {jsonError}</p> : null}
        </div>

        <div className="panel">
          <p className="section-kicker">Response</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Latest verify result</h2>
          <div className="mt-5">
            <JsonViewer
              title="response.json"
              status={verifyStatus}
              code={JSON.stringify(verifyResult ?? {message: "Run the request to see a response."}, null, 2)}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Settle endpoint</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Settlement request</h2>
            </div>
            <div className="flex items-center gap-2">
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => setSettleText(JSON.stringify(emptySettleBody, null, 2))}>Reset</button>
              <button className="action-button" onClick={() => void runSampleSettle()} disabled={settling || Boolean(settleJsonError)}>
                {settling ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                {settling ? "Settling..." : "Settle"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">POST {apiUrlFor("/x402/settle")}</p>
          <textarea
            value={settleText}
            onChange={(event) => setSettleText(event.target.value)}
            spellCheck={false}
            className="mt-4 min-h-[320px] w-full rounded-xl border border-white/[0.1] bg-[#050813] p-4 font-mono text-[13px] leading-6 text-slate-200 outline-none transition focus:border-plasma/50"
          />
          {settleJsonError ? <p className="mt-2 text-xs font-medium text-magenta">Invalid JSON: {settleJsonError}</p> : null}
        </div>

        <div className="panel">
          <p className="section-kicker">Settlement response</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Latest settle result</h2>
          <div className="mt-5">
            <JsonViewer
              title="settle-response.json"
              status={settleStatus}
              code={JSON.stringify(settleResult ?? {message: "Paste a signed authorization and run settlement."}, null, 2)}
            />
          </div>
          <div className="mt-4">
            <JsonViewer title="settle.curl" language="bash" code={settleCurl} maxHeight="170px" />
          </div>
        </div>
      </section>

      {/* Supported config + endpoints/curl */}
      <section className="grid gap-5 xl:grid-cols-2">
        <div className="panel">
          <p className="section-kicker">Supported config</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Facilitator response</h2>
          <div className="mt-5">
            <JsonViewer title="GET /x402/supported" code={JSON.stringify(supported ?? {}, null, 2)} />
          </div>
        </div>

        <div className="panel">
          <p className="section-kicker">SDK quickstart</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Protect an API route</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">This snippet points builders at your active Nexora facilitator backend.</p>
          <div className="mt-5">
            <JsonViewer title="server.ts" language="ts" code={sdkSnippet} maxHeight="340px" />
          </div>
          <div className="mt-4">
            <JsonViewer title="verify.curl" language="bash" code={curl} maxHeight="180px" />
          </div>
        </div>
      </section>

      {/* Events feed */}
      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Recent facilitator events</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Live activity</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search payer, tx, reason"
                className="h-10 w-60 rounded-lg border border-white/[0.1] bg-white/[0.04] pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-plasma/45"
              />
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as EventFilter)}
              className="h-10 rounded-lg border border-white/[0.1] bg-[#0b1020] px-3 text-sm font-medium text-slate-200 outline-none transition focus:border-plasma/45"
            >
              <option value="all">All events</option>
              <option value="verify">Verify</option>
              <option value="settle">Settle</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div className="mt-5">
          {loading ? (
            <div className="grid gap-2">
              {[0, 1, 2, 3].map((index) => <div key={index} className="shimmer h-14 w-full rounded-xl" />)}
            </div>
          ) : filteredEvents.length === 0 ? (
            <EmptyState icon={<Activity size={24} />} title="No facilitator events yet" copy="Run a verification or settle a payment through the SDK to see live facilitator activity here." className="border-0 bg-transparent p-0 shadow-none" />
          ) : (
            <div className="grid gap-2">
              {filteredEvents.slice(0, 16).map((event) => {
                const ok = event.status === "success";
                const Icon = event.kind === "settle" ? CheckCircle2 : RadioTower;
                return (
                  <div key={event.id} className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${ok ? "border-mint/20 bg-mint/10 text-mint" : "border-magenta/20 bg-magenta/10 text-magenta"}`}>
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold capitalize text-white">{event.kind} · ${event.amountUsdc ?? 0}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span>{timeAgo(event.createdAt)}</span>
                          {event.payer ? <><span className="text-slate-700">·</span><span className="font-mono">{shortAddress(event.payer)}</span></> : null}
                          {event.payTo ? <><span className="text-slate-700">→</span><span className="font-mono">{shortAddress(event.payTo)}</span></> : null}
                          {event.reason ? <><span className="text-slate-700">·</span><span className="truncate">{event.reason}</span></> : null}
                          {event.txHash ? (
                            <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${event.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-orchid transition hover:text-white">
                              View tx <ExternalLink size={11} />
                            </a>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${ok ? "border-mint/25 bg-mint/10 text-mint" : "border-magenta/25 bg-magenta/10 text-magenta"}`}>{event.status}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MiniFact({icon, label, value}: {icon: React.ReactNode; label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 font-semibold text-white">{value}</p>
    </div>
  );
}

function CopyMini({value}: {value: string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied URL");
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <button type="button" onClick={copy} className="shrink-0 text-slate-500 transition hover:text-white" aria-label="Copy endpoint URL">
      {copied ? <CheckCircle2 size={14} className="text-mint" /> : <Copy size={14} />}
    </button>
  );
}
