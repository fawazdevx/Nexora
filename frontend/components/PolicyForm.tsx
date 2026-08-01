import {useEffect, useMemo, useState} from "react";
import {AlertTriangle, CalendarClock, Clock, Copy, Database, Gauge, Loader2, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Timer, Users, Wallet, X} from "lucide-react";
import toast from "react-hot-toast";
import {useAccount} from "wagmi";
import {chainLabel, contractAddressesForChain, isNexoraPolicyChain, writeAgentPolicy} from "@/lib/contracts";
import {apiPost, type AppSnapshot} from "@/lib/api";
import {isBotChainId, shortAddress} from "@/lib/arc";
import {AgentPicker} from "@/components/AgentPicker";
import {AgentAvatar} from "@/components/AgentAvatar";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {PlanSubscriptionCard} from "@/components/PlanSubscriptionCard";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const POLICY_PRESETS: Array<{key: string; name: string; hint: string; icon: typeof ShieldCheck; daily: string; tx: string; weekly: string; monthly: string; cooldown: string; requireOnchain: boolean}> = [
  {key: "conservative", name: "Conservative", hint: "$100/day · $10/tx · 1h cooldown", icon: ShieldCheck, daily: "100", tx: "10", weekly: "0", monthly: "0", cooldown: "3600", requireOnchain: true},
  {key: "standard", name: "Standard", hint: "$400/day · $45/tx", icon: Gauge, daily: "400", tx: "45", weekly: "0", monthly: "0", cooldown: "0", requireOnchain: false},
  {key: "high", name: "High volume", hint: "$2k/day · $5k/wk caps", icon: Sparkles, daily: "2000", tx: "200", weekly: "5000", monthly: "15000", cooldown: "0", requireOnchain: false}
];

export function PolicyForm({selectedAgentId, onSelectAgent}: {selectedAgentId?: string; onSelectAgent?: (id: string) => void} = {}) {
  const {address, chain, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const selectedChainId = chain?.id;
  const isBotPolicy = isBotChainId(selectedChainId);
  const chainContracts = useMemo(() => contractAddressesForChain(chain?.id), [chain?.id]);
  const policyChainReady = isNexoraPolicyChain(chain?.id);
  const contractOptions = useMemo(() => [
    {label: "x402 payments", address: chainContracts.x402Ledger, description: "Marketplace API payments and settlement"},
    {label: "Reputation", address: chainContracts.reputation, description: "Operator reputation updates"},
    {label: "Policy registry", address: chainContracts.policyRegistry, description: "Agent spending rule management"}
  ].filter((item): item is {label: string; address: string; description: string} => Boolean(item.address?.startsWith("0x"))), [chainContracts]);
  const knownContracts = useMemo(() => new Set(contractOptions.map((item) => item.address.toLowerCase())), [contractOptions]);
  const agents = useMemo(() => snapshot.data?.agents ?? [], [snapshot.data?.agents]);
  const circleAgents = useMemo(() => agents.filter((agent) => agent.walletKind !== "external_eoa"), [agents]);
  const storedBotAgent = useMemo(() => (
    address
      ? agents.find((agent) => (
        agent.walletKind === "external_eoa"
        && agent.operatorAddress.toLowerCase() === address.toLowerCase()
        && agent.chainWallets?.some((wallet) => wallet.chainId === selectedChainId)
      ))
      : undefined
  ), [address, agents, selectedChainId]);
  const draftBotAgent = useMemo(
    () => address && selectedChainId ? externalBotAgentDraft(address, selectedChainId, chain?.name ?? "BOT Chain") : undefined,
    [address, chain?.name, selectedChainId]
  );

  const [internalId, setInternalId] = useState("");
  const agentId = selectedAgentId ?? internalId;
  const setAgentId = onSelectAgent ?? setInternalId;

  const [tab, setTab] = useState<"basic" | "advanced">("basic");
  const [dailyLimit, setDailyLimit] = useState("400");
  const [transactionCap, setTransactionCap] = useState("45");
  const [weeklyLimit, setWeeklyLimit] = useState("0");
  const [monthlyLimit, setMonthlyLimit] = useState("0");
  const [maxUnitsPerRequest, setMaxUnitsPerRequest] = useState("0");
  const [cooldownSeconds, setCooldownSeconds] = useState("0");
  const [expiresAt, setExpiresAt] = useState("");
  const [requireOnchainPolicy, setRequireOnchainPolicy] = useState(false);
  const [contractAllowlist, setContractAllowlist] = useState("");
  const [recipientAllowlist, setRecipientAllowlist] = useState("");
  const [serviceAllowlist, setServiceAllowlist] = useState("");
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const selectedAgent = isBotPolicy
    ? storedBotAgent ?? draftBotAgent
    : circleAgents.find((agent) => agent.id === agentId);
  const arcChainId = Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002);
  const selectedChainWallet = selectedAgent?.chainWallets?.find((wallet) => wallet.chainId === selectedChainId)
    ?? (selectedChainId === arcChainId && selectedAgent
      ? {
        address: selectedAgent.address,
        circleWalletId: selectedAgent.circleWalletId ?? null,
        chainId: selectedChainId,
        chain: chainLabel(selectedChainId),
        circleBlockchain: "ARC-TESTNET",
        status: selectedAgent.circleWalletStatus,
        updatedAt: selectedAgent.createdAt
      }
      : null);
  const selectedDeployment = selectedAgent?.policy.deployments?.find((deployment) => deployment.chainId === selectedChainId)
    ?? (selectedChainId === arcChainId && selectedAgent?.policy.txHash
      ? {chainId: selectedChainId, txHash: selectedAgent.policy.txHash, updatedAt: selectedAgent.createdAt}
      : null);
  const contractItems = splitAddresses(contractAllowlist);
  const recipientItems = splitAddresses(recipientAllowlist);
  const serviceItems = splitIdentifiers(serviceAllowlist);
  const customContracts = contractItems.filter((item) => !knownContracts.has(item.toLowerCase()));
  const selectedContracts = new Set(contractItems.map((item) => item.toLowerCase()));
  const capExceedsDaily = Number(transactionCap) > Number(dailyLimit) && Number(dailyLimit) > 0;
  const capRatio = Number(dailyLimit) > 0 ? Math.min(100, (Number(transactionCap) / Number(dailyLimit)) * 100) : 0;
  const weeklyBelowDaily = Number(weeklyLimit) > 0 && Number(weeklyLimit) < Number(dailyLimit);
  const monthlyBelowWeekly = Number(monthlyLimit) > 0 && Number(weeklyLimit) > 0 && Number(monthlyLimit) < Number(weeklyLimit);
  const hasPremiumAutomation = Boolean(snapshot.data?.access?.premiumAgentAutomation);

  const advancedActive = [
    Number(weeklyLimit) > 0,
    Number(monthlyLimit) > 0,
    Number(maxUnitsPerRequest) > 0,
    Number(cooldownSeconds) > 0,
    Boolean(expiresAt),
    serviceItems.length > 0,
    requireOnchainPolicy
  ].filter(Boolean).length;

  const dirty = selectedAgent
    ? dailyLimit !== String(selectedAgent.policy.dailyLimitUsdc) ||
      transactionCap !== String(selectedAgent.policy.transactionCapUsdc) ||
      weeklyLimit !== String(selectedAgent.policy.v2?.weeklyLimitUsdc ?? 0) ||
      monthlyLimit !== String(selectedAgent.policy.v2?.monthlyLimitUsdc ?? 0) ||
      maxUnitsPerRequest !== String(selectedAgent.policy.v2?.maxUnitsPerRequest ?? 0) ||
      cooldownSeconds !== String(selectedAgent.policy.v2?.cooldownSeconds ?? 0) ||
      expiresAt !== toDateTimeLocal(selectedAgent.policy.v2?.expiresAt) ||
      requireOnchainPolicy !== Boolean(selectedAgent.policy.v2?.requireOnchainPolicy) ||
      listKey(contractAllowlist) !== listKey(selectedAgent.policy.contractAllowlist.join("\n")) ||
      listKey(recipientAllowlist) !== listKey(selectedAgent.policy.recipientAllowlist.join("\n")) ||
      listKey(serviceAllowlist) !== listKey((selectedAgent.policy.v2?.serviceAllowlist ?? []).join("\n"))
    : false;
  const canSave = Boolean(selectedAgent) && (dirty || !selectedDeployment);

  useEffect(() => {
    if (isBotPolicy) {
      if (storedBotAgent && agentId !== storedBotAgent.id) setAgentId(storedBotAgent.id);
      return;
    }
    if ((!agentId || !circleAgents.some((agent) => agent.id === agentId)) && circleAgents[0]) {
      setAgentId(circleAgents[0].id);
    }
  }, [circleAgents, agentId, isBotPolicy, setAgentId, storedBotAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    setDailyLimit(String(selectedAgent.policy.dailyLimitUsdc));
    setTransactionCap(String(selectedAgent.policy.transactionCapUsdc));
    setWeeklyLimit(String(selectedAgent.policy.v2?.weeklyLimitUsdc ?? 0));
    setMonthlyLimit(String(selectedAgent.policy.v2?.monthlyLimitUsdc ?? 0));
    setMaxUnitsPerRequest(String(selectedAgent.policy.v2?.maxUnitsPerRequest ?? 0));
    setCooldownSeconds(String(selectedAgent.policy.v2?.cooldownSeconds ?? 0));
    setExpiresAt(toDateTimeLocal(selectedAgent.policy.v2?.expiresAt));
    setRequireOnchainPolicy(Boolean(selectedAgent.policy.v2?.requireOnchainPolicy));
    setContractAllowlist(selectedAgent.policy.contractAllowlist.join("\n"));
    setRecipientAllowlist(selectedAgent.policy.recipientAllowlist.join("\n"));
    setServiceAllowlist((selectedAgent.policy.v2?.serviceAllowlist ?? []).join("\n"));
  }, [selectedAgent]);

  function addContract(addr: string) {
    setContractAllowlist(withAdded(contractItems, addr).join("\n"));
  }
  function removeContract(addr: string) {
    setContractAllowlist(withRemoved(contractItems, addr).join("\n"));
  }
  function addRecipient(addr: string) {
    setRecipientAllowlist(withAdded(recipientItems, addr).join("\n"));
  }
  function removeRecipient(addr: string) {
    setRecipientAllowlist(withRemoved(recipientItems, addr).join("\n"));
  }
  function addService(value: string) {
    setServiceAllowlist(withAdded(serviceItems, value).join("\n"));
  }
  function removeService(value: string) {
    setServiceAllowlist(withRemoved(serviceItems, value).join("\n"));
  }

  function applyPreset(preset: (typeof POLICY_PRESETS)[number]) {
    setDailyLimit(preset.daily);
    setTransactionCap(preset.tx);
    if (hasPremiumAutomation) {
      setWeeklyLimit(preset.weekly);
      setMonthlyLimit(preset.monthly);
      setCooldownSeconds(preset.cooldown);
      setRequireOnchainPolicy(preset.requireOnchain);
    }
    toast.success(`${preset.name} preset applied — review and save`);
  }

  function resetForm() {
    if (!selectedAgent) return;
    setDailyLimit(String(selectedAgent.policy.dailyLimitUsdc));
    setTransactionCap(String(selectedAgent.policy.transactionCapUsdc));
    setWeeklyLimit(String(selectedAgent.policy.v2?.weeklyLimitUsdc ?? 0));
    setMonthlyLimit(String(selectedAgent.policy.v2?.monthlyLimitUsdc ?? 0));
    setMaxUnitsPerRequest(String(selectedAgent.policy.v2?.maxUnitsPerRequest ?? 0));
    setCooldownSeconds(String(selectedAgent.policy.v2?.cooldownSeconds ?? 0));
    setExpiresAt(toDateTimeLocal(selectedAgent.policy.v2?.expiresAt));
    setRequireOnchainPolicy(Boolean(selectedAgent.policy.v2?.requireOnchainPolicy));
    setContractAllowlist(selectedAgent.policy.contractAllowlist.join("\n"));
    setRecipientAllowlist(selectedAgent.policy.recipientAllowlist.join("\n"));
    setServiceAllowlist((selectedAgent.policy.v2?.serviceAllowlist ?? []).join("\n"));
  }

  const changes = useMemo(() => {
    if (!selectedAgent) return [] as string[];
    const p = selectedAgent.policy;
    const out: string[] = [];
    if (dailyLimit !== String(p.dailyLimitUsdc)) out.push(`Daily $${p.dailyLimitUsdc} → $${dailyLimit || 0}`);
    if (transactionCap !== String(p.transactionCapUsdc)) out.push(`Tx $${p.transactionCapUsdc} → $${transactionCap || 0}`);
    if (weeklyLimit !== String(p.v2?.weeklyLimitUsdc ?? 0)) out.push(`Weekly $${p.v2?.weeklyLimitUsdc ?? 0} → $${weeklyLimit || 0}`);
    if (monthlyLimit !== String(p.v2?.monthlyLimitUsdc ?? 0)) out.push(`Monthly $${p.v2?.monthlyLimitUsdc ?? 0} → $${monthlyLimit || 0}`);
    if (maxUnitsPerRequest !== String(p.v2?.maxUnitsPerRequest ?? 0)) out.push(`Max units ${p.v2?.maxUnitsPerRequest ?? 0} → ${maxUnitsPerRequest || 0}`);
    if (cooldownSeconds !== String(p.v2?.cooldownSeconds ?? 0)) out.push(`Cooldown ${formatDuration(Number(p.v2?.cooldownSeconds ?? 0))} → ${formatDuration(Number(cooldownSeconds || 0))}`);
    if (expiresAt !== toDateTimeLocal(p.v2?.expiresAt)) out.push(`Expiry → ${expiresAt ? expiryLabel(expiresAt) : "none"}`);
    if (requireOnchainPolicy !== Boolean(p.v2?.requireOnchainPolicy)) out.push(requireOnchainPolicy ? "now requires on-chain" : "on-chain no longer required");
    if (listKey(contractAllowlist) !== listKey(p.contractAllowlist.join("\n"))) out.push(`Contracts ${p.contractAllowlist.length} → ${contractItems.length}`);
    if (listKey(recipientAllowlist) !== listKey(p.recipientAllowlist.join("\n"))) out.push(`Recipients ${p.recipientAllowlist.length} → ${recipientItems.length}`);
    if (listKey(serviceAllowlist) !== listKey((p.v2?.serviceAllowlist ?? []).join("\n"))) out.push(`Services ${(p.v2?.serviceAllowlist ?? []).length} → ${serviceItems.length}`);
    return out;
  }, [selectedAgent, dailyLimit, transactionCap, weeklyLimit, monthlyLimit, maxUnitsPerRequest, cooldownSeconds, expiresAt, requireOnchainPolicy, contractAllowlist, recipientAllowlist, serviceAllowlist, contractItems.length, recipientItems.length, serviceItems.length]);

  const onchainFootgun = requireOnchainPolicy && Boolean(selectedAgent) && !selectedChainWallet?.address;

  async function copyToOtherAgents() {
    if (!address || !selectedAgent || isBotPolicy) return;
    const targets = circleAgents.filter((agent) => agent.id !== selectedAgent.id);
    if (targets.length === 0) {
      toast.error("No other agents to copy to.");
      return;
    }
    const v2 = policyV2Payload({weeklyLimit, monthlyLimit, maxUnitsPerRequest, cooldownSeconds, expiresAt, serviceAllowlist: serviceItems, requireOnchainPolicy});
    setCopying(true);
    const toastId = toast.loading(`Copying policy to ${targets.length} agent${targets.length > 1 ? "s" : ""}…`);
    try {
      await Promise.all(
        targets.map((agent) =>
          apiPost(`/api/agents/${agent.id}/policies`, {
            operatorAddress: address,
            dailyLimitUsdc: Number(dailyLimit),
            transactionCapUsdc: Number(transactionCap),
            contractAllowlist: contractItems,
            recipientAllowlist: recipientItems,
            chainId: selectedChainId,
            policyV2: v2,
            txHash: null
          })
        )
      );
      await snapshot.refetch();
      toast.success(`Copied policy to ${targets.length} agent${targets.length > 1 ? "s" : ""} (off-chain).`, {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Copy failed", {id: toastId});
    } finally {
      setCopying(false);
    }
  }

  async function savePolicy() {
    if (saving) return;
    if (!isConnected || !address) {
      toast.error("Connect your wallet before saving an agent policy.");
      return;
    }
    if (!selectedAgent) {
      toast.error(isBotPolicy ? "Connect the BOT EOA that will sign payments." : "Create or select an agent wallet before saving a policy.");
      return;
    }
    if (selectedChainWallet?.address && !policyChainReady) {
      toast.error(isBotPolicy
        ? "BOT policy contracts are not configured in this frontend yet. Add the deployed policy registry address and restart the app."
        : `On-chain policies aren't available on ${chainLabel(chain?.id)}. Switch to Arc, Arbitrum, or Base to save this policy.`);
      return;
    }
    if (!hasPremiumAutomation && hasPremiumPolicySettings({
      weeklyLimit,
      monthlyLimit,
      maxUnitsPerRequest,
      cooldownSeconds,
      expiresAt,
      serviceAllowlist: serviceItems,
      requireOnchainPolicy
    })) {
      toast.error("Premium Agent Automation is required for advanced policy controls.");
      return;
    }
    setSaving(true);
    const toastId = toast.loading(selectedChainWallet?.address ? `Saving policy on ${chainLabel(chain?.id)}…` : "Saving pending policy…");
    try {
      const v2 = policyV2Payload({
        weeklyLimit,
        monthlyLimit,
        maxUnitsPerRequest,
        cooldownSeconds,
        expiresAt,
        serviceAllowlist: serviceItems,
        previousServiceAllowlist: selectedAgent.policy.v2?.serviceAllowlist ?? [],
        requireOnchainPolicy
      });
      const policyAgent = isBotPolicy
        ? await apiPost<AppSnapshot["agents"][number]>("/api/agents/external-eoa", {
            operatorAddress: address,
            chainId: selectedChainId
          })
        : selectedAgent;
      const registration = !isBotPolicy && selectedChainWallet?.address
        ? await apiPost<{
            status: "already_registered" | "registered" | "pending";
            registered: boolean;
            transactionId: string | null;
            txHash: string | null;
          }>(`/api/agents/${encodeURIComponent(policyAgent.id)}/policies/register`, {
            operatorAddress: address,
            chainId: selectedChainId,
            policyRegistry: chainContracts.policyRegistry,
            dailyLimitUsdc: Number(dailyLimit),
            transactionCapUsdc: Number(transactionCap),
            contractAllowlist: contractItems,
            recipientAllowlist: recipientItems,
            policyV2: v2
          })
        : null;
      if (registration?.status === "pending") {
        await snapshot.refetch();
        toast.success("Circle submitted the agent wallet registration. Wait for confirmation, then save the policy again.", {id: toastId});
        return;
      }
      const txHash = selectedChainWallet?.address
        ? await writeAgentPolicy({
            agentWallet: selectedChainWallet.address,
            operatorAddress: isBotPolicy ? address : policyAgent.operatorAddress,
            arcName: policyAgent.arcName,
            dailyLimitUsdc: dailyLimit,
            transactionCapUsdc: transactionCap,
            contractAllowlist: contractItems,
            recipientAllowlist: recipientItems,
            policyV2: v2,
            active: true,
            skipBasicPolicy: registration?.registered === true
          })
        : null;

      await apiPost(`/api/agents/${encodeURIComponent(policyAgent.id)}/policies`, {
        operatorAddress: address,
        dailyLimitUsdc: Number(dailyLimit),
        transactionCapUsdc: Number(transactionCap),
        contractAllowlist: contractItems,
        recipientAllowlist: recipientItems,
        chainId: selectedChainId,
        policyV2: v2,
        txHash
      });

      await snapshot.refetch();
      toast.success(txHash ? `${isBotPolicy ? "BOT EOA" : "Agent"} policy saved on-chain` : "Pending policy saved", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Policy update failed", {id: toastId});
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saving && canSave) void savePolicy();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="mt-6 space-y-5">
      {isConnected && !policyChainReady ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber/25 bg-amber/10 p-3.5 text-[13px] leading-5 text-amber">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {isBotPolicy
              ? "BOT Chain payment support is enabled, but this frontend does not have the BOT policy registry address. Add the deployed address before saving policies."
              : `${chainLabel(chain?.id)} does not have a configured Nexora policy registry. Switch to Arc, Arbitrum, or Base to save an on-chain agent policy.`}
          </span>
        </div>
      ) : null}
      {isConnected && isBotPolicy && policyChainReady ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-cyan/25 bg-cyan/10 p-3.5 text-[13px] leading-5 text-cyan">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" />
          <span>
            BOT mode uses your connected EOA as the policy-controlled wallet. Nexora checks this policy before relaying a signed Permit2 payment to Meridian, then records spend and reputation after settlement.
          </span>
        </div>
      ) : null}
      {/* Agent context */}
      <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          {selectedAgent ? (
            <AgentAvatar seed={selectedAgent.address ?? selectedAgent.id} label={selectedAgent.arcName ?? selectedAgent.address} size={40} />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-slate-500"><ShieldCheck size={18} /></span>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{selectedAgent ? isBotPolicy ? "Connected BOT EOA" : selectedAgent.arcName ?? shortAddress(selectedAgent.operatorAddress) : "No agent selected"}</p>
            <p className="font-mono text-[13px] text-slate-400">{selectedChainWallet?.address ? shortAddress(selectedChainWallet.address) : selectedAgent ? `${chainLabel(selectedChainId)} wallet pending` : address ? shortAddress(address) : "Connect wallet"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedAgent ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${selectedDeployment ? "border-mint/25 bg-mint/10 text-mint" : "border-amber/25 bg-amber/10 text-amber"}`}>
              <span className={`h-2 w-2 rounded-full ${selectedDeployment ? "bg-mint" : "bg-amber"}`} />
              {selectedDeployment ? `On-chain · ${chainLabel(selectedChainId)}` : "Saved off-chain"}
            </span>
          ) : null}
          {selectedAgent && !isBotPolicy && circleAgents.length > 1 ? (
            <button type="button" onClick={() => void copyToOtherAgents()} disabled={copying} className="secondary-button min-h-9 px-3 py-1.5 text-xs">
              {copying ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
              Copy to others
            </button>
          ) : null}
          {dirty ? <span className="rounded-full border border-plasma/30 bg-plasma/10 px-2.5 py-1 text-xs font-semibold text-orchid">Unsaved changes</span> : null}
        </div>
      </div>

      {/* Policy subject */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-300">{isBotPolicy ? "Policy wallet" : "Agent"}</p>
        {isBotPolicy ? (
          <div className="surface flex items-center justify-between gap-3 p-3.5">
            <span>
              <span className="block text-sm font-semibold text-white">Connected EOA</span>
              <span className="mt-1 block font-mono text-xs text-slate-400">{address ?? "Connect a wallet to configure BOT policy controls"}</span>
            </span>
            <span className="rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-xs font-semibold text-cyan">External signer</span>
          </div>
        ) : (
          <AgentPicker agents={circleAgents} value={selectedAgent} onChange={setAgentId} />
        )}
        {!isBotPolicy && circleAgents.length === 0 ? (
          <p className="mt-2 text-[13px] leading-5 text-slate-400">No agent is available yet. Create an agent wallet first; once Circle returns the wallet, it will appear here.</p>
        ) : null}
      </div>

      {/* Quick presets */}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-300">Quick presets</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {POLICY_PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button key={preset.key} type="button" onClick={() => applyPreset(preset)} className="surface p-3 text-left transition hover:border-plasma/30">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-white"><Icon size={15} className="text-orchid" /> {preset.name}</p>
                <p className="mt-1 text-[13px] text-slate-400">{preset.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl border border-white/[0.1] bg-white/[0.03] p-1">
        <TabButton active={tab === "basic"} onClick={() => setTab("basic")}>Basic</TabButton>
        <TabButton active={tab === "advanced"} onClick={() => setTab("advanced")}>
          Advanced
          {advancedActive > 0 ? <span className="ml-1.5 rounded-full bg-plasma/20 px-1.5 py-0.5 text-xs font-bold text-orchid">{advancedActive}</span> : null}
        </TabButton>
      </div>

      {tab === "basic" ? (
        <>
          {/* Spend limits */}
          <section className="surface p-4">
            <p className="section-kicker flex items-center gap-2"><Wallet size={14} /> Spend limits</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-slate-300">
                Daily spending limit
                <MoneyInput value={dailyLimit} onChange={setDailyLimit} />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                Transaction cap
                <MoneyInput value={transactionCap} onChange={setTransactionCap} />
              </label>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Per-tx cap vs daily limit</span>
                <span className="font-semibold text-slate-300">{capRatio.toFixed(0)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={`h-full rounded-full ${capExceedsDaily ? "bg-amber" : "bg-gradient-to-r from-plasma to-mint"}`} style={{width: `${capRatio}%`}} />
              </div>
              {capExceedsDaily ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber">
                  <AlertTriangle size={13} />
                  Transaction cap exceeds the daily limit — a single payment could spend the full day.
                </p>
              ) : null}
            </div>
          </section>

          {/* Contract allowlist */}
          <section className="surface p-4">
            <p className="section-kicker flex items-center gap-2"><ShieldCheck size={14} /> Contract allowlist</p>
            <div className="mt-4 grid gap-2">
              {contractOptions.map((contract) => {
                const checked = selectedContracts.has(contract.address.toLowerCase());
                return (
                  <label key={contract.address} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-3 transition ${checked ? "border-plasma/30 bg-plasma/[0.08]" : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16]"}`}>
                    <span>
                      <span className="block text-[15px] font-medium text-white">{contract.label}</span>
                      <span className="mt-1 block text-[13px] text-slate-400">{contract.description} · {shortAddress(contract.address)}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#9b5cf6]"
                      checked={checked}
                      onChange={(event) => setContractAllowlist(toggleAddress(contractItems, contract.address, event.target.checked).join("\n"))}
                    />
                  </label>
                );
              })}
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-[13px] text-slate-400">Custom contracts</p>
              <ChipInput items={customContracts} onAdd={addContract} onRemove={removeContract} placeholder="0x… custom contract address" />
            </div>
          </section>

          {/* Recipient allowlist */}
          <section className="surface p-4">
            <p className="section-kicker flex items-center gap-2"><Users size={14} /> Recipient allowlist</p>
            <div className="mt-4">
              <ChipInput items={recipientItems} onAdd={addRecipient} onRemove={removeRecipient} placeholder="0x… recipient address" />
            </div>
          </section>
        </>
      ) : (
        <>
          {!hasPremiumAutomation ? (
            <PlanSubscriptionCard
              planId="premium_agent_automation"
              subscriptions={snapshot.data?.subscriptions ?? []}
              onActivated={async () => {
                await snapshot.refetch();
              }}
              className="border-amber/25 bg-amber/10"
            />
          ) : null}

          {/* Policy Engine V2 */}
          <section className={`surface p-4 ${hasPremiumAutomation ? "" : "opacity-70"}`}>
            <p className="section-kicker flex items-center gap-2"><SlidersHorizontal size={14} /> Policy Engine V2</p>
            {!hasPremiumAutomation ? <PremiumNotice /> : null}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm text-slate-300">
                Weekly spending limit
                <MoneyInput value={weeklyLimit} onChange={setWeeklyLimit} disabled={!hasPremiumAutomation} />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                Monthly spending limit
                <MoneyInput value={monthlyLimit} onChange={setMonthlyLimit} disabled={!hasPremiumAutomation} />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                Max units per API request
                <NumberInput value={maxUnitsPerRequest} onChange={setMaxUnitsPerRequest} placeholder="0 means no V2 unit cap" disabled={!hasPremiumAutomation} />
              </label>
              <label className="grid gap-2 text-sm text-slate-300">
                Cooldown between payments
                <CooldownInput value={cooldownSeconds} onChange={setCooldownSeconds} disabled={!hasPremiumAutomation} />
              </label>
              <div className="grid gap-2 text-sm text-slate-300 sm:col-span-2">
                Policy expiry
                <ExpiryInput value={expiresAt} onChange={setExpiresAt} disabled={!hasPremiumAutomation} />
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {weeklyBelowDaily ? <PolicyWarning icon={AlertTriangle} text="Weekly limit is below the daily limit. The weekly budget will become the effective cap." /> : null}
              {monthlyBelowWeekly ? <PolicyWarning icon={AlertTriangle} text="Monthly limit is below the weekly limit. The monthly budget will become the effective cap." /> : null}
              {onchainFootgun ? <PolicyWarning icon={AlertTriangle} text="Require on-chain policy is on, but this agent has no wallet address yet — the policy cannot be committed on-chain until Circle returns the wallet." /> : null}
              <div className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3">
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium text-white"><Database size={15} className="text-orchid" /> Require on-chain policy</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">Blocks x402 authorization unless this policy has an on-chain transaction hash.</span>
                </span>
                <Toggle checked={requireOnchainPolicy} onChange={setRequireOnchainPolicy} disabled={!hasPremiumAutomation} />
              </div>
            </div>
          </section>

          {/* Service allowlist */}
          <section className={`surface p-4 ${hasPremiumAutomation ? "" : "opacity-70"}`}>
            <p className="section-kicker flex items-center gap-2"><Clock size={14} /> Service allowlist</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">Limit an agent to specific Nexora service IDs, chain service IDs, endpoint hashes, or service names.</p>
            <div className="mt-4">
              <IdentifierInput items={serviceItems} onAdd={addService} onRemove={removeService} placeholder="service id, endpoint hash, or service name" disabled={!hasPremiumAutomation} />
            </div>
          </section>
        </>
      )}

      {/* Effective policy preview */}
      <EffectivePreview
        daily={dailyLimit}
        weekly={weeklyLimit}
        monthly={monthlyLimit}
        txCap={transactionCap}
        cooldownSeconds={cooldownSeconds}
        expiresAt={expiresAt}
        maxUnits={maxUnitsPerRequest}
        requireOnchain={requireOnchainPolicy}
      />

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.12] bg-[#0c0f18]/90 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
        <div className="min-w-0 flex-1">
          {changes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
              <span className="font-semibold text-orchid">Changes:</span>
              {changes.map((change) => (
                <span key={change} className="rounded-md border border-plasma/20 bg-plasma/10 px-2 py-0.5 font-medium text-slate-200">{change}</span>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-slate-400">
              <span>Daily <b className="text-white">${dailyLimit || "0"}</b></span>
              <Dot />
              <span>Tx <b className="text-white">${transactionCap || "0"}</b></span>
              {Number(weeklyLimit) > 0 ? <><Dot /><span>Wk <b className="text-white">${weeklyLimit}</b></span></> : null}
              {Number(cooldownSeconds) > 0 ? <><Dot /><span><b className="text-white">{formatDuration(Number(cooldownSeconds))}</b> cooldown</span></> : null}
              <Dot />
              <span><b className="text-white">{contractItems.length}</b> contracts</span>
              <Dot />
              <span><b className="text-white">{recipientItems.length}</b> recipients</span>
              {serviceItems.length > 0 ? <><Dot /><span><b className="text-white">{serviceItems.length}</b> services</span></> : null}
              {expiresAt ? <><Dot /><span>expires {expiryLabel(expiresAt)}</span></> : null}
              {requireOnchainPolicy ? <><Dot /><span className="text-orchid">on-chain required</span></> : null}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dirty ? (
            <button type="button" onClick={resetForm} className="secondary-button" disabled={saving} aria-label="Discard changes">
              <RotateCcw size={15} /> Reset
            </button>
          ) : null}
          <button onClick={savePolicy} className="action-button" disabled={!isConnected || !selectedAgent || saving || !canSave || (Boolean(selectedAgent?.address) && !policyChainReady)}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {saving
              ? "Saving policy…"
              : selectedAgent?.address
                ? policyChainReady ? `Save ${isBotPolicy ? "EOA policy" : `on ${chainLabel(chain?.id)}`}` : `Not available on ${chainLabel(chain?.id)}`
                : "Save pending policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-slate-700">·</span>;
}

function TabButton({active, onClick, children}: {active: boolean; onClick: () => void; children: React.ReactNode}) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center rounded-lg px-4 py-1.5 text-sm font-semibold transition ${active ? "bg-plasma/20 text-white" : "text-slate-400 hover:text-white"}`}>
      {children}
    </button>
  );
}

function Toggle({checked, onChange, disabled = false}: {checked: boolean; onChange: (value: boolean) => void; disabled?: boolean}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-plasma" : "bg-white/[0.14]"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function EffectivePreview({daily, weekly, monthly, txCap, cooldownSeconds, expiresAt, maxUnits, requireOnchain}: {
  daily: string;
  weekly: string;
  monthly: string;
  txCap: string;
  cooldownSeconds: string;
  expiresAt: string;
  maxUnits: string;
  requireOnchain: boolean;
}) {
  const windows = [
    Number(daily) > 0 ? {perDay: Number(daily), display: `$${daily}/day`} : null,
    Number(weekly) > 0 ? {perDay: Number(weekly) / 7, display: `$${weekly}/week`} : null,
    Number(monthly) > 0 ? {perDay: Number(monthly) / 30, display: `$${monthly}/month`} : null
  ].filter(Boolean) as Array<{perDay: number; display: string}>;
  const binding = windows.sort((a, b) => a.perDay - b.perDay)[0];

  const rows: Array<{icon: typeof Gauge; label: string; value: string; accent?: boolean}> = [
    {icon: Gauge, label: "Effective spend", value: binding ? binding.display : "No limit set", accent: true},
    {icon: Wallet, label: "Per-tx cap", value: Number(txCap) > 0 ? `$${txCap}` : "No cap"},
    {icon: Timer, label: "Cooldown", value: Number(cooldownSeconds) > 0 ? formatDuration(Number(cooldownSeconds)) : "None"},
    {icon: CalendarClock, label: "Expiry", value: expiresAt ? expiryLabel(expiresAt) : "No expiry"},
    {icon: SlidersHorizontal, label: "Max units / req", value: Number(maxUnits) > 0 ? String(maxUnits) : "Unlimited"},
    {icon: Database, label: "On-chain required", value: requireOnchain ? "Yes" : "No"}
  ];

  return (
    <section className="panel relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(110,231,183,0.08),transparent_40%)]" />
      <p className="section-kicker relative">Effective policy</p>
      <div className="relative mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="surface flex items-center gap-2.5 px-3 py-3">
              <Icon size={16} className={row.accent ? "text-mint" : "text-orchid"} />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-slate-400">{row.label}</p>
                <p className={`truncate text-[15px] font-semibold ${row.accent ? "text-mint" : "text-white"}`}>{row.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MoneyInput({value, onChange, disabled = false}: {value: string; onChange: (value: string) => void; disabled?: boolean}) {
  return (
    <div className={`field flex items-center gap-1 p-0 pl-3 pr-3 ${disabled ? "opacity-60" : ""}`}>
      <span className="text-slate-500">$</span>
      <input
        className="min-w-0 flex-1 bg-transparent py-3 text-white outline-none"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function NumberInput({value, onChange, placeholder, disabled = false}: {value: string; onChange: (value: string) => void; placeholder: string; disabled?: boolean}) {
  return (
    <input
      className="field disabled:cursor-not-allowed disabled:opacity-60"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  );
}

const COOLDOWN_UNITS: Record<string, number> = {sec: 1, min: 60, hour: 3600, day: 86400};

function CooldownInput({value, onChange, disabled = false}: {value: string; onChange: (value: string) => void; disabled?: boolean}) {
  const seconds = Number(value || 0);
  const [unit, setUnit] = useState(() =>
    seconds > 0 && seconds % 86400 === 0 ? "day" : seconds > 0 && seconds % 3600 === 0 ? "hour" : seconds > 0 && seconds % 60 === 0 ? "min" : "sec"
  );
  const factor = COOLDOWN_UNITS[unit];
  const amount = seconds > 0 ? seconds / factor : 0;
  return (
    <div className="flex gap-2">
      <input
        className="field min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-60"
        inputMode="numeric"
        value={amount > 0 ? String(amount) : ""}
        placeholder="0 disables"
        disabled={disabled}
        onChange={(event) => {
          if (disabled) return;
          const next = Math.max(0, Math.round((Number(event.target.value) || 0) * factor));
          onChange(String(next));
        }}
      />
      <select className="field w-24 bg-slate-950 text-white disabled:cursor-not-allowed disabled:opacity-60" value={unit} disabled={disabled} onChange={(event) => setUnit(event.target.value)}>
        <option value="sec">sec</option>
        <option value="min">min</option>
        <option value="hour">hour</option>
        <option value="day">day</option>
      </select>
    </div>
  );
}

const EXPIRY_PRESETS: Array<[string, number]> = [
  ["24h", 86_400_000],
  ["7d", 7 * 86_400_000],
  ["30d", 30 * 86_400_000]
];

function ExpiryInput({value, onChange, disabled = false}: {value: string; onChange: (value: string) => void; disabled?: boolean}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {EXPIRY_PRESETS.map(([label, ms]) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(toDateTimeLocal(new Date(Date.now() + ms).toISOString()))}
            className="rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-plasma/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("")}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${value ? "border-white/[0.1] bg-white/[0.04] text-slate-300 hover:text-white" : "border-plasma/40 bg-plasma/[0.12] text-white"}`}
        >
          Never
        </button>
      </div>
      <input type="datetime-local" className="field mt-2 disabled:cursor-not-allowed disabled:opacity-60" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ChipInput({items, onAdd, onRemove, placeholder}: {items: string[]; onAdd: (addr: string) => void; onRemove: (addr: string) => void; placeholder: string}) {
  const [draft, setDraft] = useState("");
  function commit() {
    const value = draft.trim();
    if (!ADDRESS_RE.test(value)) {
      toast.error("Enter a valid 0x… address");
      return;
    }
    onAdd(value);
    setDraft("");
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          className="field flex-1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" onClick={commit} className="secondary-button px-4">Add</button>
      </div>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((addr) => (
            <span key={addr} className="status-pill gap-1.5 pr-2 font-mono">
              {shortAddress(addr)}
              <button type="button" onClick={() => onRemove(addr)} className="text-slate-500 transition hover:text-magenta" aria-label="Remove address">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function IdentifierInput({items, onAdd, onRemove, placeholder, disabled = false}: {items: string[]; onAdd: (value: string) => void; onRemove: (value: string) => void; placeholder: string; disabled?: boolean}) {
  const [draft, setDraft] = useState("");
  function commit() {
    if (disabled) return;
    const value = draft.trim();
    if (value.length < 2 || value.length > 160) {
      toast.error("Enter a valid service identifier");
      return;
    }
    onAdd(value);
    setDraft("");
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          className="field flex-1 disabled:cursor-not-allowed disabled:opacity-60"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" onClick={commit} disabled={disabled} className="secondary-button px-4 disabled:cursor-not-allowed disabled:opacity-50">Add</button>
      </div>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className="status-pill gap-1.5 pr-2">
              {item}
              <button type="button" disabled={disabled} onClick={() => onRemove(item)} className="text-slate-500 transition hover:text-magenta disabled:cursor-not-allowed disabled:opacity-50" aria-label="Remove service identifier">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PolicyWarning({icon: Icon, text}: {icon: typeof AlertTriangle; text: string}) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber/25 bg-amber/10 p-3 text-xs leading-5 text-amber">
      <Icon size={14} className="mt-0.5 shrink-0" />
      {text}
    </p>
  );
}

function PremiumNotice() {
  return (
    <p className="mt-3 rounded-xl border border-amber/25 bg-amber/10 p-3 text-xs leading-5 text-amber">
      Premium Agent Automation is required for weekly and monthly budgets, service allowlists, cooldowns, expiry, max API units, and on-chain policy enforcement.
    </p>
  );
}

function formatDuration(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function expiryLabel(localValue: string) {
  if (!localValue) return "No expiry";
  const target = new Date(localValue).getTime();
  if (!Number.isFinite(target)) return "No expiry";
  const diff = target - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `in ${hours}h`;
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  return `in ${minutes}m`;
}

function listKey(value: string) {
  return value
    .split(/[\s,\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

function splitAddresses(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("0x"));
}

function splitIdentifiers(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function withAdded(list: string[], addr: string) {
  return list.some((item) => item.toLowerCase() === addr.toLowerCase()) ? list : [...list, addr];
}

function withRemoved(list: string[], addr: string) {
  return list.filter((item) => item.toLowerCase() !== addr.toLowerCase());
}

function toggleAddress(addresses: string[], address: string, checked: boolean) {
  const normalized = address.toLowerCase();
  const withoutAddress = addresses.filter((item) => item.toLowerCase() !== normalized);
  return checked ? [...withoutAddress, address] : withoutAddress;
}

function policyV2Payload(input: {
  weeklyLimit: string;
  monthlyLimit: string;
  maxUnitsPerRequest: string;
  cooldownSeconds: string;
  expiresAt: string;
  serviceAllowlist: string[];
  previousServiceAllowlist?: string[];
  requireOnchainPolicy: boolean;
}) {
  return {
    weeklyLimitUsdc: Number(input.weeklyLimit || 0),
    monthlyLimitUsdc: Number(input.monthlyLimit || 0),
    maxUnitsPerRequest: Number(input.maxUnitsPerRequest || 0),
    cooldownSeconds: Number(input.cooldownSeconds || 0),
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    serviceAllowlist: input.serviceAllowlist,
    previousServiceAllowlist: input.previousServiceAllowlist,
    requireOnchainPolicy: input.requireOnchainPolicy
  };
}

function externalBotAgentDraft(address: string, chainId: number, chainName: string): AppSnapshot["agents"][number] {
  const now = new Date().toISOString();
  return {
    id: `external-eoa-${chainId}-${address.toLowerCase()}`,
    walletKind: "external_eoa",
    operatorAddress: address,
    arcName: null,
    address,
    circleWalletSetId: null,
    circleWalletId: null,
    circleAccountType: null,
    settlementMode: null,
    circleWalletStatus: "external_eoa_ready",
    chainWallets: [{
      chainId,
      chain: chainName,
      circleBlockchain: "EXTERNAL-EVM",
      address,
      circleWalletId: null,
      status: "ready",
      updatedAt: now
    }],
    createdAt: now,
    policy: {
      dailyLimitUsdc: 400,
      transactionCapUsdc: 45,
      contractAllowlist: [],
      recipientAllowlist: [],
      active: true,
      deployments: [],
      v2: {
        weeklyLimitUsdc: 0,
        monthlyLimitUsdc: 0,
        maxUnitsPerRequest: 0,
        cooldownSeconds: 0,
        expiresAt: null,
        serviceAllowlist: [],
        requireOnchainPolicy: false
      }
    }
  };
}

function hasPremiumPolicySettings(input: {
  weeklyLimit: string;
  monthlyLimit: string;
  maxUnitsPerRequest: string;
  cooldownSeconds: string;
  expiresAt: string;
  serviceAllowlist: string[];
  requireOnchainPolicy: boolean;
}) {
  return Number(input.weeklyLimit || 0) > 0
    || Number(input.monthlyLimit || 0) > 0
    || Number(input.maxUnitsPerRequest || 0) > 0
    || Number(input.cooldownSeconds || 0) > 0
    || Boolean(input.expiresAt)
    || input.serviceAllowlist.length > 0
    || input.requireOnchainPolicy;
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
