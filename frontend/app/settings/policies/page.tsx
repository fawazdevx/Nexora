import {useMemo, useState} from "react";
import {
  AlertTriangle,
  Bot,
  ClipboardCheck,
  ExternalLink,
  Filter,
  Gauge,
  ScrollText,
  Search,
  ShieldCheck,
  Wallet
} from "lucide-react";
import {useAccount} from "wagmi";
import {PolicyForm} from "@/components/PolicyForm";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {AgentAvatar} from "@/components/AgentAvatar";
import {EmptyState} from "@/components/EmptyState";
import {RiskAlertsPanel} from "@/components/RiskAlertsPanel";
import {AgentCommandModal} from "@/components/AgentCommandModal";
import {arcTestnet, shortAddress, supportedChains} from "@/lib/arc";
import {navigateTo} from "@/lib/router";
import {timeAgo} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Agent = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["agents"][number];
type SpendMap = Record<string, {day: number; week: number; month: number}>;
type AgentFilter = "all" | "active" | "attention" | "onchain" | "expired";

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function PoliciesPage() {
  const {isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const managedAgents = agents.filter((agent) => agent.walletKind !== "external_eoa");
  const activePolicies = agents.filter((agent) => agent.policy.active);
  const onchainPolicies = agents.filter((agent) => (agent.policy.deployments?.length ?? 0) > 0 || agent.policy.txHash);
  const pendingApprovals = (snapshot.data?.approvalRequests ?? []).filter((request) => request.status === "pending");
  const riskAlerts = snapshot.data?.riskAlerts ?? [];
  const attentionCount = pendingApprovals.length + riskAlerts.length;

  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");

  const spentByAgent = useMemo(() => {
    const dayCutoff = startOfToday();
    const weekCutoff = Date.now() - 7 * 86_400_000;
    const monthCutoff = Date.now() - 30 * 86_400_000;
    const map: SpendMap = {};
    for (const payment of snapshot.data?.payments ?? []) {
      if (payment.status !== "settled" || !payment.agentId) continue;
      const created = Date.parse(payment.createdAt);
      if (!Number.isFinite(created)) continue;
      const amount = Number(payment.amountUsdc || 0);
      if (!map[payment.agentId]) map[payment.agentId] = {day: 0, week: 0, month: 0};
      if (created >= dayCutoff) map[payment.agentId].day += amount;
      if (created >= weekCutoff) map[payment.agentId].week += amount;
      if (created >= monthCutoff) map[payment.agentId].month += amount;
    }
    return map;
  }, [snapshot.data?.payments]);

  const attentionAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const alert of riskAlerts) {
      if (alert.agentId) ids.add(alert.agentId);
    }
    for (const request of pendingApprovals) {
      ids.add(request.agentId);
    }
    for (const agent of agents) {
      if (isPolicyExpired(agent)) ids.add(agent.id);
    }
    return ids;
  }, [riskAlerts, pendingApprovals, agents]);

  const filteredAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase();
    return agents.filter((agent) => {
      if (agentFilter === "active" && !agent.policy.active) return false;
      if (agentFilter === "onchain" && !isOnchainPolicy(agent)) return false;
      if (agentFilter === "expired" && !isPolicyExpired(agent)) return false;
      if (agentFilter === "attention" && !attentionAgentIds.has(agent.id)) return false;
      if (!query) return true;
      const haystack = [
        agent.arcName,
        agent.address,
        agent.operatorAddress,
        agent.id,
        agent.walletKind
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [agents, agentFilter, agentQuery, attentionAgentIds]);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? filteredAgents[0] ?? agents[0] ?? null;
  const effectiveSelectedId = selectedAgent?.id ?? "";

  function selectAgent(id: string) {
    setSelectedAgentId(id);
  }

  return (
    <div className="space-y-5 animate-fade-in pb-28">
      <PageHeader
        kicker="Policies"
        title="Agent spending controls"
        description="Set limits, allowlists, cooldowns, and on-chain enforcement for agent wallets. Every payment is checked against these rules before USDC moves."
        action={
          <button type="button" className="secondary-button" onClick={() => setCommandOpen(true)}>
            <ScrollText size={16} />
            Agent commands
          </button>
        }
      />

      <AgentCommandModal
        open={commandOpen}
        selectedAgentId={effectiveSelectedId}
        onSelectAgent={setSelectedAgentId}
        onClose={() => setCommandOpen(false)}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={ShieldCheck} label="Active controls" value={activePolicies.length} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Gauge} label="On-chain enforced" value={onchainPolicies.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Bot} label="Agents" value={managedAgents.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ClipboardCheck} label="Needs attention" value={attentionCount} loading={snapshot.isLoading} />
      </div>

      <RiskAlertsPanel
        compact
        onSelectAgent={(agentId) => {
          if (agentId) selectAgent(agentId);
        }}
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <aside className="panel space-y-4 xl:sticky xl:top-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="section-kicker">Agent directory</p>
              <h2 className="mt-2 text-lg font-semibold text-white">Select an agent</h2>
            </div>
            <span className="status-pill">{filteredAgents.length}</span>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3">
            <Search size={15} className="shrink-0 text-slate-500" />
            <input
              value={agentQuery}
              onChange={(event) => setAgentQuery(event.target.value)}
              className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-slate-500"
              placeholder="Search agents…"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="mr-0.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
              <Filter size={11} />
            </span>
            {([
              ["all", "All"],
              ["active", "Active"],
              ["attention", "Attention"],
              ["onchain", "On-chain"],
              ["expired", "Expired"]
            ] as Array<[AgentFilter, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAgentFilter(key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  agentFilter === key
                    ? "border-mint/35 bg-mint/15 text-mint"
                    : "border-white/[0.1] bg-white/[0.03] text-slate-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {snapshot.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => <div key={index} className="shimmer h-28 rounded-xl" />)}
            </div>
          ) : agents.length === 0 ? (
            isConnected ? (
              <EmptyState
                icon={<ShieldCheck size={22} />}
                title="No agents yet"
                copy="Create an agent wallet to start enforcing daily limits, transaction caps, and allowlists."
                className="border-0 bg-transparent p-0 py-6 shadow-none"
                action={
                  <button type="button" className="secondary-button text-xs" onClick={() => navigateTo("/agents")}>
                    Create agent
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={<Wallet size={22} />}
                title="Connect your wallet"
                copy="Connect an operator wallet to view and manage agent spending policies."
                className="border-0 bg-transparent p-0 py-6 shadow-none"
              />
            )
          ) : filteredAgents.length === 0 ? (
            <EmptyState
              icon={<Search size={22} />}
              title="No matching agents"
              copy="Try a different search or clear filters."
              className="border-0 bg-transparent p-0 py-6 shadow-none"
              action={
                <button
                  type="button"
                  className="secondary-button text-xs"
                  onClick={() => {
                    setAgentFilter("all");
                    setAgentQuery("");
                  }}
                >
                  Reset filters
                </button>
              }
            />
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {filteredAgents.map((agent) => (
                <AgentDirectoryCard
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === effectiveSelectedId}
                  spend={spentByAgent[agent.id] ?? {day: 0, week: 0, month: 0}}
                  attention={attentionAgentIds.has(agent.id)}
                  onSelect={() => selectAgent(agent.id)}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="panel">
            <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="section-kicker">Policy editor</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {selectedAgent
                    ? selectedAgent.walletKind === "external_eoa"
                      ? "External EOA controls"
                      : selectedAgent.arcName ?? shortAddress(selectedAgent.address ?? selectedAgent.operatorAddress)
                    : "Select an agent"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Configure limits, access rules, and guardrails. Test a payment against the same checks used at authorization time.
                </p>
              </div>
            </div>

            {selectedAgent || agents.length > 0 ? (
              <PolicyForm
                selectedAgentId={effectiveSelectedId}
                onSelectAgent={setSelectedAgentId}
                spent={selectedAgent ? spentByAgent[selectedAgent.id] ?? {day: 0, week: 0, month: 0} : undefined}
                hideAgentPicker={Boolean(selectedAgent)}
                embedded
              />
            ) : (
              <EmptyState
                icon={<ShieldCheck size={26} />}
                title="No policy to edit"
                copy="Create or select an agent to configure spending controls."
                className="border-0 bg-transparent p-0 py-10 shadow-none"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentDirectoryCard({
  agent,
  selected,
  spend,
  attention,
  onSelect
}: {
  agent: Agent;
  selected: boolean;
  spend: {day: number; week: number; month: number};
  attention: boolean;
  onSelect: () => void;
}) {
  const status = policyStatus(agent);
  const daily = Number(agent.policy.dailyLimitUsdc || 0);
  const weekly = Number(agent.policy.v2?.weeklyLimitUsdc || 0);
  const monthly = Number(agent.policy.v2?.monthlyLimitUsdc || 0);
  const title = agent.walletKind === "external_eoa"
    ? "BOT EOA policy"
    : agent.arcName ?? shortAddress(agent.address ?? agent.operatorAddress);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`surface w-full p-3.5 text-left transition ${
        selected
          ? "border-plasma/40 bg-plasma/[0.1] shadow-[inset_2px_0_0_rgba(155,92,246,0.9)]"
          : "hover:border-white/[0.16]"
      }`}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{title}</p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-400">
                {agent.address ? shortAddress(agent.address) : agent.walletKind === "external_eoa" ? "External EOA" : "Wallet pending"}
                {agent.createdAt ? <span className="text-slate-500"> · {timeAgo(agent.createdAt)}</span> : null}
              </p>
            </div>
            <StatusPill agent={agent} compact />
          </div>

          <div className="mt-3">
            <SpendBar label="Today" limit={daily} spent={spend.day} />
            {weekly > 0 ? <div className="mt-1.5"><SpendBar label="Week" limit={weekly} spent={spend.week} compact /></div> : null}
            {monthly > 0 ? <div className="mt-1.5"><SpendBar label="Month" limit={monthly} spent={spend.month} compact /></div> : null}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span>{agent.policy.contractAllowlist.length} contracts</span>
            <span className="text-slate-600">·</span>
            <span>{agent.policy.recipientAllowlist.length} recipients</span>
            {(agent.policy.v2?.serviceAllowlist?.length ?? 0) > 0 ? (
              <>
                <span className="text-slate-600">·</span>
                <span>{agent.policy.v2?.serviceAllowlist.length} services</span>
              </>
            ) : null}
            {hasAdvancedRules(agent) ? (
              <span className="rounded-full border border-plasma/25 bg-plasma/10 px-2 py-0.5 text-[10px] font-semibold text-orchid">
                Advanced rules
              </span>
            ) : null}
            {attention ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber/25 bg-amber/10 px-2 py-0.5 text-[10px] font-semibold text-amber">
                <AlertTriangle size={10} /> Attention
              </span>
            ) : null}
            {status === "expired" ? (
              <span className="rounded-full border border-magenta/25 bg-magenta/10 px-2 py-0.5 text-[10px] font-semibold text-magenta">
                Expired
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function SpendBar({
  label,
  limit,
  spent,
  compact
}: {
  label?: string;
  limit: number;
  spent: number;
  compact?: boolean;
}) {
  const ratio = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const near = ratio >= 80;
  const over = ratio >= 100;
  const barClass = over ? "bg-magenta" : near ? "bg-amber" : "bg-gradient-to-r from-plasma to-mint";

  return (
    <div className={compact ? "min-w-0" : "min-w-[140px]"}>
      <div className={`flex items-center justify-between ${compact ? "text-[11px]" : "text-sm"}`}>
        <span className="font-semibold text-white">
          {label ? <span className="mr-1 font-normal text-slate-500">{label}</span> : null}
          ${spent.toFixed(2)}
          <span className="font-normal text-slate-400"> / ${limit || 0}</span>
        </span>
        <span className={over ? "font-semibold text-magenta" : near ? "font-semibold text-amber" : "text-slate-400"}>
          {ratio.toFixed(0)}%
        </span>
      </div>
      <div className={`mt-1 overflow-hidden rounded-full bg-white/[0.06] ${compact ? "h-1.5" : "h-2"}`}>
        <div className={`h-full rounded-full ${barClass}`} style={{width: `${ratio}%`}} />
      </div>
    </div>
  );
}

function StatusPill({agent, compact}: {agent: Agent; compact?: boolean}) {
  const deployments = agent.policy.deployments?.length
    ? agent.policy.deployments
    : agent.policy.txHash
      ? [{chainId: arcTestnet.id, txHash: agent.policy.txHash}]
      : [];
  const onchain = deployments.length > 0;
  const expired = isPolicyExpired(agent);
  const noWallet = !agent.address && agent.walletKind !== "external_eoa";
  const deployment = deployments[0];
  const explorer = supportedChains.find((chain) => chain.id === deployment?.chainId)?.blockExplorers.default.url
    ?? arcTestnet.explorerUrl;

  let label = "App-enforced";
  let classes = "border-amber/25 bg-amber/10 text-amber";
  if (expired) {
    label = "Expired";
    classes = "border-magenta/25 bg-magenta/10 text-magenta";
  } else if (noWallet) {
    label = "No wallet yet";
    classes = "border-slate-500/30 bg-white/[0.04] text-slate-400";
  } else if (onchain) {
    label = compact ? "On-chain" : `On-chain · ${deployments.length}`;
    classes = "border-mint/25 bg-mint/10 text-mint";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${classes}`}>
      <span className="relative flex h-1.5 w-1.5">
        {onchain && !expired ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" /> : null}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
          expired ? "bg-magenta" : onchain ? "bg-mint" : noWallet ? "bg-slate-500" : "bg-amber"
        }`} />
      </span>
      {label}
      {deployment && !compact ? (
        <a
          href={`${explorer.replace(/\/$/, "")}/tx/${deployment.txHash}`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="text-mint/70 transition hover:text-mint"
          aria-label="View policy transaction"
        >
          <ExternalLink size={11} />
        </a>
      ) : null}
    </span>
  );
}

function isOnchainPolicy(agent: Agent) {
  return Boolean((agent.policy.deployments?.length ?? 0) > 0 || agent.policy.txHash);
}

function isPolicyExpired(agent: Agent) {
  const expiresAt = agent.policy.v2?.expiresAt ? Date.parse(agent.policy.v2.expiresAt) : null;
  return expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function hasAdvancedRules(agent: Agent) {
  const v2 = agent.policy.v2;
  return Boolean(
    v2 &&
    (v2.weeklyLimitUsdc > 0 ||
      v2.monthlyLimitUsdc > 0 ||
      v2.maxUnitsPerRequest > 0 ||
      v2.cooldownSeconds > 0 ||
      v2.expiresAt ||
      v2.serviceAllowlist.length > 0 ||
      v2.requireOnchainPolicy)
  );
}

function policyStatus(agent: Agent): "active" | "expired" | "onchain" | "draft" {
  if (isPolicyExpired(agent)) return "expired";
  if (isOnchainPolicy(agent)) return "onchain";
  if (agent.policy.active) return "active";
  return "draft";
}
