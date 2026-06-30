import {useMemo, useState} from "react";
import {Bot, ClipboardCheck, ExternalLink, Gauge, ScrollText, ShieldCheck, Wallet} from "lucide-react";
import {useAccount} from "wagmi";
import {PolicyForm} from "@/components/PolicyForm";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {AgentAvatar} from "@/components/AgentAvatar";
import {EmptyState} from "@/components/EmptyState";
import {PolicySimulationPanel} from "@/components/PolicySimulationPanel";
import {RiskAlertsPanel} from "@/components/RiskAlertsPanel";
import {AgentCommandModal} from "@/components/AgentCommandModal";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Agent = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["agents"][number];

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export default function PoliciesPage() {
  const {isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const activePolicies = agents.filter((agent) => agent.policy.active);
  const onchainPolicies = agents.filter((agent) => agent.policy.txHash);
  const pendingApprovals = (snapshot.data?.approvalRequests ?? []).filter((request) => request.status === "pending");
  const riskAlerts = snapshot.data?.riskAlerts ?? [];
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);

  // Derive each agent's USD spend today from settled payments it made.
  const spentByAgent = useMemo(() => {
    const cutoff = startOfToday();
    const map: Record<string, number> = {};
    for (const payment of snapshot.data?.payments ?? []) {
      if (payment.status !== "settled" || !payment.agentId) continue;
      if (Date.parse(payment.createdAt) < cutoff) continue;
      map[payment.agentId] = (map[payment.agentId] ?? 0) + Number(payment.amountUsdc || 0);
    }
    return map;
  }, [snapshot.data?.payments]);

  function selectAgent(id: string) {
    setSelectedAgentId(id);
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Agent controls"
        title="Wallet policy cockpit"
        description="Set daily spend limits, transaction caps, and autonomous payment controls."
        action={
          <button type="button" className="action-button" onClick={() => setCommandOpen(true)}>
            <ScrollText size={16} />
            Command agent
          </button>
        }
      />

      <AgentCommandModal open={commandOpen} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} onClose={() => setCommandOpen(false)} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={ShieldCheck} label="Active policies" value={activePolicies.length} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Gauge} label="On-chain saves" value={onchainPolicies.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Bot} label="Managed agents" value={agents.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ClipboardCheck} label="Open actions" value={pendingApprovals.length + riskAlerts.length} loading={snapshot.isLoading} />
      </div>

      <RiskAlertsPanel />

      <PolicySimulationPanel />

      <section className="panel">
        <p className="section-kicker">Configure policy</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Spending rules and allowlists</h2>
        <PolicyForm selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
      </section>

      <section className="panel">
        <div className="mb-5">
          <p className="section-kicker">Policy health</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Agent controls overview</h2>
        </div>

        {snapshot.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => <div key={index} className="shimmer h-14 w-full rounded-xl" />)}
          </div>
        ) : agents.length === 0 ? (
          isConnected ? (
            <EmptyState icon={<ShieldCheck size={26} />} title="No policies yet" copy="Create an agent wallet to start enforcing daily limits, transaction caps, and allowlists." className="border-0 bg-transparent p-0 shadow-none" />
          ) : (
            <EmptyState icon={<Wallet size={26} />} title="Connect your wallet" copy="Connect a wallet to view and manage agent spending policies." className="border-0 bg-transparent p-0 shadow-none" />
          )
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] border-separate border-spacing-y-1.5 text-left">
                <thead className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 pb-2">Agent</th>
                    <th className="px-4 pb-2">Spent today</th>
                    <th className="px-4 pb-2">Allowlists</th>
                    <th className="px-4 pb-2">Expiry</th>
                    <th className="px-4 pb-2">V2</th>
                    <th className="px-4 pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => {
                    const selected = agent.id === selectedAgentId;
                    return (
                      <tr
                        key={agent.id}
                        onClick={() => selectAgent(agent.id)}
                        aria-selected={selected}
                        className={`group cursor-pointer transition-colors ${selected ? "bg-gradient-to-r from-plasma/[0.12] to-transparent shadow-[inset_2px_0_0_rgba(155,92,246,0.9)]" : "hover:bg-white/[0.04]"}`}
                      >
                        <td className="rounded-l-xl px-4 py-4">
                          <div className="flex items-center gap-3">
                            <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} size={38} />
                            <div className="min-w-0">
                              <p className="text-[15px] font-semibold text-white">{agent.arcName ?? shortAddress(agent.operatorAddress)}</p>
                              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[13px] text-slate-400">
                                {agent.address ? shortAddress(agent.address) : "Circle pending"}
                                {agent.createdAt ? <span className="text-slate-500">· {timeAgo(agent.createdAt)}</span> : null}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <SpendBar daily={Number(agent.policy.dailyLimitUsdc)} spent={spentByAgent[agent.id] ?? 0} />
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-300">{agent.policy.contractAllowlist.length}c · {agent.policy.recipientAllowlist.length}r</td>
                        <td className="px-4 py-4"><ExpiryCell agent={agent} /></td>
                        <td className="px-4 py-4"><V2Badge agent={agent} /></td>
                        <td className="rounded-r-xl px-4 py-4"><StatusPill agent={agent} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="grid gap-3 md:hidden">
              {agents.map((agent) => {
                const selected = agent.id === selectedAgentId;
                return (
                  <button key={agent.id} type="button" onClick={() => selectAgent(agent.id)} className={`surface w-full p-4 text-left ${selected ? "border-plasma/40 bg-plasma/[0.08] shadow-[inset_2px_0_0_rgba(155,92,246,0.9)]" : ""}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} size={38} />
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-white">{agent.arcName ?? shortAddress(agent.operatorAddress)}</p>
                          <p className="mt-0.5 font-mono text-[13px] text-slate-400">{agent.address ? shortAddress(agent.address) : "Circle pending"}</p>
                        </div>
                      </div>
                      <StatusPill agent={agent} />
                    </div>
                    <div className="mt-3">
                      <SpendBar daily={Number(agent.policy.dailyLimitUsdc)} spent={spentByAgent[agent.id] ?? 0} />
                    </div>
                    <p className="mt-2.5 flex flex-wrap items-center gap-x-2 text-[13px] text-slate-400">
                      <span>{agent.policy.contractAllowlist.length} contracts · {agent.policy.recipientAllowlist.length} recipients</span>
                      <ExpiryCell agent={agent} />
                    </p>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function hasPolicyV2(agent: Agent) {
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

function V2Badge({agent}: {agent: Agent}) {
  if (!hasPolicyV2(agent)) return <span className="text-slate-500">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-plasma/25 bg-plasma/10 px-2.5 py-1 text-xs font-bold text-orchid">
      <Gauge size={12} /> V2
    </span>
  );
}

function SpendBar({daily, spent}: {daily: number; spent: number}) {
  const ratio = daily > 0 ? Math.min(100, (spent / daily) * 100) : 0;
  const near = ratio >= 80;
  return (
    <div className="min-w-[150px]">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-white">${spent.toFixed(2)} <span className="font-normal text-slate-400">/ ${daily}</span></span>
        <span className={near ? "font-semibold text-amber" : "text-slate-400"}>{ratio.toFixed(0)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${near ? "bg-amber" : "bg-gradient-to-r from-plasma to-mint"}`} style={{width: `${ratio}%`}} />
      </div>
    </div>
  );
}

function ExpiryCell({agent}: {agent: Agent}) {
  const v2 = agent.policy.v2;
  const cooldown = v2?.cooldownSeconds ?? 0;
  const expiresAt = v2?.expiresAt ? Date.parse(v2.expiresAt) : null;
  const expired = expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now();
  if (!expiresAt && cooldown <= 0) return <span className="text-slate-500">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      {expiresAt ? (
        expired ? (
          <span className="rounded-full border border-magenta/25 bg-magenta/10 px-2 py-0.5 text-xs font-semibold text-magenta">Expired</span>
        ) : (
          <span className="text-slate-200">{relativeExpiry(expiresAt)}</span>
        )
      ) : null}
      {cooldown > 0 ? <span className="text-slate-400">{formatCooldown(cooldown)} cd</span> : null}
    </span>
  );
}

function relativeExpiry(target: number) {
  const diff = target - Date.now();
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `in ${hours}h`;
  return `in ${Math.max(1, Math.floor(diff / 60_000))}m`;
}

function formatCooldown(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function StatusPill({agent}: {agent: Agent}) {
  const onchain = Boolean(agent.policy.txHash);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${onchain ? "border-mint/25 bg-mint/10 text-mint" : "border-amber/25 bg-amber/10 text-amber"}`}>
      <span className="relative flex h-2 w-2">
        {onchain ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" /> : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${onchain ? "bg-mint" : "bg-amber"}`} />
      </span>
      {onchain ? "On-chain" : "Saved"}
      {onchain && agent.policy.txHash ? (
        <a
          href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${agent.policy.txHash}`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="text-mint/70 transition hover:text-mint"
          aria-label="View policy transaction"
        >
          <ExternalLink size={12} />
        </a>
      ) : null}
    </span>
  );
}
