import {useEffect, useMemo, useState} from "react";
import {CheckCircle2, ExternalLink, Loader2, ReceiptText, Search, ShieldCheck, XCircle, Zap, type LucideIcon} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {AgentPicker} from "@/components/AgentPicker";
import {EmptyState} from "@/components/EmptyState";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {apiGet, apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {preferredAgentChainId, savePreferredAgentChainId} from "@/lib/agent-chain-preferences";
import {navigateTo} from "@/lib/router";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Readiness = {
  enabled: boolean;
  configured: boolean;
  status: string;
  defaultChain: string;
  supportedChains: string[];
  maxPaymentUsdc: number;
  message: string;
};

type Agent = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["agents"][number];

type CircleService = {
  name: string;
  description: string;
  url: string;
  priceUsdc: number;
  publisherAddress: string | null;
  acceptedChains: string[];
  paymentScheme: string | null;
  method: string;
  inputSchema: unknown;
};

type GuardResult = {
  allowed: boolean;
  decision: "allow" | "block";
  payment: {
    walletAddress: string;
    chain: string;
    amountUsdc: number;
    requestHash: string;
    service: CircleService;
  };
  policy: {
    allowed: boolean;
    reason: string | null;
    dailySpentUsdc: number;
    weeklySpentUsdc: number;
    monthlySpentUsdc: number;
  };
  checks: Array<{status: "pass" | "fail"; label: string; detail: string}>;
};

type PaymentIntent = {
  id: string;
  status: "pending_approval" | "approved" | "rejected" | "executing" | "settled" | "failed" | "policy_blocked" | "expired";
  requestHash: string;
  source: {provider: "circle_agent_marketplace"; serviceUrl: string; inspectedAt: string};
  normalized: {
    serviceName: string;
    description: string;
    amountUsdc: number;
    payTo: string;
    chain: string;
    network?: string | null;
    paymentScheme?: string | null;
  };
  policy: {
    allowed: boolean;
    reason?: string | null;
    checks: Array<{status: "pass" | "fail"; label: string; detail: string}>;
    riskFlags: Array<{severity: "info" | "warning" | "critical"; label: string; detail: string}>;
  };
  receiptId?: string | null;
};

const defaultChainOptions = ["ARC", "BASE_SEPOLIA", "ARB_SEPOLIA"];

export default function CircleMarketplacePage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = (snapshot.data?.agents ?? []).filter((agent) => agent.walletKind !== "external_eoa");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [query, setQuery] = useState("market data");
  const [services, setServices] = useState<CircleService[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [inspection, setInspection] = useState<CircleService | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [chain, setChain] = useState("BASE_SEPOLIA");
  const [payload, setPayload] = useState("{\n  \"query\": \"USDC\"\n}");
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [createdIntent, setCreatedIntent] = useState<PaymentIntent | null>(null);
  const [busy, setBusy] = useState<"readiness" | "search" | "inspect" | "guard" | "intent" | null>("readiness");

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedService = inspection ?? services.find((service) => service.url === selectedUrl) ?? null;
  const intentQueueEnabled = readiness?.enabled === true;
  const chainOptions = readiness?.supportedChains?.length ? readiness.supportedChains : defaultChainOptions;
  const data = useMemo(() => parsePayload(payload), [payload]);

  useEffect(() => {
    let active = true;
    setBusy("readiness");
    apiGet<Readiness>("/api/circle/agent-marketplace/readiness")
      .then((result) => {
        if (!active) return;
        setReadiness(result);
        if (result.defaultChain) setChain(result.defaultChain);
      })
      .catch((error) => {
        if (!active) return;
        toast.error(circleUiMessage(error, "Circle service payments are temporarily unavailable."));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedAgent) return;
    setSelectedAgentId((current) => current || selectedAgent.id);
    const preferredChain = circleChainForId(preferredAgentChainId(selectedAgent));
    const preferredRoute = chainOptions.includes(preferredChain) ? preferredChain : chain;
    if (preferredRoute !== chain) setChain(preferredRoute);
    const chainWallet = selectedAgent.chainWallets?.find((wallet) => wallet.circleBlockchain === circleBlockchain(preferredRoute))
      ?? (preferredRoute === "ARC" ? {address: selectedAgent.address} : null);
    setWalletAddress(chainWallet?.address ?? "");
  }, [selectedAgent, chain, chainOptions]);

  async function searchServices() {
    setBusy("search");
    setGuard(null);
    setCreatedIntent(null);
    try {
      const result = await apiGet<{services: CircleService[]}>(`/api/circle/agent-marketplace/search?query=${encodeURIComponent(query)}`);
      setServices(result.services);
      if (result.services[0]) {
        setSelectedUrl(result.services[0].url);
        setInspection(null);
      }
    } catch (error) {
      toast.error(circleUiMessage(error, "Circle service search is temporarily unavailable."));
    } finally {
      setBusy(null);
    }
  }

  async function inspectService(serviceUrl = selectedUrl) {
    if (!serviceUrl) return;
    setBusy("inspect");
    setGuard(null);
    setCreatedIntent(null);
    try {
      const result = await apiPost<{service: CircleService}>("/api/circle/agent-marketplace/inspect", {serviceUrl});
      setInspection(result.service);
      setSelectedUrl(result.service.url);
      const preferredRoute = selectedAgent ? circleChainForId(preferredAgentChainId(selectedAgent)) : null;
      const supportedRoute = preferredRoute && result.service.acceptedChains.includes(preferredRoute)
        ? preferredRoute
        : result.service.acceptedChains.find((item) => chainOptions.includes(item));
      if (supportedRoute) setChain(supportedRoute);
    } catch (error) {
      toast.error(circleUiMessage(error, "Circle service details are temporarily unavailable."));
    } finally {
      setBusy(null);
    }
  }

  async function runGuard() {
    if (!address || !isConnected) {
      toast.error("Connect your wallet before running the payment guard.");
      return;
    }
    if (!selectedAgent) {
      toast.error("Create or select an agent before paying for Circle services.");
      return;
    }
    if (!walletAddress) {
      toast.error("Add the wallet address for this agent's Circle payments.");
      return;
    }
    if (!selectedService?.url) {
      toast.error("Select and inspect a Circle service first.");
      return;
    }
    if (!data.ok) {
      toast.error(data.error);
      return;
    }
    setBusy("guard");
    setCreatedIntent(null);
    try {
      const result = await apiPost<GuardResult>("/api/circle/agent-marketplace/guard", {
        operatorAddress: address,
        agentId: selectedAgent.id,
        walletAddress,
        serviceUrl: selectedService.url,
        chain,
        data: data.value
      });
      setGuard(result);
      if (!result.allowed) toast.error("Payment blocked by guard.");
    } catch (error) {
      toast.error(circleUiMessage(error, "Payment review is temporarily unavailable."));
    } finally {
      setBusy(null);
    }
  }

  async function createIntent() {
    if (!address || !selectedAgent || !selectedService || !data.ok) return;
    setBusy("intent");
    try {
      const result = await apiPost<PaymentIntent>("/api/circle/agent-marketplace/intents", {
        operatorAddress: address,
        agentId: selectedAgent.id,
        walletAddress,
        serviceUrl: selectedService.url,
        chain,
        data: data.value
      });
      setCreatedIntent(result);
      await snapshot.refetch();
      toast.success(result.status === "pending_approval" ? "Payment intent queued for approval." : "Payment intent recorded.");
    } catch (error) {
      toast.error(circleUiMessage(error, "Payment intent could not be created."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="Circle agent marketplace"
        title="Intake Circle services into Nexora controls"
        description="Search Circle services, inspect live pricing, normalize the payment details, then queue a Nexora payment intent for approval and execution."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusPanel icon={Zap} label="Intake" value={readiness?.enabled ? "Live" : "Off"} loading={busy === "readiness"} accent={readiness?.enabled} />
        <StatusPanel icon={ShieldCheck} label="Guard" value={guard?.decision ?? "Ready"} loading={busy === "guard"} accent={guard?.allowed} />
        <StatMetric variant="panel" icon={ReceiptText} label="Max call" value={readiness?.maxPaymentUsdc ?? 0} prefix="$" decimals={2} loading={busy === "readiness"} />
      </div>

      {readiness && !readiness.configured ? (
        <div className="rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm font-semibold text-amber">
          {readinessCopy(readiness)}
        </div>
      ) : null}

      <section className="panel grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3">
            <Search size={16} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500"
              placeholder="Search Circle services"
            />
            <button type="button" onClick={() => void searchServices()} className="secondary-button px-3 py-2 text-xs" disabled={busy === "search"}>
              {busy === "search" ? <Loader2 size={14} className="animate-spin" /> : null}
              Search
            </button>
          </div>

          <div className="grid gap-2">
            {services.map((service) => (
              <button
                key={service.url}
                type="button"
                onClick={() => {
                  setSelectedUrl(service.url);
                  setInspection(null);
                  void inspectService(service.url);
                }}
                className={`surface p-4 text-left transition hover:border-mint/30 ${selectedUrl === service.url ? "border-mint/35 bg-mint/10" : ""}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">{service.name}</span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">{service.description}</span>
                  </span>
                  <span className="shrink-0 rounded-lg border border-mint/25 bg-mint/10 px-2 py-1 text-xs font-bold text-mint">
                    ${service.priceUsdc || "?"}
                  </span>
                </span>
                <span className="mt-3 flex flex-wrap gap-2">
                  {service.acceptedChains.slice(0, 6).map((item) => <span key={item} className="status-pill">{circleNetworkLabel(item)}</span>)}
                  {isMainnetOnly(service.acceptedChains) ? <span className="status-pill border-cyan/25 bg-cyan/10 text-cyan">Mainnet service</span> : null}
                  {!service.acceptedChains.some((item) => chainOptions.includes(item)) ? <span className="status-pill border-amber/25 bg-amber/10 text-amber">No compatible wallet route</span> : null}
                </span>
              </button>
            ))}
          </div>

          {!services.length && busy !== "search" ? (
            <EmptyState
              icon={<Search size={24} />}
              title="Search Circle services"
              copy="Search live Circle-payable services, then review the payment details before approval."
              className="py-10"
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-orchid">Selected service</p>
                <h2 className="mt-2 truncate text-xl font-bold text-white">{selectedService?.name ?? "No service selected"}</h2>
                {selectedService?.description ? <p className="mt-2 text-sm leading-6 text-slate-400">{selectedService.description}</p> : null}
              </div>
              {selectedService?.url ? (
                <a href={selectedService.url} target="_blank" rel="noreferrer" className="secondary-button px-3 py-2 text-xs">
                  <ExternalLink size={14} />
                  Open
                </a>
              ) : null}
            </div>
            {selectedService ? (
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <MiniMetric label="Price" value={`$${selectedService.priceUsdc}`} />
                <MiniMetric label="Seller" value={selectedService.publisherAddress ? shortAddress(selectedService.publisherAddress) : "Unknown"} />
                <MiniMetric label="Scheme" value={selectedService.paymentScheme ?? "x402"} />
              </div>
            ) : null}
          </div>

          <div className="panel space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-white">Agent and payment route</p>
                <p className="mt-1 text-xs text-slate-400">Nexora queues the payment for approval first. Execution happens from Payments after approval.</p>
              </div>
              <AgentPicker agents={agents} value={selectedAgent} onChange={setSelectedAgentId} />
            </div>

            <label className="grid gap-2 text-sm font-semibold text-slate-300">
              Agent wallet address
              <input value={walletAddress} readOnly className="field font-mono text-xs" placeholder="Select a ready agent wallet" />
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-300">
              Payment chain
              <select value={chain} onChange={(event) => {
                const value = event.target.value;
                setChain(value);
                if (selectedAgent) {
                  savePreferredAgentChainId(selectedAgent, chainIdForCircleChain(value));
                  setWalletAddress(agentWalletAddressForCircleChain(selectedAgent, value));
                }
              }} className="field bg-slate-950 text-white">
                {chainOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-semibold text-slate-300">
              Request JSON
              <textarea value={payload} onChange={(event) => setPayload(event.target.value)} className="field min-h-[150px] font-mono text-xs leading-5" />
            </label>

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void runGuard()} className="secondary-button flex-1" disabled={Boolean(busy) || !selectedService}>
                {busy === "guard" ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                Run guard
              </button>
              <button type="button" onClick={() => void createIntent()} className="action-button flex-1" disabled={Boolean(busy) || !selectedService || !intentQueueEnabled || guard?.allowed !== true}>
                {busy === "intent" ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
                Create payment intent
              </button>
            </div>
          </div>
        </div>
      </section>

      {guard ? <GuardPanel guard={guard} /> : null}
      {createdIntent ? <IntentPanel intent={createdIntent} /> : null}
    </div>
  );
}

function circleBlockchain(chain: string) {
  if (chain === "ARC") return "ARC-TESTNET";
  if (chain === "BASE_SEPOLIA") return "BASE-SEPOLIA";
  if (chain === "ARB_SEPOLIA") return "ARB-SEPOLIA";
  if (chain === "BASE") return "BASE";
  if (chain === "ARB") return "ARB";
  return chain.replaceAll("_", "-");
}

function circleChainForId(chainId: number) {
  if (chainId === 5042002) return "ARC";
  if (chainId === 84532) return "BASE_SEPOLIA";
  if (chainId === 421614) return "ARB_SEPOLIA";
  if (chainId === 8453) return "BASE";
  if (chainId === 42161) return "ARB";
  return "ARC";
}

function chainIdForCircleChain(chain: string) {
  if (chain === "BASE_SEPOLIA") return 84532;
  if (chain === "ARB_SEPOLIA") return 421614;
  if (chain === "BASE") return 8453;
  if (chain === "ARB") return 42161;
  return 5042002;
}

function GuardPanel({guard}: {guard: GuardResult}) {
  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-kicker">Pre-payment guard</p>
          <h2 className="mt-2 text-xl font-bold text-white">{guard.allowed ? "Payment allowed" : "Payment blocked"}</h2>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${guard.allowed ? "border-mint/30 bg-mint/10 text-mint" : "border-magenta/30 bg-magenta/10 text-magenta"}`}>
          {guard.decision}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {guard.checks.map((item) => (
          <div key={item.label} className="surface flex items-start gap-3 p-4">
            {item.status === "pass" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-mint" /> : <XCircle size={18} className="mt-0.5 shrink-0 text-magenta" />}
            <div>
              <p className="text-sm font-bold text-white">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function IntentPanel({intent}: {intent: PaymentIntent}) {
  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Payment intent created</p>
          <h2 className="mt-2 text-xl font-bold text-white">{intent.normalized.serviceName}</h2>
          <p className="mt-2 text-sm text-slate-400">
            {usd(intent.normalized.amountUsdc)} queued for {intent.normalized.chain}. Approve and execute it from Payments.
          </p>
        </div>
        <button type="button" onClick={() => navigateTo("/payments")} className="action-button">
          <ReceiptText size={16} />
          Open Payments
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MiniMetric label="Status" value={intent.status.replaceAll("_", " ")} />
        <MiniMetric label="Recipient" value={shortAddress(intent.normalized.payTo)} />
        <MiniMetric label="Policy" value={intent.policy.allowed ? "allowed" : "blocked"} />
      </div>
      {intent.policy.riskFlags.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {intent.policy.riskFlags.map((flag) => (
            <div key={`${flag.label}-${flag.detail}`} className="surface p-3">
              <p className={`text-sm font-bold ${flag.severity === "critical" ? "text-magenta" : "text-amber"}`}>{flag.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{flag.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-4 break-all rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 font-mono text-xs text-slate-300">{intent.requestHash}</p>
    </section>
  );
}

function MiniMetric({label, value}: {label: string; value: string}) {
  return (
    <span className="surface px-3 py-2">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <b className="mt-1 block truncate text-white">{value}</b>
    </span>
  );
}

function StatusPanel({icon: Icon, label, value, loading, accent}: {icon: LucideIcon; label: string; value: string; loading?: boolean; accent?: boolean}) {
  return (
    <div className="panel flex items-center justify-between gap-3 p-4">
      <span className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${accent ? "border-mint/30 bg-mint/10 text-mint" : "border-white/[0.1] bg-white/[0.04] text-slate-400"}`}>
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
        </span>
        <span>
          <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">{label}</span>
          <b className="mt-1 block text-lg text-white">{value}</b>
        </span>
      </span>
    </div>
  );
}

function readinessCopy(readiness: Readiness) {
  if (readiness.configured) return "Circle service payments are ready.";
  if (readiness.status === "managed_wallet_unavailable") return "Service discovery, guards, and approvals are available. Managed execution needs Circle developer-wallet credentials; external Circle Agent Stack wallets can complete approved intents through the Nexora SDK.";
  if (readiness.status === "not_logged_in") return "Service discovery, guards, and approvals are available. A local Agent Stack wallet can complete an approved intent through the Nexora SDK.";
  if (readiness.status === "terms_required") return "Service discovery, guards, and approvals are available. Complete the local Circle Agent Stack wallet setup before paying an approved intent.";
  if (readiness.status === "disabled") return "Circle service intake is not enabled for this workspace.";
  if (readiness.status === "cli_missing") return "Service discovery, guards, and approvals remain available. Configure managed Circle wallet execution or use the external Agent Stack SDK flow.";
  return circleUiMessage(readiness.message, "Circle execution is temporarily unavailable. You can still search services, run guards, and queue approvals.");
}

function circleUiMessage(error: unknown, fallback: string) {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (!message) return fallback;
  if (isInternalCircleMessage(message)) return fallback;
  return message;
}

function circleNetworkLabel(network: string) {
  const labels: Record<string, string> = {
    ARC: "Arc Testnet",
    BASE_SEPOLIA: "Base Sepolia",
    ARB_SEPOLIA: "Arbitrum Sepolia",
    BASE: "Base",
    ARB: "Arbitrum",
    ETH: "Ethereum",
    AVAX: "Avalanche",
    OP: "Optimism",
    MATIC: "Polygon",
    UNI: "Unichain"
  };
  return labels[network] ?? network.replaceAll("_", " ");
}

function isMainnetOnly(networks: string[]) {
  const mainnets = new Set(["BASE", "ARB", "ETH", "AVAX", "OP", "MATIC", "UNI"]);
  return networks.length > 0 && networks.every((network) => mainnets.has(network));
}

function agentWalletAddressForCircleChain(agent: Agent, chain: string) {
  const blockchain = circleBlockchain(chain);
  return agent.chainWallets?.find((wallet) => wallet.circleBlockchain === blockchain)?.address
    ?? (chain === "ARC" ? agent.address : null)
    ?? "";
}

function isInternalCircleMessage(message: string) {
  return /Command failed|Circle CLI|\bCLI\b|backend|shell|server|network access|environment|circle\s+(--version|services|wallet)|punycode|NODE_OPTIONS|ENOENT|ECONN|ETIMEDOUT|fetch failed/i.test(message);
}

function parsePayload(value: string): {ok: true; value: Record<string, unknown>} | {ok: false; error: string} {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {ok: false, error: "Request JSON must be an object."};
    return {ok: true, value: parsed as Record<string, unknown>};
  } catch {
    return {ok: false, error: "Request JSON is invalid."};
  }
}

function usd(value?: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})}`;
}
