import {useState} from "react";
import {Bot, ExternalLink, Gauge, ShieldCheck, Wallet} from "lucide-react";
import {useAccount} from "wagmi";
import {PolicyForm} from "@/components/PolicyForm";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {AgentAvatar} from "@/components/AgentAvatar";
import {EmptyState} from "@/components/EmptyState";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Agent = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["agents"][number];

export default function PoliciesPage() {
  const {isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const activePolicies = agents.filter((agent) => agent.policy.active);
  const onchainPolicies = agents.filter((agent) => agent.policy.txHash);
  const v2Policies = agents.filter((agent) => hasPolicyV2(agent));
  const [selectedAgentId, setSelectedAgentId] = useState("");

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
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={ShieldCheck} label="Active policies" value={activePolicies.length} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Gauge} label="On-chain saves" value={onchainPolicies.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Bot} label="Managed agents" value={agents.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Gauge} label="V2 controls" value={v2Policies.length} loading={snapshot.isLoading} />
      </div>

      <section className="panel">
        <p className="section-kicker">Configure policy</p>
        <h2 className="page-title">Spending rules and allowlists</h2>
        <PolicyForm selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
      </section>

      <section className="panel">
        <div className="mb-4">
          <p className="text-sm text-slate-400">Policy health</p>
          <h2 className="text-xl font-semibold text-white">Agent controls overview</h2>
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
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-white/[0.08] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 font-semibold">Agent</th>
                    <th className="font-semibold">Limits</th>
                    <th className="font-semibold">Contracts</th>
                    <th className="font-semibold">Recipients</th>
                    <th className="font-semibold">V2</th>
                    <th className="font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr
                      key={agent.id}
                      onClick={() => selectAgent(agent.id)}
                      className="cursor-pointer border-b border-white/[0.06] transition hover:bg-white/[0.03]"
                    >
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} size={34} />
                          <div className="min-w-0">
                            <p className="font-medium text-white">{agent.arcName ?? shortAddress(agent.operatorAddress)}</p>
                            <p className="mt-0.5 font-mono text-xs text-slate-500">{agent.address ? shortAddress(agent.address) : "Circle pending"}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <LimitBar daily={Number(agent.policy.dailyLimitUsdc)} cap={Number(agent.policy.transactionCapUsdc)} />
                      </td>
                      <td className="text-white">{agent.policy.contractAllowlist.length}</td>
                      <td className="text-white">{agent.policy.recipientAllowlist.length}</td>
                      <td><V2Badge agent={agent} /></td>
                      <td><StatusPill agent={agent} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="grid gap-3 md:hidden">
              {agents.map((agent) => (
                <button key={agent.id} type="button" onClick={() => selectAgent(agent.id)} className="surface w-full p-4 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} size={34} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{agent.arcName ?? shortAddress(agent.operatorAddress)}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">{agent.address ? shortAddress(agent.address) : "Circle pending"}</p>
                      </div>
                    </div>
                    <StatusPill agent={agent} />
                  </div>
                  <div className="mt-3">
                    <LimitBar daily={Number(agent.policy.dailyLimitUsdc)} cap={Number(agent.policy.transactionCapUsdc)} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{agent.policy.contractAllowlist.length} contracts · {agent.policy.recipientAllowlist.length} recipients · {agent.policy.v2?.serviceAllowlist.length ?? 0} services</p>
                </button>
              ))}
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
  if (!hasPolicyV2(agent)) return <span className="text-slate-600">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-plasma/25 bg-plasma/10 px-2.5 py-1 text-xs font-bold text-orchid">
      <Gauge size={12} /> V2
    </span>
  );
}

function LimitBar({daily, cap}: {daily: number; cap: number}) {
  const ratio = daily > 0 ? Math.min(100, (cap / daily) * 100) : 0;
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white">${cap} <span className="font-normal text-slate-500">/ ${daily}</span></span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-gradient-to-r from-plasma to-mint" style={{width: `${ratio}%`}} />
      </div>
    </div>
  );
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
