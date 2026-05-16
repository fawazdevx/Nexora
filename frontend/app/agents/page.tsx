import {useState} from "react";
import {Plus, ShieldCheck} from "lucide-react";
import {useAccount} from "wagmi";
import {apiPost} from "@/lib/api";
import {useArcName} from "@/hooks/useArcName";
import {PageHeader} from "@/components/PageHeader";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function AgentsPage() {
  const {address, isConnected} = useAccount();
  const {arcName} = useArcName(address);
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();

  async function createAgentWallet() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before creating an agent wallet.");
      return;
    }

    setStatus("Creating Circle agent wallet request...");
    try {
      const result = await apiPost<{id: string; circleWalletStatus: string}>("/api/agents", {
        operatorAddress: address,
        arcName,
        dailyLimitUsdc: 400,
        transactionCapUsdc: 45
      });
      await snapshot.refetch();
      setStatus(`Agent wallet ${result.id} created for ${arcName ?? shortAddress(address)}. Status: ${result.circleWalletStatus}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Agent wallet creation failed");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Circle Agent Wallets"
        title="Agent wallet infrastructure"
        description="Provision agent wallets, enforce spend rules, and monitor autonomous payment readiness."
        action={<button onClick={createAgentWallet} className="action-button" disabled={!isConnected}><Plus size={16} /> Create agent wallet</button>}
      />
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {(snapshot.data?.agents ?? []).map((agent) => (
          <article key={agent.id} className="panel relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{agent.arcName ?? agent.address ?? shortAddress(agent.operatorAddress)}</h3>
                <p className="text-sm text-slate-400">{agent.circleWalletStatus}</p>
              </div>
              <ShieldCheck className="text-mint" size={20} />
            </div>
            <div className="grid gap-2 text-sm text-slate-300">
              <div className="surface flex items-center justify-between px-3 py-2"><span>Wallet</span><b className="text-white">{agent.address ? shortAddress(agent.address) : "Circle pending"}</b></div>
              <div className="surface flex items-center justify-between px-3 py-2"><span>Daily limit</span><b className="text-white">${agent.policy.dailyLimitUsdc}</b></div>
              <div className="surface flex items-center justify-between px-3 py-2"><span>Tx cap</span><b className="text-white">${agent.policy.transactionCapUsdc}</b></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[...agent.policy.contractAllowlist, ...agent.policy.recipientAllowlist].map((item) => <span className="status-pill" key={item}>{shortAddress(item)}</span>)}
              {agent.policy.contractAllowlist.length + agent.policy.recipientAllowlist.length === 0 ? <span className="status-pill">No allowlists saved yet</span> : null}
            </div>
          </article>
        ))}
        {!snapshot.isLoading && (snapshot.data?.agents.length ?? 0) === 0 ? (
          <div className="panel lg:col-span-3">
            <p className="text-sm text-slate-300">No agent wallets yet. Connect a wallet and create one to start policy-controlled agent spending.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
