import {useState} from "react";
import {RefreshCw, Plus, ShieldCheck, Settings} from "lucide-react";
import {useAccount} from "wagmi";
import {apiDelete, apiPost} from "@/lib/api";
import {useArcName} from "@/hooks/useArcName";
import {PageHeader} from "@/components/PageHeader";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {navigateTo} from "@/lib/router";

export default function AgentsPage() {
  const {address, isConnected} = useAccount();
  const walletReady = Boolean(address);
  const {arcName} = useArcName(address);
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();
  const existingReadyWallet = (snapshot.data?.agents ?? []).find((agent) => agent.operatorAddress.toLowerCase() === address?.toLowerCase() && agent.address);

  async function createAgentWallet() {
    if (!walletReady || !address) {
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

  async function hideAgent(agentId: string) {
    if (!address) {
      setStatus("Connect the operator wallet before hiding an agent.");
      return;
    }
    if (!window.confirm("Hide this agent wallet from the Nexora UI? This only archives the local record and does not delete the Circle wallet or on-chain history.")) return;
    setStatus("Hiding agent wallet from Nexora UI...");
    try {
      await apiDelete(`/api/agents/${encodeURIComponent(agentId)}`, {operatorAddress: address});
      await snapshot.refetch();
      setStatus("Agent wallet hidden from the UI.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Agent wallet could not be hidden");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Circle Agent Wallets"
        title="Agent wallet infrastructure"
        description="Provision agent wallets, enforce spend rules, and monitor autonomous payment readiness."
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void snapshot.refetch()} className="secondary-button"><RefreshCw size={16} /> Refresh</button>
            <button onClick={createAgentWallet} className="action-button" disabled={!walletReady || Boolean(existingReadyWallet)}>
              <Plus size={16} />
              {existingReadyWallet ? "Wallet already active" : walletReady ? "Create agent wallet" : "Connect wallet first"}
            </button>
          </div>
        }
      />
      <p className="rounded-md border border-white/[0.08] bg-white/[0.035] p-3 text-sm leading-6 text-slate-300">
        Agent wallets may take a short moment to become ready. Nexora will keep checking for the wallet address automatically.
      </p>
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {(snapshot.data?.agents ?? []).map((agent) => (
          <article key={agent.id} className="panel relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{agent.arcName ?? agent.address ?? shortAddress(agent.operatorAddress)}</h3>
                <p className="text-sm text-slate-400">
                  {agent.circleWalletStatus === "ready"
                    ? "Circle wallet ready"
                    : agent.circleWalletStatus === "circle_wallet_pending_address"
                      ? "Circle accepted the request; address pending"
                      : agent.circleWalletStatus}
                </p>
              </div>
              <ShieldCheck className="text-mint" size={20} />
            </div>
            <div className="grid gap-2 text-sm text-slate-300">
              <div className="surface flex items-center justify-between px-3 py-2"><span>Wallet</span><b className="text-white">{agent.address ? shortAddress(agent.address) : "Circle pending"}</b></div>
              <div className="surface flex items-center justify-between px-3 py-2"><span>Circle ID</span><b className="text-white">{agent.circleWalletId ? shortAddress(agent.circleWalletId) : "pending"}</b></div>
              <div className="surface flex items-center justify-between px-3 py-2"><span>Daily limit</span><b className="text-white">${agent.policy.dailyLimitUsdc}</b></div>
              <div className="surface flex items-center justify-between px-3 py-2"><span>Tx cap</span><b className="text-white">${agent.policy.transactionCapUsdc}</b></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[...agent.policy.contractAllowlist, ...agent.policy.recipientAllowlist].map((item) => <span className="status-pill" key={item}>{shortAddress(item)}</span>)}
              {agent.policy.contractAllowlist.length + agent.policy.recipientAllowlist.length === 0 ? <span className="status-pill">No allowlists saved yet</span> : null}
            </div>
            <button type="button" onClick={() => navigateTo("/settings/policies")} className="secondary-button mt-4 w-full justify-center">
              <Settings size={15} />
              Manage policy
            </button>
            <button type="button" onClick={() => void hideAgent(agent.id)} className="secondary-button mt-3 w-full justify-center">
              Hide test wallet
            </button>
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
