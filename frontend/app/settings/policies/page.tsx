import {PolicyForm} from "@/components/PolicyForm";
import {PageHeader} from "@/components/PageHeader";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function PoliciesPage() {
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const activePolicies = agents.filter((agent) => agent.policy.active);
  const onchainPolicies = agents.filter((agent) => agent.policy.txHash);

  return (
    <div className="space-y-5">
      <section className="panel">
        <PageHeader
          kicker="Agent controls"
          title="Wallet policy cockpit"
          description="Set daily spend limits, transaction caps, and autonomous payment controls."
        />
        <PolicyForm />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <PolicyMetric label="Active policies" value={activePolicies.length} />
        <PolicyMetric label="On-chain saves" value={onchainPolicies.length} />
        <PolicyMetric label="Managed agents" value={agents.length} />
      </section>

      <section className="panel">
        <div className="mb-4">
          <p className="text-sm text-slate-400">Policy health</p>
          <h2 className="text-xl font-semibold text-white">Agent controls overview</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-white/[0.08] text-slate-400">
              <tr>
                <th className="py-3">Agent</th>
                <th>Daily</th>
                <th>Tx cap</th>
                <th>Contracts</th>
                <th>Recipients</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b border-white/[0.07]">
                  <td className="py-4">
                    <p className="font-medium text-white">{agent.arcName ?? shortAddress(agent.operatorAddress)}</p>
                    <p className="mt-1 font-mono text-xs text-slate-500">{agent.address ? shortAddress(agent.address) : "Circle pending"}</p>
                  </td>
                  <td>${agent.policy.dailyLimitUsdc}</td>
                  <td>${agent.policy.transactionCapUsdc}</td>
                  <td>{agent.policy.contractAllowlist.length}</td>
                  <td>{agent.policy.recipientAllowlist.length}</td>
                  <td className={agent.policy.txHash ? "text-mint" : "text-orchid"}>{agent.policy.txHash ? "On-chain" : "Saved"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!snapshot.isLoading && agents.length === 0 ? (
            <p className="py-5 text-sm text-slate-400">Create an agent wallet to start enforcing payment policies.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PolicyMetric({label, value}: {label: string; value: number}) {
  return (
    <div className="panel">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
