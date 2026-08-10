import {useEffect, useMemo, useState} from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  Filter,
  Loader2,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Wallet,
  XCircle,
  type LucideIcon
} from "lucide-react";
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

type FormField = {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  placeholder?: string;
  options?: string[];
  description?: string;
};

type DetailTab = "overview" | "request" | "payment" | "evidence";
type NetworkFilter = "all" | "compatible" | "ARC" | "BASE" | "ARB";
type SortKey = "featured" | "priceAsc" | "priceDesc" | "name";
type CheckoutStep = "discover" | "configure" | "review" | "approve" | "execute";

const defaultChainOptions = ["ARC", "BASE_SEPOLIA", "ARB_SEPOLIA"];
const STEPS: Array<{id: CheckoutStep; label: string}> = [
  {id: "discover", label: "Discover"},
  {id: "configure", label: "Configure"},
  {id: "review", label: "Review"},
  {id: "approve", label: "Approve"},
  {id: "execute", label: "Execute"}
];

export default function CircleMarketplacePage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = (snapshot.data?.agents ?? []).filter((agent) => agent.walletKind !== "external_eoa");

  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [query, setQuery] = useState("");
  const [services, setServices] = useState<CircleService[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [inspection, setInspection] = useState<CircleService | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [chain, setChain] = useState("ARC");
  const [payload, setPayload] = useState("{\n  \"query\": \"USDC\"\n}");
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [createdIntent, setCreatedIntent] = useState<PaymentIntent | null>(null);
  const [busy, setBusy] = useState<"readiness" | "search" | "inspect" | "guard" | "intent" | null>("readiness");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("featured");
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedService = inspection ?? services.find((service) => service.url === selectedUrl) ?? null;
  const intentQueueEnabled = readiness?.enabled === true;
  const chainOptions = readiness?.supportedChains?.length ? readiness.supportedChains : defaultChainOptions;
  const data = useMemo(() => parsePayload(payload), [payload]);
  const formFields = useMemo(() => extractFormFields(selectedService?.inputSchema), [selectedService?.inputSchema]);

  const activeStep = useMemo<CheckoutStep>(() => {
    if (createdIntent) return createdIntent.status === "settled" ? "execute" : "approve";
    if (guard) return "review";
    if (selectedService && (formFields.length > 0 || data.ok)) return "configure";
    if (selectedService) return "configure";
    return "discover";
  }, [createdIntent, guard, selectedService, formFields.length, data.ok]);

  const policyLabel = guard
    ? guard.allowed ? "Allowed" : "Blocked"
    : createdIntent
      ? createdIntent.policy.allowed ? "Allowed" : "Blocked"
      : "Not checked";

  const filteredServices = useMemo(() => {
    let list = [...services];
    if (networkFilter === "compatible") {
      list = list.filter((service) => service.acceptedChains.some((item) => chainOptions.includes(item)));
    } else if (networkFilter === "ARC") {
      list = list.filter((service) => service.acceptedChains.some((item) => item === "ARC" || item.startsWith("ARC")));
    } else if (networkFilter === "BASE") {
      list = list.filter((service) => service.acceptedChains.some((item) => item === "BASE" || item.startsWith("BASE")));
    } else if (networkFilter === "ARB") {
      list = list.filter((service) => service.acceptedChains.some((item) => item === "ARB" || item.startsWith("ARB")));
    }

    if (sortKey === "priceAsc") list.sort((a, b) => (a.priceUsdc || 0) - (b.priceUsdc || 0));
    if (sortKey === "priceDesc") list.sort((a, b) => (b.priceUsdc || 0) - (a.priceUsdc || 0));
    if (sortKey === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [services, networkFilter, sortKey, chainOptions]);

  useEffect(() => {
    let active = true;
    setBusy("readiness");
    apiGet<Readiness>("/api/circle/agent-marketplace/readiness")
      .then((result) => {
        if (!active) return;
        setReadiness(result);
        const preferred = result.defaultChain
          || (result.supportedChains?.includes("ARC") ? "ARC" : result.supportedChains?.[0])
          || "ARC";
        setChain(preferred);
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
    if (!readiness || hasSearched) return;
    void searchServices("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial catalog load after readiness
  }, [readiness]);

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

  async function searchServices(overrideQuery?: string) {
    const nextQuery = overrideQuery !== undefined ? overrideQuery : query;
    setBusy("search");
    setGuard(null);
    setCreatedIntent(null);
    setHasSearched(true);
    try {
      const result = await apiGet<{services: CircleService[]}>(
        `/api/circle/agent-marketplace/search?query=${encodeURIComponent(nextQuery)}`
      );
      setServices(result.services);
      if (result.services[0]) {
        setSelectedUrl(result.services[0].url);
        setInspection(null);
        setDetailTab("overview");
        setBusy("inspect");
        await inspectService(result.services[0].url, {silentSelect: true, keepBusy: true});
      } else {
        setSelectedUrl("");
        setInspection(null);
      }
    } catch (error) {
      toast.error(circleUiMessage(error, "Service search is temporarily unavailable."));
    } finally {
      setBusy(null);
    }
  }

  async function inspectService(
    serviceUrl = selectedUrl,
    options?: {silentSelect?: boolean; keepBusy?: boolean}
  ) {
    if (!serviceUrl) return;
    if (!options?.keepBusy) setBusy("inspect");
    setGuard(null);
    setCreatedIntent(null);
    if (!options?.silentSelect) setDetailTab("overview");
    try {
      const result = await apiPost<{service: CircleService}>("/api/circle/agent-marketplace/inspect", {serviceUrl});
      setInspection(result.service);
      setSelectedUrl(result.service.url);

      const preferredRoute = selectedAgent ? circleChainForId(preferredAgentChainId(selectedAgent)) : null;
      const arcRoute = result.service.acceptedChains.find((item) => item === "ARC" && chainOptions.includes(item));
      const supportedRoute = preferredRoute && result.service.acceptedChains.includes(preferredRoute) && chainOptions.includes(preferredRoute)
        ? preferredRoute
        : arcRoute
          ?? result.service.acceptedChains.find((item) => chainOptions.includes(item));
      if (supportedRoute) setChain(supportedRoute);

      const sample = sampleFromSchema(result.service.inputSchema);
      setPayload(JSON.stringify(sample, null, 2));
      setShowAdvancedJson(extractFormFields(result.service.inputSchema).length === 0);
    } catch (error) {
      toast.error(circleUiMessage(error, "Service details are temporarily unavailable."));
    } finally {
      if (!options?.keepBusy) setBusy(null);
    }
  }

  function selectService(service: CircleService) {
    setSelectedUrl(service.url);
    setInspection(null);
    setGuard(null);
    setCreatedIntent(null);
    setDetailTab("overview");
    void inspectService(service.url);
  }

  function updatePayloadObject(next: Record<string, unknown>) {
    setPayload(JSON.stringify(next, null, 2));
    setGuard(null);
    setCreatedIntent(null);
  }

  function updateField(name: string, value: unknown) {
    const current = data.ok ? data.value : {};
    updatePayloadObject({...current, [name]: value});
  }

  async function runGuard() {
    if (!address || !isConnected) {
      toast.error("Connect your operator wallet before reviewing payment.");
      return;
    }
    if (!selectedAgent) {
      toast.error("Create or select an agent before paying for services.");
      return;
    }
    if (!walletAddress) {
      toast.error("This agent has no wallet address for the selected network.");
      return;
    }
    if (!selectedService?.url) {
      toast.error("Select a service first.");
      return;
    }
    if (!data.ok) {
      toast.error(data.error);
      setDetailTab("request");
      return;
    }
    setBusy("guard");
    setCreatedIntent(null);
    setDetailTab("evidence");
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
      if (!result.allowed) toast.error("Payment blocked by policy.");
      else toast.success("Payment passed policy review.");
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
      setDetailTab("evidence");
      await snapshot.refetch();
      toast.success(result.status === "pending_approval" ? "Payment queued for approval." : "Payment intent recorded.");
    } catch (error) {
      toast.error(circleUiMessage(error, "Payment intent could not be created."));
    } finally {
      setBusy(null);
    }
  }

  function resetCheckout() {
    setGuard(null);
    setCreatedIntent(null);
    setDetailTab("overview");
    setShowTechnical(false);
  }

  const queueDisabledReason = !selectedService
    ? "Select a service"
    : !intentQueueEnabled
      ? "Marketplace queue unavailable"
      : guard?.allowed !== true
        ? "Complete policy review first"
        : !data.ok
          ? "Fix request details"
          : null;

  return (
    <div className="space-y-6 animate-fade-in pb-28 lg:pb-6">
      <PageHeader
        kicker="Circle Marketplace"
        title="Discover services agents can buy under policy control"
        description="Browse Circle-compatible paid services, configure the request, review policy, and queue settlement for operator approval. Built using Circle wallet and payment infrastructure."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusPanel
          icon={Store}
          label="Marketplace"
          value={readiness?.enabled ? "Live" : busy === "readiness" ? "…" : "Unavailable"}
          loading={busy === "readiness"}
          accent={readiness?.enabled}
        />
        <StatusPanel
          icon={ShieldCheck}
          label="Policy check"
          value={policyLabel}
          loading={busy === "guard"}
          accent={guard?.allowed === true || createdIntent?.policy.allowed === true}
        />
        <StatMetric
          variant="panel"
          icon={ReceiptText}
          label="Payment limit"
          value={readiness?.maxPaymentUsdc ?? 0}
          prefix="$"
          decimals={2}
          loading={busy === "readiness"}
        />
      </div>

      <CheckoutStepper active={activeStep} />

      {readiness && !readiness.configured ? (
        <div className="rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm font-medium leading-6 text-amber">
          {readinessCopy(readiness)}
        </div>
      ) : null}

      {!isConnected ? (
        <div className="rounded-2xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          Connect an operator wallet to review policy and queue payments. You can still browse and inspect services.
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5 min-w-0">
          <section className="panel space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-kicker">Service directory</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Find a service</h2>
              </div>
              <span className="status-pill">{filteredServices.length} shown</span>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3">
                <Search size={16} className="shrink-0 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void searchServices();
                  }}
                  className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500"
                  placeholder="Search services, data, analysis…"
                />
                <button
                  type="button"
                  onClick={() => void searchServices()}
                  className="secondary-button px-3 py-2 text-xs"
                  disabled={busy === "search"}
                >
                  {busy === "search" ? <Loader2 size={14} className="animate-spin" /> : null}
                  Search
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                <Filter size={12} /> Filter
              </span>
              {([
                ["all", "All"],
                ["compatible", "Compatible"],
                ["ARC", "Arc"],
                ["BASE", "Base"],
                ["ARB", "Arbitrum"]
              ] as Array<[NetworkFilter, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNetworkFilter(key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    networkFilter === key
                      ? "border-mint/35 bg-mint/15 text-mint"
                      : "border-white/[0.1] bg-white/[0.03] text-slate-400 hover:border-white/[0.18] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}

              <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
                Sort
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as SortKey)}
                  className="field !w-auto !py-1.5 !text-xs bg-slate-950 text-white"
                >
                  <option value="featured">Featured</option>
                  <option value="priceAsc">Price · low to high</option>
                  <option value="priceDesc">Price · high to low</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>

            {busy === "search" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[0, 1, 2, 3].map((item) => <div key={item} className="shimmer h-36 rounded-2xl" />)}
              </div>
            ) : filteredServices.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredServices.map((service) => (
                  <ServiceCard
                    key={service.url}
                    service={service}
                    selected={selectedUrl === service.url}
                    chainOptions={chainOptions}
                    onSelect={() => selectService(service)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Search size={24} />}
                title={hasSearched ? "No services match" : "Browse services"}
                copy={
                  hasSearched
                    ? "Try a broader search or clear network filters."
                    : "Search live Circle-payable services, then configure payment under Nexora policy."
                }
                className="py-10 border-0 bg-transparent shadow-none"
                action={
                  hasSearched ? (
                    <button
                      type="button"
                      className="secondary-button text-xs"
                      onClick={() => {
                        setNetworkFilter("all");
                        setQuery("");
                        void searchServices("");
                      }}
                    >
                      Reset filters
                    </button>
                  ) : undefined
                }
              />
            )}
          </section>

          <section className="panel space-y-5">
            {busy === "inspect" && !selectedService ? (
              <div className="space-y-3">
                <div className="shimmer h-8 w-48 rounded-lg" />
                <div className="shimmer h-24 rounded-xl" />
              </div>
            ) : selectedService ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex items-start gap-3">
                    <ServiceAvatar name={selectedService.name} large />
                    <div className="min-w-0">
                      <p className="section-kicker">Service detail</p>
                      <h2 className="mt-2 truncate text-2xl font-semibold text-white">{selectedService.name}</h2>
                      {selectedService.description ? (
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{selectedService.description}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="status-pill border-mint/25 bg-mint/10 text-mint">{usd(selectedService.priceUsdc)}</span>
                        <span className="status-pill">{selectedService.paymentScheme ?? "x402"}</span>
                        <span className="status-pill">{selectedService.method || "POST"}</span>
                        <span className="status-pill">{inferCategory(selectedService)}</span>
                      </div>
                    </div>
                  </div>
                  {selectedService.url ? (
                    <a href={selectedService.url} target="_blank" rel="noreferrer" className="secondary-button px-3 py-2 text-xs">
                      <ExternalLink size={14} />
                      Open endpoint
                    </a>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-1">
                  {([
                    ["overview", "Overview"],
                    ["request", "Request"],
                    ["payment", "Payment"],
                    ["evidence", "Evidence"]
                  ] as Array<[DetailTab, string]>).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setDetailTab(tab)}
                      className={`rounded-t-lg px-3 py-2 text-sm font-semibold transition ${
                        detailTab === tab
                          ? "bg-white/[0.06] text-white"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {label}
                      {tab === "evidence" && guard ? (
                        <span className={`ml-2 inline-block h-1.5 w-1.5 rounded-full ${guard.allowed ? "bg-mint" : "bg-magenta"}`} />
                      ) : null}
                    </button>
                  ))}
                </div>

                {detailTab === "overview" ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MiniMetric label="Price" value={usd(selectedService.priceUsdc)} />
                    <MiniMetric
                      label="Seller"
                      value={selectedService.publisherAddress ? shortAddress(selectedService.publisherAddress) : "Unknown"}
                      mono={Boolean(selectedService.publisherAddress)}
                      onCopy={selectedService.publisherAddress ?? undefined}
                    />
                    <MiniMetric label="Scheme" value={selectedService.paymentScheme ?? "x402"} />
                    <MiniMetric label="Method" value={selectedService.method || "POST"} />
                    <div className="surface px-3 py-2 sm:col-span-2">
                      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">Networks</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedService.acceptedChains.map((item) => (
                          <span key={item} className="status-pill">{circleNetworkLabel(item)}</span>
                        ))}
                      </div>
                    </div>
                    <div className="surface px-3 py-2 sm:col-span-full">
                      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">Compatibility</span>
                      <p className="mt-2 text-sm text-slate-300">
                        {selectedService.acceptedChains.some((item) => chainOptions.includes(item))
                          ? "Compatible with a wallet route in this workspace."
                          : "No compatible wallet route for the networks this workspace supports."}
                        {isMainnetOnly(selectedService.acceptedChains) ? " This service is mainnet-only." : ""}
                      </p>
                    </div>
                  </div>
                ) : null}

                {detailTab === "request" ? (
                  <div className="space-y-4">
                    {formFields.length > 0 ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {formFields.map((field) => (
                          <SchemaFieldInput
                            key={field.name}
                            field={field}
                            value={data.ok ? data.value[field.name] : undefined}
                            onChange={(value) => updateField(field.name, value)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                        This service did not publish a structured input schema. Use advanced JSON below.
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowAdvancedJson((value) => !value)}
                      className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-white"
                    >
                      <Code2 size={14} />
                      Advanced JSON
                      {showAdvancedJson ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {showAdvancedJson ? (
                      <label className="grid gap-2 text-sm font-semibold text-slate-300">
                        Request body
                        <textarea
                          value={payload}
                          onChange={(event) => {
                            setPayload(event.target.value);
                            setGuard(null);
                            setCreatedIntent(null);
                          }}
                          className="field min-h-[160px] font-mono text-xs leading-5"
                          spellCheck={false}
                        />
                        {!data.ok ? <span className="text-xs font-medium text-magenta">{data.error}</span> : null}
                      </label>
                    ) : !data.ok ? (
                      <p className="text-xs font-medium text-magenta">{data.error}</p>
                    ) : null}
                  </div>
                ) : null}

                {detailTab === "payment" ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-white">Agent and settlement route</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Nexora queues the payment for operator approval. Execution completes from Payments after approval.
                        </p>
                      </div>
                      <AgentPicker agents={agents} value={selectedAgent} onChange={setSelectedAgentId} />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-semibold text-slate-300">
                        Network
                        <select
                          value={chain}
                          onChange={(event) => {
                            const value = event.target.value;
                            setChain(value);
                            setGuard(null);
                            setCreatedIntent(null);
                            if (selectedAgent) {
                              savePreferredAgentChainId(selectedAgent, chainIdForCircleChain(value));
                              setWalletAddress(agentWalletAddressForCircleChain(selectedAgent, value));
                            }
                          }}
                          className="field bg-slate-950 text-white"
                        >
                          {chainOptions.map((item) => (
                            <option key={item} value={item}>{circleNetworkLabel(item)}</option>
                          ))}
                        </select>
                      </label>

                      <div className="grid gap-2 text-sm font-semibold text-slate-300">
                        Agent wallet
                        <div className="field flex items-center justify-between gap-2 font-mono text-xs">
                          <span className="truncate text-slate-200">
                            {walletAddress ? shortAddress(walletAddress) : "No wallet on this network"}
                          </span>
                          {walletAddress ? (
                            <button
                              type="button"
                              className="shrink-0 text-slate-400 hover:text-white"
                              onClick={() => void copyText(walletAddress, "Wallet address copied")}
                              aria-label="Copy wallet address"
                            >
                              <Copy size={14} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {!selectedAgent ? (
                      <div className="rounded-xl border border-amber/25 bg-amber/10 px-4 py-3 text-sm text-amber">
                        Create or select an agent wallet before reviewing payment.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {detailTab === "evidence" ? (
                  <div className="space-y-4">
                    {guard ? <GuardPanel guard={guard} compact /> : (
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-400">
                        Run policy review to see pass and fail checks for this payment.
                      </div>
                    )}
                    {createdIntent ? (
                      <IntentPanel
                        intent={createdIntent}
                        showTechnical={showTechnical}
                        onToggleTechnical={() => setShowTechnical((value) => !value)}
                        onBuyAnother={resetCheckout}
                      />
                    ) : null}
                  </div>
                ) : null}

                {busy === "inspect" ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    Refreshing live pricing and requirements…
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                icon={<Sparkles size={24} />}
                title="Select a service"
                copy="Choose a service from the directory to inspect pricing, configure the request, and review payment under policy."
                className="border-0 bg-transparent py-8 shadow-none"
              />
            )}
          </section>
        </div>

        <aside className="xl:sticky xl:top-6 space-y-4">
          <section className="panel space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="section-kicker">Checkout</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Payment review</h2>
              </div>
              <Wallet size={18} className="text-slate-500" />
            </div>

            {selectedService ? (
              <div className="space-y-3">
                <div className="surface flex items-start gap-3 p-3">
                  <ServiceAvatar name={selectedService.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{selectedService.name}</p>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{selectedService.description || "Paid API service"}</p>
                  </div>
                </div>

                <div className="grid gap-2">
                  <ReviewRow label="Amount" value={usd(selectedService.priceUsdc)} emphasize />
                  <ReviewRow label="Network" value={circleNetworkLabel(chain)} />
                  <ReviewRow label="Scheme" value={selectedService.paymentScheme ?? "x402"} />
                  <ReviewRow
                    label="Agent"
                    value={
                      selectedAgent
                        ? selectedAgent.arcName || shortAddress(selectedAgent.address || selectedAgent.operatorAddress)
                        : "Not selected"
                    }
                  />
                  <ReviewRow
                    label="Wallet"
                    value={walletAddress ? shortAddress(walletAddress) : "—"}
                    mono
                  />
                  <ReviewRow
                    label="Policy"
                    value={policyLabel}
                    tone={guard?.allowed === true ? "good" : guard?.allowed === false ? "bad" : "muted"}
                  />
                  {createdIntent ? (
                    <ReviewRow label="Intent" value={createdIntent.status.replaceAll("_", " ")} />
                  ) : null}
                </div>

                {guard && !guard.allowed ? (
                  <div className="rounded-xl border border-magenta/25 bg-magenta/10 px-3 py-2 text-xs leading-5 text-magenta">
                    {guard.policy.reason || "Policy blocked this payment. Open Evidence for failed checks."}
                  </div>
                ) : null}

                {queueDisabledReason && !createdIntent ? (
                  <p className="text-xs text-slate-500">{queueDisabledReason}</p>
                ) : null}

                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab(detailTab === "request" ? "payment" : "request")}
                    className="secondary-button w-full justify-center text-sm"
                    disabled={!selectedService}
                  >
                    Configure request
                  </button>
                  <button
                    type="button"
                    onClick={() => void runGuard()}
                    className="secondary-button w-full justify-center text-sm"
                    disabled={Boolean(busy) || !selectedService}
                  >
                    {busy === "guard" ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    Review payment
                  </button>
                  <button
                    type="button"
                    onClick={() => void createIntent()}
                    className="action-button w-full justify-center text-sm"
                    disabled={Boolean(busy) || !selectedService || !intentQueueEnabled || guard?.allowed !== true}
                  >
                    {busy === "intent" ? <Loader2 size={16} className="animate-spin" /> : <ReceiptText size={16} />}
                    Queue for approval
                  </button>
                  {createdIntent ? (
                    <button
                      type="button"
                      onClick={() => navigateTo("/payments")}
                      className="action-button w-full justify-center text-sm"
                    >
                      Approve & execute
                      <ArrowRight size={16} />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.12] px-4 py-8 text-center">
                <Store size={22} className="mx-auto text-slate-500" />
                <p className="mt-3 text-sm font-semibold text-white">No service selected</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Select a service to build a payment under operator policy.</p>
              </div>
            )}
          </section>

          {guard ? (
            <section className="panel space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-white">Policy checks</p>
                <span className={`status-pill ${guard.allowed ? "border-mint/25 bg-mint/10 text-mint" : "border-magenta/25 bg-magenta/10 text-magenta"}`}>
                  {guard.allowed ? "Pass" : "Fail"}
                </span>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {guard.checks.map((item) => (
                  <div key={item.label} className="flex items-start gap-2 text-xs leading-5">
                    {item.status === "pass"
                      ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-mint" />
                      : <XCircle size={14} className="mt-0.5 shrink-0 text-magenta" />}
                    <div>
                      <p className="font-semibold text-white">{item.label}</p>
                      <p className="text-slate-400">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {/* Mobile sticky checkout bar */}
      {selectedService ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.1] bg-slate-950/95 px-4 py-3 backdrop-blur-xl xl:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{selectedService.name}</p>
              <p className="text-xs text-mint">{usd(selectedService.priceUsdc)} · {policyLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => void (guard?.allowed ? createIntent() : runGuard())}
              className="action-button shrink-0 px-4 py-2 text-sm"
              disabled={Boolean(busy)}
            >
              {busy === "guard" || busy === "intent" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : guard?.allowed ? (
                "Queue"
              ) : (
                "Review"
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CheckoutStepper({active}: {active: CheckoutStep}) {
  const activeIndex = STEPS.findIndex((step) => step.id === active);
  return (
    <nav aria-label="Checkout progress" className="panel !py-4">
      <ol className="flex flex-wrap items-center gap-2 sm:gap-0 sm:justify-between">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const current = index === activeIndex;
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                  done
                    ? "border-mint/40 bg-mint/15 text-mint"
                    : current
                      ? "border-orchid/40 bg-orchid/15 text-orchid"
                      : "border-white/[0.1] bg-white/[0.03] text-slate-500"
                }`}
              >
                {done ? <CheckCircle2 size={14} /> : index + 1}
              </span>
              <span className={`truncate text-xs font-semibold sm:text-sm ${current ? "text-white" : done ? "text-mint" : "text-slate-500"}`}>
                {step.label}
              </span>
              {index < STEPS.length - 1 ? (
                <span className={`mx-1 hidden h-px flex-1 sm:block ${done ? "bg-mint/40" : "bg-white/[0.08]"}`} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ServiceCard({
  service,
  selected,
  chainOptions,
  onSelect
}: {
  service: CircleService;
  selected: boolean;
  chainOptions: string[];
  onSelect: () => void;
}) {
  const compatible = service.acceptedChains.some((item) => chainOptions.includes(item));
  const category = inferCategory(service);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`surface group p-4 text-left transition hover:border-mint/30 hover:-translate-y-0.5 ${
        selected ? "border-mint/40 bg-mint/10 ring-1 ring-mint/20" : ""
      }`}
    >
      <span className="flex items-start gap-3">
        <ServiceAvatar name={service.name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-bold text-white group-hover:text-mint">{service.name}</span>
            <span className="shrink-0 rounded-lg border border-mint/25 bg-mint/10 px-2 py-1 text-xs font-bold text-mint">
              {service.priceUsdc != null && service.priceUsdc > 0 ? usd(service.priceUsdc) : "—"}
            </span>
          </span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">
            {service.description || "Paid Circle-compatible service"}
          </span>
        </span>
      </span>

      <span className="mt-3 flex flex-wrap gap-1.5">
        <span className="status-pill">{category}</span>
        <span className="status-pill">{service.paymentScheme ?? "x402"}</span>
        {service.acceptedChains.slice(0, 3).map((item) => (
          <span key={item} className="status-pill">{circleNetworkLabel(item)}</span>
        ))}
        {service.acceptedChains.length > 3 ? (
          <span className="status-pill">+{service.acceptedChains.length - 3}</span>
        ) : null}
        {compatible ? (
          <span className="status-pill border-mint/25 bg-mint/10 text-mint">
            <BadgeCheck size={11} className="mr-1 inline" />
            Ready
          </span>
        ) : (
          <span className="status-pill border-amber/25 bg-amber/10 text-amber">No wallet route</span>
        )}
        {isMainnetOnly(service.acceptedChains) ? (
          <span className="status-pill border-cyan/25 bg-cyan/10 text-cyan">Mainnet</span>
        ) : null}
      </span>
    </button>
  );
}

function ServiceAvatar({name, large}: {name: string; large?: boolean}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "S";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl border border-orchid/25 bg-gradient-to-br from-orchid/20 to-mint/10 font-bold text-orchid ${
        large ? "h-12 w-12 text-sm" : "h-10 w-10 text-xs"
      }`}
    >
      {initials}
    </span>
  );
}

function SchemaFieldInput({
  field,
  value,
  onChange
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <span className="flex items-center gap-1">
      {field.label}
      {field.required ? <span className="text-magenta">*</span> : null}
    </span>
  );

  if (field.type === "boolean") {
    return (
      <label className="surface flex items-center justify-between gap-3 p-3 text-sm font-semibold text-slate-300">
        <span>
          {label}
          {field.description ? <span className="mt-1 block text-xs font-normal text-slate-500">{field.description}</span> : null}
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-mint"
        />
      </label>
    );
  }

  if (field.type === "select" && field.options?.length) {
    return (
      <label className="grid gap-2 text-sm font-semibold text-slate-300">
        {label}
        <select
          value={value == null ? "" : String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="field bg-slate-950 text-white"
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {field.description ? <span className="text-xs font-normal text-slate-500">{field.description}</span> : null}
      </label>
    );
  }

  return (
    <label className="grid gap-2 text-sm font-semibold text-slate-300">
      {label}
      <input
        type={field.type === "number" ? "number" : "text"}
        value={value == null ? "" : String(value)}
        onChange={(event) => {
          if (field.type === "number") {
            const next = event.target.value;
            onChange(next === "" ? "" : Number(next));
            return;
          }
          onChange(event.target.value);
        }}
        placeholder={field.placeholder}
        className="field"
      />
      {field.description ? <span className="text-xs font-normal text-slate-500">{field.description}</span> : null}
    </label>
  );
}

function GuardPanel({guard, compact}: {guard: GuardResult; compact?: boolean}) {
  return (
    <div className={compact ? "space-y-3" : "panel"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!compact ? <p className="section-kicker">Policy review</p> : null}
          <h3 className={`${compact ? "text-base" : "mt-2 text-xl"} font-bold text-white`}>
            {guard.allowed ? "Payment allowed" : "Payment blocked"}
          </h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-sm font-bold ${
          guard.allowed ? "border-mint/30 bg-mint/10 text-mint" : "border-magenta/30 bg-magenta/10 text-magenta"
        }`}>
          {guard.decision}
        </span>
      </div>
      <div className={`mt-3 grid gap-3 ${compact ? "" : "md:grid-cols-2"}`}>
        {guard.checks.map((item) => (
          <div key={item.label} className="surface flex items-start gap-3 p-3">
            {item.status === "pass"
              ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-mint" />
              : <XCircle size={18} className="mt-0.5 shrink-0 text-magenta" />}
            <div>
              <p className="text-sm font-bold text-white">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntentPanel({
  intent,
  showTechnical,
  onToggleTechnical,
  onBuyAnother
}: {
  intent: PaymentIntent;
  showTechnical: boolean;
  onToggleTechnical: () => void;
  onBuyAnother: () => void;
}) {
  return (
    <div className="rounded-2xl border border-mint/25 bg-mint/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mint">Queued successfully</p>
          <h3 className="mt-2 text-lg font-bold text-white">{intent.normalized.serviceName}</h3>
          <p className="mt-2 text-sm text-slate-300">
            {usd(intent.normalized.amountUsdc)} on {circleNetworkLabel(intent.normalized.chain)}. Approve and execute from Payments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onBuyAnother} className="secondary-button text-xs">
            Buy another
          </button>
          <button type="button" onClick={() => navigateTo("/payments")} className="action-button text-xs">
            <ReceiptText size={14} />
            Open Payments
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MiniMetric label="Status" value={intent.status.replaceAll("_", " ")} />
        <MiniMetric label="Recipient" value={shortAddress(intent.normalized.payTo)} mono />
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

      <button
        type="button"
        onClick={onToggleTechnical}
        className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-white"
      >
        Technical details
        {showTechnical ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {showTechnical ? (
        <p className="mt-2 break-all rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 font-mono text-xs text-slate-300">
          {intent.requestHash}
        </p>
      ) : null}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  emphasize,
  mono,
  tone
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  mono?: boolean;
  tone?: "good" | "bad" | "muted";
}) {
  const valueClass = tone === "good"
    ? "text-mint"
    : tone === "bad"
      ? "text-magenta"
      : emphasize
        ? "text-mint"
        : "text-white";
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`truncate font-semibold ${mono ? "font-mono text-xs" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  mono,
  onCopy
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: string;
}) {
  return (
    <span className="surface flex items-start justify-between gap-2 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <b className={`mt-1 block truncate text-white ${mono ? "font-mono text-xs" : ""}`}>{value}</b>
      </span>
      {onCopy ? (
        <button
          type="button"
          className="mt-1 shrink-0 text-slate-500 hover:text-white"
          onClick={() => void copyText(onCopy, "Copied")}
          aria-label={`Copy ${label}`}
        >
          <Copy size={13} />
        </button>
      ) : null}
    </span>
  );
}

function StatusPanel({
  icon: Icon,
  label,
  value,
  loading,
  accent
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="panel flex items-center justify-between gap-3 p-4">
      <span className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
          accent ? "border-mint/30 bg-mint/10 text-mint" : "border-white/[0.1] bg-white/[0.04] text-slate-400"
        }`}>
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

function extractFormFields(schema: unknown): FormField[] {
  if (!schema) return [];

  if (Array.isArray(schema)) {
    return schema
      .map((entry) => normalizeFieldEntry(entry))
      .filter((field): field is FormField => Boolean(field));
  }

  if (typeof schema !== "object") return [];
  const root = schema as Record<string, unknown>;

  if (root.properties && typeof root.properties === "object" && !Array.isArray(root.properties)) {
    const required = new Set(
      Array.isArray(root.required) ? root.required.filter((item): item is string => typeof item === "string") : []
    );
    return Object.entries(root.properties as Record<string, unknown>)
      .map(([name, def]) => normalizeFieldEntry({...(typeof def === "object" && def ? def : {}), name, required: required.has(name)}))
      .filter((field): field is FormField => Boolean(field));
  }

  if (Array.isArray(root.fields)) {
    return root.fields
      .map((entry) => normalizeFieldEntry(entry))
      .filter((field): field is FormField => Boolean(field));
  }

  if (typeof root.name === "string") {
    const field = normalizeFieldEntry(root);
    return field ? [field] : [];
  }

  return [];
}

function normalizeFieldEntry(entry: unknown): FormField | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown>;
  const name = stringValue(item.name ?? item.key ?? item.id ?? item.field);
  if (!name) return null;

  const enumValues = Array.isArray(item.enum)
    ? item.enum.filter((value): value is string | number => typeof value === "string" || typeof value === "number").map(String)
    : Array.isArray(item.options)
      ? item.options.map((value) => {
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (value && typeof value === "object" && "value" in value) return String((value as {value: unknown}).value);
        return "";
      }).filter(Boolean)
      : undefined;

  const rawType = String(item.type ?? item.inputType ?? (enumValues?.length ? "select" : "string")).toLowerCase();
  let type: FormField["type"] = "string";
  if (rawType.includes("bool")) type = "boolean";
  else if (rawType.includes("number") || rawType.includes("int") || rawType.includes("float")) type = "number";
  else if (rawType.includes("select") || rawType.includes("enum") || (enumValues && enumValues.length > 0)) type = "select";

  return {
    name,
    label: stringValue(item.label ?? item.title) || humanize(name),
    type,
    required: Boolean(item.required),
    placeholder: stringValue(item.placeholder ?? item.example ?? item.default) || undefined,
    options: enumValues,
    description: stringValue(item.description ?? item.help) || undefined
  };
}

function sampleFromSchema(schema: unknown): Record<string, unknown> {
  const fields = extractFormFields(schema);
  if (!fields.length) return {query: "USDC"};

  const sample: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "boolean") {
      sample[field.name] = false;
      continue;
    }
    if (field.type === "number") {
      const numeric = field.placeholder != null && field.placeholder !== "" ? Number(field.placeholder) : 0;
      sample[field.name] = Number.isFinite(numeric) ? numeric : 0;
      continue;
    }
    if (field.type === "select") {
      sample[field.name] = field.options?.[0] ?? "";
      continue;
    }
    sample[field.name] = field.placeholder ?? "";
  }
  return sample;
}

function inferCategory(service: CircleService): string {
  const haystack = `${service.name} ${service.description}`.toLowerCase();
  if (/github|repo|code|git/.test(haystack)) return "Builder";
  if (/market|price|ticker|ohlc|trading|swap/.test(haystack)) return "Market data";
  if (/risk|score|fraud|compliance|kyc|aml/.test(haystack)) return "Risk";
  if (/yield|apy|vault|earn|defi/.test(haystack)) return "Yield";
  if (/wallet|balance|transfer|payment|usdc/.test(haystack)) return "Payments";
  if (/news|summar|text|nlp|llm|ai/.test(haystack)) return "Intelligence";
  if (/weather|geo|map/.test(haystack)) return "Data";
  return "Service";
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

function readinessCopy(readiness: Readiness) {
  if (readiness.configured) return "Circle service payments are ready.";
  if (readiness.status === "managed_wallet_unavailable") {
    return "Discovery, policy review, and approvals are available. Managed execution needs Circle developer-wallet credentials; external Circle Agent Stack wallets can complete approved intents through the Nexora SDK.";
  }
  if (readiness.status === "not_logged_in") {
    return "Discovery, policy review, and approvals are available. A local Agent Stack wallet can complete an approved intent through the Nexora SDK.";
  }
  if (readiness.status === "terms_required") {
    return "Discovery, policy review, and approvals are available. Complete the local Circle Agent Stack wallet setup before paying an approved intent.";
  }
  if (readiness.status === "disabled") return "Circle service marketplace is not enabled for this workspace.";
  if (readiness.status === "cli_missing") {
    return "Discovery, policy review, and approvals remain available. Configure managed Circle wallet execution or use the external Agent Stack SDK flow.";
  }
  return circleUiMessage(readiness.message, "Execution is temporarily unavailable. You can still search services, review policy, and queue approvals.");
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {ok: false, error: "Request body must be a JSON object."};
    }
    return {ok: true, value: parsed as Record<string, unknown>};
  } catch {
    return {ok: false, error: "Request JSON is invalid."};
  }
}

function usd(value?: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
  } catch {
    toast.error("Could not copy to clipboard.");
  }
}
