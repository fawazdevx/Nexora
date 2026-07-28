import {useEffect, useMemo, useState} from "react";
import {Activity, ArrowUpRight, BadgeCheck, Banknote, BarChart3, BriefcaseBusiness, CalendarCheck, CheckCircle2, ExternalLink, FileSearch, GitFork, Globe, Layers, Landmark, LineChart, MessageSquareText, Plus, ReceiptText, Route, Search, ShieldCheck, Sparkles, Star, Store, TrendingUp, Wallet, Loader2, X, type LucideIcon} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {AgentPicker} from "@/components/AgentPicker";
import {AgentAvatar} from "@/components/AgentAvatar";
import {apiGet, apiPost} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {arcTestnet, marketplaceSettlementChains, shortAddress, supportedChains, switchToChain} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {publishX402Services, settleX402Request, type NexoraStructuredMemo} from "@/lib/contracts";
import {MARKETPLACE_CATEGORY_DESCRIPTIONS, executionArgs, formatCategory, formatKind, sampleInputForService, serviceCategory, serviceInputLabel, serviceInputPlaceholder, serviceReadiness, type MarketplaceCategoryKey} from "@/lib/marketplace";
import {agentWalletChainIds, preferredAgentChainId, savePreferredAgentChainId} from "@/lib/agent-chain-preferences";

type Service = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["services"][number];
type Agent = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["agents"][number];
type ServiceGroup = {key: string; service: Service; routes: Service[]};
type CanonicalCatalog = {
  publisherAddress: string | null;
  chains: Array<{chainId: number; label: string; ledger: string; configured: boolean}>;
  services: Array<{
    name: string;
    endpointHash: string;
    pricePerUnitUsdc: number;
    manifestKind: Service["manifest"]["kind"];
    routes: Array<{id: string; chainServiceId: number; settlementChainId: number; txHash?: string | null}>;
  }>;
};
type GatewayCatalog = {
  ready: boolean;
  status: string;
  mode: "testnet" | "mainnet";
  sellerAddress: string | null;
  networks: string[];
  networkDetails: Array<{network: string; chainId: number; label: string}>;
  services: Array<{
    name: string;
    endpointHash: string;
    pricePerUnitUsdc: number;
    manifestKind: Service["manifest"]["kind"];
    manifest: Service["manifest"];
    path: string;
    resource: string;
    method: "POST";
  }>;
};
type PublicMarketplaceCatalog = {
  schemaVersion: string;
  marketplace: "Nexora";
  x402: GatewayCatalog;
  ledgerRoutes: CanonicalCatalog;
};
type SortKey = "featured" | "priceAsc" | "priceDesc" | "name";
type PrivacyScope = "public" | "selective" | "private";

const PRIVACY_OPTIONS: Array<{value: PrivacyScope; label: string; copy: string}> = [
  {value: "selective", label: "Selective", copy: "Budget, policy, and intent only"},
  {value: "private", label: "Private", copy: "Scope and timestamp only"},
  {value: "public", label: "Public", copy: "Full purchase metadata"}
];

const CATEGORIES: Array<{key: MarketplaceCategoryKey; label: string; icon: LucideIcon}> = [
  {key: "all", label: "All", icon: Store},
  {key: "risk", label: "Risk", icon: ShieldCheck},
  {key: "payments", label: "Payments", icon: ReceiptText},
  {key: "treasury", label: "Treasury", icon: Landmark},
  {key: "escrow", label: "Escrow", icon: BriefcaseBusiness},
  {key: "trading", label: "Trading", icon: LineChart},
  {key: "yield", label: "Yield", icon: TrendingUp},
  {key: "compliance", label: "Compliance", icon: BadgeCheck},
  {key: "data", label: "Data", icon: BarChart3},
  {key: "builder", label: "Builder", icon: FileSearch}
];

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

function kindIcon(kind: string) {
  if (kind.includes("website")) return Globe;
  if (kind.includes("github")) return GitFork;
  if (kind.includes("x_account") || kind.includes("twitter")) return MessageSquareText;
  if (kind.includes("meeting")) return CalendarCheck;
  if (kind.includes("domain")) return BadgeCheck;
  if (kind.includes("social")) return MessageSquareText;
  if (kind.includes("route")) return Route;
  if (kind.includes("wallet")) return Wallet;
  if (kind.includes("stablecoin")) return Banknote;
  if (kind.includes("launch") || kind.includes("integration") || kind.includes("builder")) return FileSearch;
  return ShieldCheck;
}

function txToast(title: string, hash: string, chainId: number) {
  const target = marketplaceSettlementChains.find((item) => item.id === chainId) ?? marketplaceSettlementChains[0];
  const href = `${target.blockExplorers.default.url.replace(/\/$/, "")}/tx/${hash}`;
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
  const {address, chain, isConnected} = useAccount();
  const [serviceInputs, setServiceInputs] = useState<Record<string, string>>({});
  const [serviceResults, setServiceResults] = useState<Record<string, unknown>>({});
  const [resultDialog, setResultDialog] = useState<{service: Service; result: unknown} | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [privacyScope, setPrivacyScope] = useState<PrivacyScope>("selective");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MarketplaceCategoryKey>("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("featured");
  const [settlementChainId, setSettlementChainId] = useState(arcTestnet.id);
  const [pendingPurchase, setPendingPurchase] = useState<{service: Service; serviceKey: string} | null>(null);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
  const [publishingMissingRoutes, setPublishingMissingRoutes] = useState(false);
  const [canonicalCatalog, setCanonicalCatalog] = useState<CanonicalCatalog | null>(null);
  const [gatewayCatalog, setGatewayCatalog] = useState<GatewayCatalog | null>(null);
  const [routeImportHash, setRouteImportHash] = useState("");
  const [routeImportChainId, setRouteImportChainId] = useState(arcTestnet.id);
  const [importingRoute, setImportingRoute] = useState(false);
  const snapshot = useAppSnapshot();
  const agents = (snapshot.data?.agents ?? []).filter((agent) => agent.walletKind !== "external_eoa");
  const services = snapshot.data?.services ?? [];
  const directoryServices = useMemo(
    () => marketplaceDirectoryServices(services, gatewayCatalog),
    [services, gatewayCatalog]
  );
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const serviceGroups = useMemo(
    () => groupMarketplaceServices(directoryServices, canonicalCatalog?.publisherAddress),
    [directoryServices, canonicalCatalog?.publisherAddress]
  );
  const isCanonicalPublisher = Boolean(
    address
    && canonicalCatalog?.publisherAddress
    && address.toLowerCase() === canonicalCatalog.publisherAddress.toLowerCase()
  );
  const configuredCanonicalChains = useMemo(
    () => canonicalCatalog?.chains.filter((item) => item.configured && marketplaceSettlementChains.some((chain) => chain.id === item.chainId)) ?? [],
    [canonicalCatalog]
  );
  const ownedMissingRouteCount = useMemo(
    () => isCanonicalPublisher
      ? (canonicalCatalog?.services ?? []).reduce(
          (total, service) => total + configuredCanonicalChains.filter(
            (target) => !service.routes.some((route) => route.settlementChainId === target.chainId)
          ).length,
          0
        )
      : 0,
    [canonicalCatalog, configuredCanonicalChains, isCanonicalPublisher]
  );
  const selectedAgentWalletChains = useMemo(
    () => selectedAgent ? agentWalletChainIds(selectedAgent) : [],
    [selectedAgent]
  );
  const selectedAgentChainWallet = selectedAgent?.chainWallets?.find((wallet) => wallet.chainId === settlementChainId)
    ?? (selectedAgent && settlementChainId === arcTestnet.id
      ? {address: selectedAgent.address, circleWalletId: selectedAgent.circleWalletId}
      : null);
  const selectedAgentPolicyReady = selectedAgent ? hasRecordedAgentPolicy(selectedAgent, settlementChainId) : false;
  const selectedAgentNeedsNativeGas = Boolean(
    selectedAgent
    && settlementChainId !== arcTestnet.id
    && (selectedAgent.circleAccountType === "EOA" || selectedAgent.settlementMode === "eoa_memo")
  );

  useEffect(() => {
    if (!selectedAgent) return;
    setSelectedAgentId((current) => current || selectedAgent.id);
    setSettlementChainId(preferredAgentChainId(selectedAgent));
  }, [selectedAgent?.id]);

  useEffect(() => {
    let active = true;
    apiGet<PublicMarketplaceCatalog>("/api/marketplace/catalog")
      .then((catalog) => {
        if (!active) return;
        setCanonicalCatalog(catalog.ledgerRoutes);
        setGatewayCatalog(catalog.x402);
        const firstConfigured = catalog.ledgerRoutes.chains.find((item) => item.configured);
        if (firstConfigured) setRouteImportChainId(firstConfigured.chainId);
      })
      .catch(() => {
        if (active) {
          setCanonicalCatalog(null);
          setGatewayCatalog(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const kinds = useMemo(() => Array.from(new Set(serviceGroups.map((group) => group.service.manifest.kind))), [serviceGroups]);
  const settledVolume = snapshot.data?.stats.usdcSettled ?? 0;
  const multichainServices = serviceGroups.filter((group) => marketplaceSettlementChains.every((chain) => (
    routeForChain(group, chain.id, canonicalCatalog?.publisherAddress)
    || (gatewayCatalog?.ready
      && gatewayCatalog.networkDetails.some((network) => network.chainId === chain.id)
      && gatewayCatalog.services.some((service) => service.endpointHash === group.service.endpointHash))
  ))).length;
  const featuredServices = serviceGroups.filter((group) => group.service.featured).length;
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(CATEGORIES.map((category) => [category.key, 0])) as Record<MarketplaceCategoryKey, number>;
    counts.all = serviceGroups.length;
    for (const group of serviceGroups) counts[serviceCategory(group.service)] += 1;
    return counts;
  }, [serviceGroups]);

  const visibleServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = serviceGroups.filter((group) => {
      const service = routeForChain(group, settlementChainId, canonicalCatalog?.publisherAddress) ?? group.service;
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
      const serviceA = routeForChain(a, settlementChainId, canonicalCatalog?.publisherAddress) ?? a.service;
      const serviceB = routeForChain(b, settlementChainId, canonicalCatalog?.publisherAddress) ?? b.service;
      if (sort === "priceAsc") return Number(serviceA.pricePerUnitUsdc) - Number(serviceB.pricePerUnitUsdc);
      if (sort === "priceDesc") return Number(serviceB.pricePerUnitUsdc) - Number(serviceA.pricePerUnitUsdc);
      if (sort === "name") return serviceA.name.localeCompare(serviceB.name);
      return Number(Boolean(serviceB.featured)) - Number(Boolean(serviceA.featured));
    });
    return sorted;
  }, [serviceGroups, query, categoryFilter, kindFilter, sort, settlementChainId, canonicalCatalog?.publisherAddress]);

  async function publishOwnedMissingRoutes() {
    if (!address || !canonicalCatalog || !isCanonicalPublisher || publishingMissingRoutes || ownedMissingRouteCount === 0) return;
    setPublishingMissingRoutes(true);
    const toastId = toast.loading("Preparing missing Marketplace routes…");
    let completedNetworks = 0;
    try {
      for (const configuredTarget of configuredCanonicalChains) {
        const target = marketplaceSettlementChains.find((chain) => chain.id === configuredTarget.chainId);
        if (!target) continue;
        const missingServices = canonicalCatalog.services.filter(
          (service) => !service.routes.some((route) => route.settlementChainId === target.id)
        );
        if (missingServices.length === 0) continue;
        toast.loading(`Publish ${missingServices.length} service route${missingServices.length === 1 ? "" : "s"} on ${target.name}…`, {id: toastId});
        await switchToChain(target);
        const publications = await publishX402Services({
          chainId: target.id,
          services: missingServices.map((service) => ({
            endpointHash: service.endpointHash,
            pricePerUnitUsdc: String(service.pricePerUnitUsdc)
          }))
        });
        const txHash = publications[0]?.txHash;
        if (!txHash || publications.some((publication) => publication.txHash !== txHash)) {
          throw new Error("The Marketplace batch transaction could not be identified.");
        }
        const reconciled = await apiPost<{catalog: CanonicalCatalog}>("/api/marketplace/canonical-routes/reconcile", {
          publisherAddress: address,
          settlementChainId: target.id,
          txHash
        });
        setCanonicalCatalog(reconciled.catalog);
        completedNetworks += 1;
        await snapshot.refetch();
      }
      toast.success(`Published all missing routes in ${completedNetworks} batched network transaction${completedNetworks === 1 ? "" : "s"}.`, {id: toastId});
    } catch (error) {
      const prefix = completedNetworks > 0 ? `${completedNetworks} network batch${completedNetworks === 1 ? "" : "es"} completed. ` : "";
      toast.error(`${prefix}${marketplaceErrorMessage(error)}`, {id: toastId});
    } finally {
      setPublishingMissingRoutes(false);
    }
  }

  async function importPublicationReceipt() {
    if (!address || !canonicalCatalog || !isCanonicalPublisher || importingRoute) return;
    if (!/^0x[0-9a-fA-F]{64}$/.test(routeImportHash.trim())) {
      toast.error("Enter a valid Marketplace publication transaction hash.");
      return;
    }
    setImportingRoute(true);
    const toastId = toast.loading("Verifying the on-chain Marketplace publication…");
    try {
      const reconciled = await apiPost<{catalog: CanonicalCatalog; verifiedPublications: number}>("/api/marketplace/canonical-routes/reconcile", {
        publisherAddress: address,
        settlementChainId: routeImportChainId,
        txHash: routeImportHash.trim()
      });
      setCanonicalCatalog(reconciled.catalog);
      await snapshot.refetch();
      setRouteImportHash("");
      toast.success(`Verified and imported ${reconciled.verifiedPublications} route${reconciled.verifiedPublications === 1 ? "" : "s"}.`, {id: toastId});
    } catch (error) {
      toast.error(marketplaceErrorMessage(error), {id: toastId});
    } finally {
      setImportingRoute(false);
    }
  }

  async function purchase(service: Service, serviceKey: string, networkConfirmed = false) {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before purchasing an x402 service.");
      return;
    }
    if (!selectedAgent) {
      toast.error("Create an agent wallet before purchasing an API.");
      return;
    }
    if (!service.chainServiceId) {
      toast.error("This service must be published on-chain before purchase.");
      return;
    }
    if (!service.settlementChainId) {
      toast.error("This service does not have an explicit settlement network.");
      return;
    }
    const routeChainId = service.settlementChainId;
    if (routeChainId !== settlementChainId) {
      toast.error(`Select the ${marketplaceChainLabel(routeChainId)} agent route before purchasing this service.`);
      return;
    }
    const settlementWallet = selectedAgent.chainWallets?.find((wallet) => wallet.chainId === routeChainId)
      ?? (routeChainId === arcTestnet.id
        ? {circleWalletId: selectedAgent.circleWalletId, address: selectedAgent.address}
        : null);
    const canUseCircleAgentSettlement = Boolean(settlementWallet?.circleWalletId && settlementWallet.address);
    if (canUseCircleAgentSettlement && !hasRecordedAgentPolicy(selectedAgent, routeChainId)) {
      toast.error(`Save this agent's policy on ${marketplaceChainLabel(routeChainId)} before purchasing a service with its Circle wallet.`);
      return;
    }
    if (!canUseCircleAgentSettlement && chain?.id !== routeChainId && !networkConfirmed) {
      setPendingPurchase({service, serviceKey});
      return;
    }
    setBusyId(serviceKey);
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
        const target = supportedChains.find((item) => item.id === routeChainId);
        toast.loading(`Agent wallet settling ${service.name} on ${target?.name ?? "the service network"}…`, {id: toastId});
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
        void snapshot.refetch().catch(() => undefined);
        toast.success(`Agent settlement is pending on Circle. Execute ${service.name} after the network transaction confirms.`, {id: toastId});
        return;
      }
      toast.loading(`Executing ${service.name}…`, {id: toastId});
      const execution = await apiPost<{result: unknown}>(`/api/marketplace/services/${service.id}/execute`, {
        payer: address,
        authorizationId: result.authorizationId,
        args: executionArgs(service, serviceInputs[serviceKey] ?? "")
      });
      setServiceResults((current) => ({...current, [serviceKey]: execution.result}));
      setResultDialog({service, result: execution.result});
      if (settlement.txHash) {
        toast.success(txToast(`Purchased ${service.name}`, settlement.txHash, routeChainId), {id: toastId});
      } else {
        toast.success(`Settlement recorded for ${service.name}.`, {id: toastId});
      }
      void snapshot.refetch().catch(() => undefined);
    } catch (error) {
      toast.error(marketplaceErrorMessage(error), {id: toastId});
    } finally {
      setBusyId(null);
    }
  }

  async function purchaseGatewayService(service: Service, serviceKey: string) {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before purchasing an x402 service.");
      return;
    }
    if (!selectedAgent) {
      toast.error("Create an agent wallet before purchasing an API.");
      return;
    }
    const chainWallet = selectedAgent.chainWallets?.find((wallet) => wallet.chainId === settlementChainId)
      ?? (settlementChainId === arcTestnet.id
        ? {address: selectedAgent.address, circleWalletId: selectedAgent.circleWalletId}
        : null);
    if (!chainWallet?.address || !chainWallet.circleWalletId) {
      toast.error(`This agent does not have a ready Circle wallet on ${marketplaceChainLabel(settlementChainId)}.`);
      return;
    }
    setBusyId(serviceKey);
    const toastId = toast.loading(`Agent paying ${service.name} through Circle Gateway…`);
    try {
      const execution = await apiPost<{result: unknown; receipt: {txHash?: string | null}}>(`/api/circle/nanopayments/buy/${encodeURIComponent(service.endpointHash)}`, {
        operatorAddress: address,
        agentId: selectedAgent.id,
        walletAddress: chainWallet.address,
        chain: circlePaymentChain(settlementChainId),
        data: executionArgs(service, serviceInputs[serviceKey] ?? ""),
        confirmed: true
      });
      setServiceResults((current) => ({...current, [serviceKey]: execution.result}));
      setResultDialog({service, result: execution.result});
      if (execution.receipt.txHash) {
        toast.success(txToast(`Purchased ${service.name}`, execution.receipt.txHash, settlementChainId), {id: toastId});
      } else {
        toast.success(`Circle Gateway settled ${service.name}.`, {id: toastId});
      }
      void snapshot.refetch().catch(() => undefined);
    } catch (error) {
      toast.error(marketplaceErrorMessage(error), {id: toastId});
    } finally {
      setBusyId(null);
    }
  }

  function selectAgent(agentId: string) {
    setSelectedAgentId(agentId);
    const agent = agents.find((item) => item.id === agentId);
    if (agent) setSettlementChainId(preferredAgentChainId(agent));
  }

  function selectSettlementChain(chainId: number) {
    if (!selectedAgent || !agentWalletChainIds(selectedAgent).includes(chainId)) return;
    savePreferredAgentChainId(selectedAgent, chainId);
    setSettlementChainId(chainId);
  }

  async function confirmNetworkSwitch() {
    const pending = pendingPurchase;
    if (!pending?.service.settlementChainId) return;
    const target = marketplaceSettlementChains.find((item) => item.id === pending.service.settlementChainId);
    if (!target) {
      toast.error("This Marketplace settlement network is not enabled.");
      return;
    }
    setSwitchingNetwork(true);
    try {
      await switchToChain(target);
      setPendingPurchase(null);
      await purchase(pending.service, pending.serviceKey, true);
    } catch {
      toast.error(`The wallet did not switch to ${target.name}. No payment was submitted.`);
    } finally {
      setSwitchingNetwork(false);
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
        <StatMetric variant="panel" icon={Store} label="Services" value={serviceGroups.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={CheckCircle2} label="3-chain ready" value={multichainServices} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ShieldCheck} label="Settled volume" value={settledVolume} prefix="$" decimals={2} loading={snapshot.isLoading} accent />
      </div>

      {isCanonicalPublisher ? (
        <section className="panel space-y-4 border-mint/20">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-kicker">Canonical publisher routes</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Keep Nexora’s six services synchronized across configured networks</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                {ownedMissingRouteCount > 0
                  ? `${ownedMissingRouteCount} verified route${ownedMissingRouteCount === 1 ? " is" : "s are"} still missing. Each network is published in one wallet transaction, then Nexora verifies the route.`
                  : "Every configured network has a verified route for the canonical catalog."}
              </p>
            </div>
            {ownedMissingRouteCount > 0 ? (
              <button type="button" className="action-button" onClick={() => void publishOwnedMissingRoutes()} disabled={publishingMissingRoutes}>
                {publishingMissingRoutes ? <Loader2 size={16} className="animate-spin" /> : <Route size={16} />}
                {publishingMissingRoutes ? "Publishing routes…" : "Publish missing routes"}
              </button>
            ) : null}
          </div>

          <div className="surface grid gap-3 p-4 lg:grid-cols-[190px_minmax(0,1fr)_auto] lg:items-end">
            <label className="grid gap-2 text-xs font-semibold text-slate-300">
              Settlement network
              <select value={routeImportChainId} onChange={(event) => setRouteImportChainId(Number(event.target.value))} className="field bg-slate-950 text-sm text-white">
                {configuredCanonicalChains.map((target) => <option key={target.chainId} value={target.chainId}>{target.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-xs font-semibold text-slate-300">
              Publication transaction hash
              <input value={routeImportHash} onChange={(event) => setRouteImportHash(event.target.value)} className="field font-mono text-xs" placeholder="0x…" />
            </label>
            <button type="button" className="secondary-button" onClick={() => void importPublicationReceipt()} disabled={importingRoute || configuredCanonicalChains.length === 0}>
              {importingRoute ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Verify and import
            </button>
          </div>
          <p className="text-xs leading-5 text-slate-500">Use the import control after publishing to add the transaction to Nexora’s hosted records. You can submit the same verified hash again.</p>
        </section>
      ) : null}

      <section className="panel grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div>
          <p className="section-kicker">Agent service directory</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Purchase-ready tools with USDC settlement on Arc, Base, and Arbitrum</h2>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <TrustFact icon={ReceiptText} label="Receipts" value="Ledger verified" />
            <TrustFact icon={ShieldCheck} label="Policy" value="Agent guarded" />
            <TrustFact icon={Sparkles} label="Featured" value={`${featuredServices} curated`} />
          </div>
        </div>
        <div className="surface p-4">
          <p className="text-sm font-semibold text-white">Marketplace quality gates</p>
          <div className="mt-3 grid gap-2">
            {["Standard x402 seller endpoint", "Structured input and output schema", "Receipt link after settlement", "Publisher address visible"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-slate-300">
                <CheckCircle2 size={15} className="text-mint" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {snapshot.error ? <p className="rounded-xl border border-magenta/35 bg-gradient-to-br from-magenta/15 to-magenta/10 p-4 text-sm font-semibold text-magenta shadow-[0_0_20px_rgba(236,72,153,0.15)]">{snapshot.error instanceof Error ? snapshot.error.message : "Marketplace data is unavailable."}</p> : null}

      <div className="panel grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div className="flex items-center gap-2.5 text-sm font-bold text-white">
            <ShieldCheck size={18} className="text-mint drop-shadow-[0_0_12px_rgba(110,231,183,0.5)]" />
            Agent and settlement network
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">The saved agent-wallet network selects each service route. Changing it here does not switch the connected wallet.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:items-center">
          <AgentPicker agents={agents} value={selectedAgent ?? undefined} onChange={selectAgent} />
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.1] bg-white/[0.03] p-1">
            {marketplaceSettlementChains.map((target) => {
              const available = selectedAgentWalletChains.includes(target.id);
              const active = settlementChainId === target.id;
              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => selectSettlementChain(target.id)}
                  disabled={!available}
                  title={available ? `Use ${target.name} for Marketplace settlement` : `Create or backfill the ${target.name} agent wallet first`}
                  className={`min-h-9 rounded-md px-2 text-xs font-semibold transition ${
                    active
                      ? "bg-mint/15 text-mint"
                      : available
                        ? "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                        : "cursor-not-allowed text-slate-600"
                  }`}
                >
                  {shortMarketplaceChainLabel(target.id)}
                </button>
              );
            })}
          </div>
        </div>
        {selectedAgent && selectedAgentWalletChains.length < marketplaceSettlementChains.length ? (
          <p className="text-xs text-amber lg:col-span-2">This agent is missing one or more chain wallets. Use the Agents page backfill action before selecting those Marketplace routes.</p>
        ) : null}
        {selectedAgentChainWallet?.address && !selectedAgentPolicyReady ? (
          <p className="text-xs leading-5 text-amber lg:col-span-2">
            This agent has no onchain policy receipt recorded on {marketplaceChainLabel(settlementChainId)}. Ledger settlement requires that receipt; Circle Gateway purchases still use the agent's saved Nexora policy.{" "}
            <a href="/settings/policies" onClick={(event) => navigate(event, "/settings/policies")} className="font-semibold underline underline-offset-2">Open Agent Policies</a>
            {" "}to enable the ledger route too.
          </p>
        ) : null}
        {selectedAgentChainWallet?.address && selectedAgentNeedsNativeGas ? (
          <p className="text-xs leading-5 text-cyan lg:col-span-2">
            Ledger settlement from this EOA needs native testnet ETH on {marketplaceChainLabel(settlementChainId)}. Circle Gateway Nanopayments do not require the agent to hold native gas.
          </p>
        ) : null}
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
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {CATEGORIES.map((category) => {
          const Icon = category.icon;
          const active = categoryFilter === category.key;
          return (
            <button
              key={category.key}
              type="button"
              onClick={() => setCategoryFilter(category.key)}
              className={`min-h-[86px] rounded-xl border px-3 py-3 text-left transition ${active ? "border-mint/40 bg-mint/10 text-white shadow-[0_0_24px_rgba(110,231,183,0.08)]" : "border-white/[0.1] bg-white/[0.04] text-slate-300 hover:border-mint/30 hover:text-white"}`}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
                  <Icon size={15} className={active ? "text-mint" : "text-slate-400"} />
                  {category.label}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? "bg-mint/15 text-mint" : "bg-white/[0.06] text-slate-400"}`}>{categoryCounts[category.key] ?? 0}</span>
              </span>
              <span className="mt-2 block text-xs leading-5 text-slate-500">{MARKETPLACE_CATEGORY_DESCRIPTIONS[category.key]}</span>
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
      ) : serviceGroups.length === 0 ? (
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
          {visibleServices.map((group) => {
            const route = routeForChain(group, settlementChainId, canonicalCatalog?.publisherAddress);
            const displayService = route ?? group.service;
            const gatewayAvailable = Boolean(
              gatewayCatalog?.ready
              && gatewayCatalog.networkDetails.some((network) => network.chainId === settlementChainId)
              && gatewayCatalog.services.some((service) => service.endpointHash === displayService.endpointHash)
            );
            const preferGateway = gatewayAvailable && settlementChainId !== arcTestnet.id;
            const settlementRoute = preferGateway ? null : route;
            return (
              <ServiceCard
                key={group.key}
                service={displayService}
                route={settlementRoute}
                gatewayAvailable={gatewayAvailable}
                availableChainIds={[
                  ...group.routes.map((item) => item.settlementChainId).filter((value): value is number => typeof value === "number"),
                  ...(gatewayCatalog?.ready && gatewayCatalog.services.some((service) => service.endpointHash === displayService.endpointHash)
                    ? gatewayCatalog.networkDetails.map((network) => network.chainId)
                    : [])
                ]}
                selectedChainId={settlementChainId}
                busy={busyId === group.key}
                disabled={!isConnected || !selectedAgent || (!settlementRoute && !gatewayAvailable) || Boolean(busyId)}
                input={serviceInputs[group.key] ?? ""}
                onInput={(value) => setServiceInputs((current) => ({...current, [group.key]: value}))}
                onSample={() => setServiceInputs((current) => ({...current, [group.key]: sampleInputForService(displayService)}))}
                onPurchase={() => preferGateway
                  ? void purchaseGatewayService(displayService, group.key)
                  : settlementRoute
                    ? void purchase(settlementRoute, group.key)
                    : gatewayAvailable
                    ? void purchaseGatewayService(displayService, group.key)
                    : undefined}
                result={serviceResults[group.key]}
                onViewResult={() => {
                  const result = serviceResults[group.key];
                  if (result) setResultDialog({service: displayService, result});
                }}
              />
            );
          })}
        </div>
      )}

      <ServiceResultDialog dialog={resultDialog} onClose={() => setResultDialog(null)} />
      <NetworkSwitchDialog
        pending={pendingPurchase}
        connectedChainName={chain?.name ?? "the connected network"}
        switching={switchingNetwork}
        onCancel={() => {
          if (!switchingNetwork) setPendingPurchase(null);
        }}
        onConfirm={() => void confirmNetworkSwitch()}
      />
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
  route,
  gatewayAvailable,
  availableChainIds,
  selectedChainId,
  busy,
  disabled,
  input,
  onInput,
  onSample,
  onPurchase,
  result,
  onViewResult
}: {
  service: Service;
  route: Service | null;
  gatewayAvailable: boolean;
  availableChainIds: number[];
  selectedChainId: number;
  busy: boolean;
  disabled: boolean;
  input: string;
  onInput: (value: string) => void;
  onSample: () => void;
  onPurchase: () => void;
  result: unknown;
  onViewResult: () => void;
}) {
  const Icon = kindIcon(service.manifest.kind);
  const inputLabel = serviceInputLabel(service);
  const category = serviceCategory(service);
  const readiness = serviceReadiness(service);
  const trust = service.trust;
  const multilineInput = service.manifest.kind === "agent_transaction_preflight";
  const sampleEnabled = service.manifest.kind !== "agent_transaction_preflight";
  const selectedChainName = marketplaceChainLabel(selectedChainId);
  const explorer = marketplaceSettlementChains.find((item) => item.id === (route?.settlementChainId ?? service.settlementChainId))
    ?.blockExplorers.default.url
    ?? arcTestnet.explorerUrl;
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
              {route?.chainServiceId || gatewayAvailable ? (
                <span className="flex items-center gap-1 rounded-full border border-mint/25 bg-mint/10 px-2 py-0.5 text-[11px] font-bold text-mint">
                  <CheckCircle2 size={11} />
                  {route?.chainServiceId ? `${shortMarketplaceChainLabel(selectedChainId)} ledger` : "Gateway x402"}
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full border border-amber/25 bg-amber/10 px-2 py-0.5 text-[11px] font-bold text-amber">
                  <X size={11} />
                  Route unavailable
                </span>
              )}
              {trust ? <TrustBadge score={trust.score} tier={trust.tier} /> : null}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <AgentAvatar seed={service.publisherAddress} size={16} />
              {shortAddress(service.publisherAddress)}
              <a href={`${explorer.replace(/\/$/, "")}/address/${service.publisherAddress}`} target="_blank" rel="noreferrer" className="text-slate-500 transition hover:text-orchid" aria-label="View publisher on explorer">
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

      <div className="relative mt-4 grid grid-cols-3 gap-1 rounded-lg border border-white/[0.1] bg-white/[0.03] p-1">
        {marketplaceSettlementChains.map((target) => {
          const available = availableChainIds.includes(target.id);
          const active = target.id === selectedChainId;
          return (
            <div
              key={target.id}
              title={available ? `${target.name} USDC route is available` : `${target.name} route has not been published`}
              className={`flex min-h-9 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold ${
                active
                  ? available ? "bg-mint/15 text-mint" : "bg-amber/10 text-amber"
                  : available ? "text-slate-300" : "text-slate-600"
              }`}
            >
              {available ? <CheckCircle2 size={12} /> : <X size={12} />}
              {shortMarketplaceChainLabel(target.id)}
            </div>
          );
        })}
      </div>

      <div className="relative mt-4 grid gap-2.5 text-sm sm:grid-cols-2">
        <StatusMetric icon={Layers} label="Settlement" value={route?.chainServiceId ? `${selectedChainName} · Ledger #${route.chainServiceId}` : gatewayAvailable ? `${selectedChainName} · Circle Gateway` : `No ${selectedChainName} route`} tone={route || gatewayAvailable ? "mint" : "amber"} />
        <StatusMetric icon={Activity} label="Status" value={route ? readiness.label : gatewayAvailable ? "x402 ready" : "Route required"} tone={route ? readiness.tone : gatewayAvailable ? "mint" : "amber"} />
        <StatusMetric icon={ReceiptText} label="Receipt" value={route ? (selectedChainId === arcTestnet.id ? "Memo + ledger" : "Ledger verified") : gatewayAvailable ? "Gateway + Nexora" : "After route publish"} tone={route || gatewayAvailable ? "mint" : "slate"} />
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
            {sampleEnabled ? (
              <button type="button" onClick={onSample} className="text-xs font-bold text-mint transition hover:text-white">
                Use sample
              </button>
            ) : null}
          </span>
          {multilineInput ? (
            <textarea
              className="field min-h-[120px] resize-y font-mono text-xs leading-5"
              value={input}
              onChange={(event) => onInput(event.target.value)}
              placeholder={serviceInputPlaceholder(service)}
            />
          ) : (
            <input
              className="field"
              value={input}
              onChange={(event) => onInput(event.target.value)}
              placeholder={serviceInputPlaceholder(service)}
            />
          )}
        </label>
      ) : null}

      <div className="relative mt-4 flex items-center gap-3">
        <button onClick={onPurchase} className="action-button flex-1" disabled={disabled}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? "Processing…" : route || gatewayAvailable ? `Purchase on ${shortMarketplaceChainLabel(selectedChainId)}` : `${shortMarketplaceChainLabel(selectedChainId)} route unavailable`}
        </button>
        {route ? (
          <button type="button" onClick={() => navigateTo(`/marketplace/services/${encodeURIComponent(route.id)}`)} className="secondary-button px-3" aria-label="Public service page">
            <ArrowUpRight size={16} />
          </button>
        ) : null}
      </div>

      {busy ? (
        <div className="shimmer mt-4 h-20 w-full rounded-xl" />
      ) : result ? (
        <div className="surface mt-4 flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-orchid">Latest result</p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{resultTitle(result)}</p>
          </div>
          <button type="button" onClick={onViewResult} className="secondary-button px-3 py-2 text-xs">
            View result
          </button>
        </div>
      ) : null}
    </article>
  );
}

function NetworkSwitchDialog({
  pending,
  connectedChainName,
  switching,
  onCancel,
  onConfirm
}: {
  pending: {service: Service; serviceKey: string} | null;
  connectedChainName: string;
  switching: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending?.service.settlementChainId) return null;
  const targetName = marketplaceChainLabel(pending.service.settlementChainId);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <button type="button" className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} aria-label="Cancel network switch" />
      <section role="dialog" aria-modal="true" aria-labelledby="marketplace-network-switch-title" className="relative z-10 w-full max-w-md rounded-lg border border-white/[0.12] bg-slate-950 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-mint/25 bg-mint/10 text-mint">
            <Route size={18} />
          </span>
          <div>
            <h2 id="marketplace-network-switch-title" className="text-lg font-semibold text-white">Switch settlement network?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {pending.service.name} will settle in USDC on {targetName}. Your wallet is currently connected to {connectedChainName}.
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs leading-5 text-slate-400">
          Confirming only requests the wallet network switch. The payment authorization starts after the wallet reports {targetName}.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className="secondary-button justify-center" onClick={onCancel} disabled={switching}>Cancel</button>
          <button type="button" className="action-button justify-center" onClick={onConfirm} disabled={switching}>
            {switching ? <Loader2 size={16} className="animate-spin" /> : null}
            {switching ? "Switching…" : `Switch to ${shortMarketplaceChainLabel(pending.service.settlementChainId)}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function ServiceResultDialog({dialog, onClose}: {dialog: {service: Service; result: unknown} | null; onClose: () => void}) {
  useEffect(() => {
    if (!dialog) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [dialog, onClose]);

  if (!dialog) return null;

  const {service, result} = dialog;
  const resultObject = objectValue(result);
  const rawJson = JSON.stringify(result, null, 2);

  async function copyResult() {
    await navigator.clipboard.writeText(rawJson);
    toast.success("Result JSON copied.");
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto px-3 py-5 sm:px-5">
      <button type="button" className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Close service result" />
      <section className="relative z-10 w-full max-w-5xl overflow-hidden rounded-2xl border border-white/[0.12] bg-slate-950 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-kicker">Service result</p>
              <h2 className="mt-2 truncate text-xl font-bold text-white sm:text-2xl">{service.name}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="status-pill">{formatCategory(serviceCategory(service))}</span>
                <span className="status-pill">{formatKind(service.manifest.kind)}</span>
                <span className="status-pill">${service.pricePerUnitUsdc} / request</span>
                {stringValue(resultObject.status) ? <span className="status-pill">Status {stringValue(resultObject.status)}</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void copyResult()} className="secondary-button px-3 py-2 text-xs">
                Copy JSON
              </button>
              <button type="button" onClick={onClose} className="secondary-button px-3 py-2" aria-label="Close service result">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_280px]">
          <div className="min-w-0">
            <ServiceResult result={result} />
            <details className="surface mt-4 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-white">Raw response JSON</summary>
              <pre className="mt-4 max-h-[360px] overflow-auto rounded-xl border border-white/[0.08] bg-black/30 p-3 text-xs leading-5 text-slate-300">{rawJson}</pre>
            </details>
          </div>

          <aside className="surface h-fit p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Output schema</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {service.manifest.outputSchema.map((item) => <span key={item} className="status-pill">{item}</span>)}
            </div>
            <div className="mt-4 grid gap-2 text-sm">
              <ResultMetric label="Publisher" value={shortAddress(service.publisherAddress)} />
              <ResultMetric label="Version" value={service.manifest.version} />
              <ResultMetric label="Ledger" value={service.chainServiceId ? `#${service.chainServiceId}` : "Not published"} />
            </div>
          </aside>
        </div>
      </section>
    </div>
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

  if ("decision" in data || "live" in data) return <StructuredServiceResult data={data} />;

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
  if ("agenda" in data || "questions" in data || "followUps" in data || "integrationIdeas" in data || "steps" in data || "requirements" in data || "securityNotes" in data || "checks" in data || "recommendations" in data || "recommendedPolicy" in data || "gaps" in data || "risks" in data || "suggestions" in data || "approvalRules" in data || "reminders" in data || "thresholds" in data || "providerStatus" in data || "pricingSignals" in data || "rebalanceTriggers" in data || "exposure" in data || "monitoring" in data || "localActivity" in data || "candidates" in data) return <StructuredServiceResult data={data} />;

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
  const approvals = arrayValue(data.approvals);
  const reminders = arrayValue(data.reminders);
  const recommendedActions = arrayValue(data.recommendedActions);
  const approvalRules = arrayValue(data.approvalRules);
  const alerts = arrayValue(data.alerts);
  const pricingSignals = arrayValue(data.pricingSignals);
  const rebalanceTriggers = arrayValue(data.rebalanceTriggers);
  const candidates = arrayValue(data.candidates);
  const chains = arrayValue(data.chains);
  const providerStatus = objectValue(data.providerStatus);
  const recommendedPolicy = objectValue(data.recommendedPolicy);
  const metrics = objectValue(data.metrics);
  const thresholds = objectValue(data.thresholds);
  const request = objectValue(data.request);
  const exposure = objectValue(data.exposure);
  const monitoring = objectValue(data.monitoring);
  const localActivity = objectValue(data.localActivity);
  return (
    <div className="surface mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-orchid">Service result</p>
          <h4 className="mt-2 text-base font-semibold text-white">{stringValue(data.decision) ? `Decision: ${stringValue(data.decision)}` : stringValue(data.riskLevel) ? `Risk: ${stringValue(data.riskLevel)}` : stringValue(data.summary) ?? "Analysis complete"}</h4>
        </div>
        {numberValue(data.score) !== null ? <span className="status-pill">Score {numberValue(data.score)}</span> : null}
      </div>
      {stringValue(data.summary) ? <p className="mt-3 text-sm leading-6 text-slate-300">{stringValue(data.summary)}</p> : null}
      {"decision" in data || "provider" in data || "gasUsed" in data ? (
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          <ResultMetric label="Status" value={stringValue(data.status)} />
          <ResultMetric label="Decision" value={stringValue(data.decision)} />
          <ResultMetric label="Provider" value={stringValue(data.provider) ?? (data.provider === null ? "None" : null)} />
          <ResultMetric label="Gas" value={numberValue(data.gasUsed)} />
        </div>
      ) : null}
      {Object.keys(providerStatus).length > 0 ? <ResultObject title="Provider status" value={providerStatus} /> : null}
      {Object.keys(request).length > 0 ? <ResultObject title="Transaction request" value={request} /> : null}
      {Object.keys(metrics).length > 0 ? <ResultObject title="Metrics" value={metrics} /> : null}
      {Object.keys(exposure).length > 0 ? <ResultObject title="Exposure" value={exposure} /> : null}
      {Object.keys(monitoring).length > 0 ? <ResultObject title="Monitoring" value={monitoring} /> : null}
      {Object.keys(localActivity).length > 0 ? <ResultObject title="Local activity" value={localActivity} /> : null}
      {Object.keys(thresholds).length > 0 ? <ResultObject title="Thresholds" value={thresholds} /> : null}
      {Object.keys(recommendedPolicy).length > 0 ? <ResultObject title="Recommended policy" value={recommendedPolicy} /> : null}
      <ResultList title="Candidates" items={candidates} />
      <ResultList title="Chains" items={chains} />
      <ResultList title="Checks" items={checks} />
      <ResultList title="Issues" items={issues} />
      <ResultList title="Risks" items={risks} />
      <ResultList title="Approvals" items={approvals} />
      <ResultList title="Strengths" items={strengths} />
      <ResultList title="Gaps" items={gaps} />
      <ResultList title="Agenda" items={agenda} />
      <ResultList title="Questions" items={questions} />
      <ResultList title="Follow-ups" items={followUps} />
      <ResultList title="Integration ideas" items={integrationIdeas} />
      <ResultList title="Steps" items={steps} />
      <ResultList title="Requirements" items={requirements} />
      <ResultList title="Security notes" items={securityNotes} />
      <ResultList title="Reminders" items={reminders} />
      <ResultList title="Recommended actions" items={recommendedActions} />
      <ResultList title="Approval rules" items={approvalRules} />
      <ResultList title="Alerts" items={alerts} />
      <ResultList title="Pricing signals" items={pricingSignals} />
      <ResultList title="Rebalance triggers" items={rebalanceTriggers} />
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
          <div key={`${title}-${index}`} className="surface px-3 py-2 text-sm text-slate-300">{renderResultValue(item)}</div>
        ))}
      </div>
    </div>
  );
}

function ResultObject({title, value}: {title: string; value: Record<string, unknown>}) {
  return (
    <div className="mt-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Object.entries(value).slice(0, 8).map(([key, item]) => (
          <div key={key} className="surface px-3 py-2 text-sm">
            <span className="block text-xs uppercase tracking-[0.12em] text-slate-500">{key}</span>
            <span className="mt-1 block text-slate-300">{renderResultValue(item)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderResultValue(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function resultTitle(result: unknown) {
  const data = objectValue(result);
  return stringValue(data.summary)
    ?? stringValue(data.repo)
    ?? stringValue(data.title)
    ?? stringValue(data.message)
    ?? stringValue(data.status)
    ?? "Analysis ready";
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

function groupMarketplaceServices(services: Service[], preferredPublisher?: string | null): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  for (const service of services) {
    const endpoint = service.endpointHash.trim().toLowerCase() || service.id;
    // A publisher owns a logical service. The same endpoint hash from another
    // publisher is a different listing and must never be merged into, hidden
    // by, or routed through the canonical Nexora listing.
    const key = `${service.publisherAddress.trim().toLowerCase()}:${endpoint}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {key, service, routes: [service]});
      continue;
    }
    existing.routes.push(service);
    const servicePreferred = preferredPublisher && service.publisherAddress.toLowerCase() === preferredPublisher.toLowerCase();
    const existingPreferred = preferredPublisher && existing.service.publisherAddress.toLowerCase() === preferredPublisher.toLowerCase();
    if ((servicePreferred && !existingPreferred) || (service.featured && !existing.service.featured)) existing.service = service;
  }
  return [...groups.values()];
}

function gatewayDirectoryServices(catalog: GatewayCatalog | null): Service[] {
  if (!catalog?.sellerAddress) return [];
  return catalog.services.map((service, index) => ({
    id: `gateway:${service.endpointHash}`,
    chainServiceId: null,
    settlementChainId: null,
    publisherAddress: catalog.sellerAddress as string,
    name: service.name,
    endpointHash: service.endpointHash,
    pricePerUnitUsdc: service.pricePerUnitUsdc,
    manifest: service.manifest,
    active: true,
    featured: index < 4,
    txHash: null,
    trust: null,
    createdAt: "1970-01-01T00:00:00.000Z"
  }));
}

function marketplaceDirectoryServices(services: Service[], catalog: GatewayCatalog | null) {
  if (!catalog?.sellerAddress) return services;
  const canonicalPublisher = catalog.sellerAddress.trim().toLowerCase();

  const reservedEndpoints = new Set(
    catalog.services.map((service) => service.endpointHash.trim().toLowerCase())
  );
  const verifiedLedgerRoutes = services.filter((service) => {
    const endpoint = service.endpointHash.trim().toLowerCase();
    if (!reservedEndpoints.has(endpoint)) return true;
    return service.publisherAddress.trim().toLowerCase() === canonicalPublisher;
  });

  return [...verifiedLedgerRoutes, ...gatewayDirectoryServices(catalog)];
}

function routeForChain(group: ServiceGroup, chainId: number, preferredPublisher?: string | null) {
  const routes = group.routes.filter((service) => service.settlementChainId === chainId);
  return routes[0] ?? null;
}

function marketplaceChainLabel(chainId: number) {
  return marketplaceSettlementChains.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`;
}

function shortMarketplaceChainLabel(chainId: number) {
  if (chainId === arcTestnet.id) return "Arc";
  if (chainId === 84532) return "Base";
  if (chainId === 421614) return "Arbitrum";
  return marketplaceChainLabel(chainId);
}

function circlePaymentChain(chainId: number) {
  if (chainId === arcTestnet.id) return "ARC";
  if (chainId === 84532) return "BASE_SEPOLIA";
  if (chainId === 421614) return "ARB_SEPOLIA";
  if (chainId === 8453) return "BASE";
  if (chainId === 42161) return "ARB";
  return `eip155:${chainId}`;
}

function hasRecordedAgentPolicy(agent: Agent, chainId: number) {
  if (agent.policy.deployments?.some((deployment) => deployment.chainId === chainId && Boolean(deployment.txHash))) return true;
  return chainId === arcTestnet.id && Boolean(agent.policy.txHash);
}

function marketplaceErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Service purchase failed.";
  if (/Expected bytes|AbiEncoding|Version:\s*viem|invalid.*(bytes|address)|execution reverted/i.test(message)) {
    return "The Marketplace payment could not be prepared on the selected route. Verify the wallet network and service route, then try again.";
  }
  return message;
}
