import {useState} from "react";
import {Activity, Bot, CircleDollarSign, Gauge, RadioTower, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {MetricCard} from "@/components/MetricCard";
import {SaveEarnPanel} from "@/components/SaveEarnPanel";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {navigateTo} from "@/lib/router";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function CommandPage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();

  async function createAgentWallet() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet to activate an agent wallet.");
      return;
    }

    setStatus("Creating starter agent wallet...");
    try {
      const result = await apiPost<{id: string; circleWalletStatus: string}>("/api/agents", {
        operatorAddress: address,
        dailyLimitUsdc: 400,
        transactionCapUsdc: 45
      });
      await snapshot.refetch();
      setStatus(`Agent wallet ${result.id} created for ${shortAddress(address)}. Status: ${result.circleWalletStatus}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Agent wallet creation failed");
    }
  }

  return (
    <div className="space-y-6">
      <section className="panel relative overflow-hidden p-0">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(155,92,246,0.12),transparent_34%)]" />
        <div className="relative grid gap-0 lg:grid-cols-[1fr_390px]">
          <div className="p-5 md:p-8">
            <div className="mb-6 flex flex-wrap gap-2">
              <span className="status-pill border-plasma/25 bg-plasma/10 text-violet-100">
                <Bot size={13} />
                Agent commerce
              </span>
              <span className="status-pill border-white/[0.1] bg-white/[0.04] text-slate-200">
                <RadioTower size={13} />
                Arc testnet
              </span>
              <span className="status-pill border-mint/20 bg-mint/10 text-mint">
                <CircleDollarSign size={13} />
                USDC native
              </span>
            </div>
            <p className="section-kicker">Nexora command</p>
            <h2 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight text-white md:text-5xl">
              Programmable USDC rails for AI agents and DeFi earning.
            </h2>
            <p className="muted-copy mt-4 max-w-2xl">
              {isConnected ? (
                <>Signed in as <b className="text-white"><ArcNameLabel address={address} fallback={shortAddress(address)} /></b>. Launch Circle Agent Wallets, price APIs through x402, route idle USDC into earning strategies, and keep every autonomous action inside policy.</>
              ) : (
                "Connect your wallet to resolve your .arc name, launch Circle Agent Wallets, price APIs through x402, route idle USDC into earning strategies, and keep every autonomous action inside policy."
              )}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={() => navigateTo("/earn")} className="action-button"><Sparkles size={16} /> Activate earning route</button>
              <button onClick={() => navigateTo("/settings/policies")} className="secondary-button"><ShieldCheck size={16} /> Review policy mesh</button>
            </div>
            {status ? <p className="mt-4 break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                {label: "x402 rail", value: "Pay per request"},
                {label: "Agent spend", value: "Policy capped"},
                {label: "Identity", value: isConnected ? <ArcNameLabel address={address} fallback={shortAddress(address)} /> : ".arc ready"}
              ].map(({label, value}) => (
                <div key={label} className="surface px-4 py-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-2 text-[15px] font-medium text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/[0.08] bg-black/20 p-5 md:p-7 lg:border-l lg:border-t-0">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-white">Network telemetry</p>
              <Activity size={18} className="text-plasma" />
            </div>
            <div className="space-y-3">
              {[
                ["Settlement rail", "x402 / USDC"],
                ["Gas asset", "USDC"],
                ["Policy state", "Enforced"],
                ["Agent mode", isConnected ? "Wallet connected" : "Connect wallet"]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.045] px-3 py-3 text-sm">
                  <span className="text-slate-400">{label}</span>
                  <span className="font-medium text-white">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-lg border border-plasma/20 bg-plasma/10 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Gauge size={16} className="text-plasma" />
                Deployment readiness
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300/80">
                Proxy addresses can drop straight into the frontend and backend env files after your Foundry deployment.
              </p>
            </div>
            <button onClick={createAgentWallet} className="action-button mt-5 w-full" disabled={!isConnected}>
              <Bot size={16} />
              Create starter agent wallet
            </button>
          </div>
        </div>
      </section>

      <SaveEarnPanel />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {label: "Agent wallets", value: String(snapshot.data?.stats.agentWallets ?? 0), delta: "connected operator"},
          {label: "USDC settled", value: `$${(snapshot.data?.stats.usdcSettled ?? 0).toFixed(2)}`, delta: "x402 volume"},
          {label: "Earn routes", value: String(snapshot.data?.stats.earnRoutes ?? 0), delta: "queued actions"},
          {label: "Policy saves", value: String(snapshot.data?.stats.policySaves ?? 0), delta: "onchain submissions"}
        ].map((stat) => <MetricCard key={stat.label} {...stat} />)}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="panel">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Autonomous agent fleet</h2>
            <span className="status-pill">policy enforced</span>
          </div>
          <div className="space-y-3">
            {(snapshot.data?.agents ?? []).map((agent) => (
              <div key={agent.id} className="surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{agent.arcName ?? agent.address ?? shortAddress(agent.operatorAddress)}</h3>
                    <p className="text-sm text-slate-400">{agent.circleWalletStatus}</p>
                  </div>
                  <span className="status-pill">{agent.policy.active ? "Active" : "Paused"}</span>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <span>Wallet <b className="text-white">{agent.address ? shortAddress(agent.address) : "Pending"}</b></span>
                  <span>Daily <b className="text-white">${agent.policy.dailyLimitUsdc}</b></span>
                  <span>Tx cap <b className="text-white">${agent.policy.transactionCapUsdc}</b></span>
                </div>
              </div>
            ))}
            {!snapshot.isLoading && (snapshot.data?.agents.length ?? 0) === 0 ? <p className="text-sm text-slate-400">No agent wallets created for this operator yet.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Payment stream</h2>
            <span className="status-pill">USDC</span>
          </div>
          <div className="space-y-3">
            {(snapshot.data?.payments ?? []).map((payment) => (
              <div key={payment.id} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.035] p-4">
                <div>
                  <p className="font-medium text-white">{payment.serviceName}</p>
                  <p className="text-xs text-slate-500">{payment.txHash ? shortAddress(payment.txHash) : shortAddress(payment.requestHash)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-white">${payment.amountUsdc}</p>
                  <p className={payment.status === "failed" || payment.status === "policy_blocked" ? "text-xs text-magenta" : "text-xs text-mint"}>{payment.status}</p>
                </div>
              </div>
            ))}
            {!snapshot.isLoading && (snapshot.data?.payments.length ?? 0) === 0 ? <p className="text-sm text-slate-400">No x402 payment activity yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
