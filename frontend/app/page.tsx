import {useState} from "react";
import {Activity, Bot, CircleDollarSign, Gauge, RadioTower, ShieldCheck, Sparkles, Store, WalletCards} from "lucide-react";
import {useAccount} from "wagmi";
import {MetricCard} from "@/components/MetricCard";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {navigateTo} from "@/lib/router";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function HomePage() {
  const {address, isConnected} = useAccount();
  const walletReady = Boolean(address);
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const readyAgents = agents.filter((agent) => Boolean(agent.address)).length;
  const pendingAgents = agents.length - readyAgents;
  const services = snapshot.data?.services ?? [];
  const payments = snapshot.data?.payments ?? [];
  const latestPayment = payments[0];
  const needsContracts = snapshot.data ? !snapshot.data.readiness.onchainConfigured : false;
  const needsCircle = snapshot.data ? !snapshot.data.readiness.circleConfigured : false;

  async function createAgentWallet() {
    if (!walletReady || !address) {
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
    <div className="space-y-6 animate-fade-in">
      <section className="panel group relative overflow-hidden p-0 transition-all duration-500 hover:shadow-[0_24px_72px_rgba(0,0,0,0.4)]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(155,92,246,0.16),transparent_40%)]" />
        <div className="absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-plasma/[0.08] blur-[120px] transition-all duration-700 group-hover:bg-plasma/[0.14]" />
        <div className="relative grid gap-0 lg:grid-cols-[1fr_360px]">
          <div className="p-6 md:p-8">
            <div className="mb-6 flex flex-wrap gap-2.5">
              <span className="status-pill border-plasma/30 bg-gradient-to-br from-plasma/15 to-plasma/10 text-violet-100 shadow-[0_0_20px_rgba(155,92,246,0.2)]">
                <Bot size={14} />
                Agent commerce
              </span>
              <span className="status-pill border-white/[0.12] bg-gradient-to-br from-white/[0.06] to-white/[0.03] text-slate-200">
                <RadioTower size={14} />
                Arc testnet
              </span>
              <span className="status-pill border-mint/25 bg-gradient-to-br from-mint/15 to-mint/10 text-mint shadow-[0_0_16px_rgba(110,231,183,0.2)]">
                <CircleDollarSign size={14} />
                USDC native
              </span>
            </div>
            <p className="section-kicker">Nexora home</p>
            <h2 className="mt-4 max-w-4xl bg-gradient-to-br from-white via-white to-slate-300 bg-clip-text text-3xl font-bold leading-tight text-transparent md:text-5xl">
              Start with an agent wallet, then control what it can spend.
            </h2>
            <p className="muted-copy mt-5 max-w-2xl">
              {isConnected ? (
                <>Signed in as <b className="bg-gradient-to-r from-white to-slate-200 bg-clip-text font-bold text-transparent"><ArcNameLabel address={address} fallback={shortAddress(address)} /></b>. Create or review your agent wallet, set spending rules, and use Earn, Market, and Payments from one place.</>
              ) : (
                "Connect your wallet to create an agent wallet, save USDC, publish paid APIs, and track payments."
              )}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button onClick={createAgentWallet} className="action-button" disabled={!walletReady}>
                <Bot size={17} />
                {walletReady ? "Create agent wallet" : "Connect wallet first"}
              </button>
              <button onClick={() => navigateTo("/earn")} className="secondary-button"><Sparkles size={17} /> Save and earn</button>
              <button onClick={() => navigateTo("/settings/policies")} className="secondary-button"><ShieldCheck size={17} /> Spending rules</button>
            </div>
            {status ? <p className="mt-5 break-all rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.08] to-white/[0.04] p-4 text-sm font-medium text-slate-300 shadow-inner backdrop-blur-sm">{status}</p> : null}
            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
              {[
                {label: "Agent wallets", value: `${readyAgents} ready / ${pendingAgents} pending`},
                {label: "Market services", value: String(services.length)},
                {label: "Identity", value: isConnected ? <ArcNameLabel address={address} fallback={shortAddress(address)} /> : ".arc ready"}
              ].map(({label, value}) => (
                <div key={label} className="surface px-4 py-3.5 transition-all duration-200 hover:scale-[1.02]">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-2.5 text-[15px] font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/[0.1] bg-gradient-to-br from-black/30 to-black/20 p-6 backdrop-blur-sm md:p-8 lg:border-l lg:border-t-0">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm font-bold text-white">Readiness</p>
              <Activity size={19} className="text-plasma glow-text" />
            </div>
            <div className="space-y-2.5">
              {[
                ["API", snapshot.data?.readiness.apiConfigured ? "Online" : "Offline"],
                ["Contracts", snapshot.data?.readiness.onchainConfigured ? "Ready" : "Setup needed"],
                ["Circle", snapshot.data?.readiness.circleConfigured ? "Ready" : "Setup needed"],
                ["Wallet", isConnected ? "Connected" : "Connect wallet"]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] px-4 py-3.5 text-sm backdrop-blur-sm transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08]">
                  <span className="font-medium text-slate-400">{label}</span>
                  <span className="font-bold text-white">{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-plasma/30 bg-gradient-to-br from-plasma/15 to-plasma/5 p-5 shadow-[0_0_24px_rgba(155,92,246,0.15)]">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Gauge size={17} className="text-plasma glow-text" />
                Next step
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300/90">
                {needsCircle
                  ? "Agent wallet creation needs Circle credentials before it can return a wallet address."
                  : needsContracts
                    ? "Some on-chain features still need contract addresses before they can submit transactions."
                    : agents.length === 0
                      ? "Create your first agent wallet to begin."
                      : "Set spending rules, then try Save/Earn or Market payments."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {label: "Agent wallets", value: String(snapshot.data?.stats.agentWallets ?? 0), delta: "connected operator"},
          {label: "USDC settled", value: `$${(snapshot.data?.stats.usdcSettled ?? 0).toFixed(2)}`, delta: "x402 volume"},
          {label: "Earn actions", value: String(snapshot.data?.stats.earnRoutes ?? 0), delta: "save activity"},
          {label: "Rules saved", value: String(snapshot.data?.stats.policySaves ?? 0), delta: "agent controls"}
        ].map((stat) => <MetricCard key={stat.label} {...stat} />)}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {title: "Agent wallets", copy: pendingAgents > 0 ? `${pendingAgents} waiting for Circle wallet address.` : "Create and review Circle-backed agent wallets.", href: "/agents", icon: WalletCards},
          {title: "Market", copy: services.length > 0 ? `${services.length} service${services.length === 1 ? "" : "s"} available.` : "Publish paid APIs or run a marketplace purchase.", href: "/marketplace", icon: Store},
          {title: "Spending rules", copy: agents.length > 0 ? "Set limits and approved destinations for your agent." : "Create an agent before saving rules.", href: "/settings/policies", icon: ShieldCheck}
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.href} onClick={() => navigateTo(item.href)} className="group panel relative overflow-hidden text-left transition-all duration-300 hover:scale-[1.02] hover:border-white/[0.18] hover:shadow-[0_16px_48px_rgba(0,0,0,0.3)]">
              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-orchid/[0.06] blur-2xl transition-all duration-500 group-hover:bg-orchid/[0.12]" />
              <div className="relative mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.12] bg-gradient-to-br from-white/[0.08] to-white/[0.04] text-orchid shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:border-orchid/40 group-hover:shadow-[0_0_24px_rgba(192,132,252,0.3)]">
                <Icon size={20} />
              </div>
              <h3 className="relative text-lg font-bold text-white">{item.title}</h3>
              <p className="relative mt-3 text-sm leading-6 text-slate-400">{item.copy}</p>
            </button>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Getting started</h3>
            <span className="status-pill border-orchid/30 bg-gradient-to-br from-orchid/15 to-orchid/10 font-semibold text-orchid">Setup</span>
          </div>
          <div className="grid gap-2.5">
            {[
              ["Connect wallet", isConnected],
              ["Create agent", agents.length > 0],
              ["Circle wallet address", readyAgents > 0],
              ["Save spending rules", agents.some((agent) => agent.policy.contractAllowlist.length + agent.policy.recipientAllowlist.length > 0 || agent.policy.txHash)],
              ["Publish or buy a service", services.length > 0]
            ].map(([label, complete]) => (
              <div key={String(label)} className="surface flex items-center justify-between px-4 py-3.5 text-sm transition-all duration-200 hover:scale-[1.01]">
                <span className="font-medium text-slate-300">{String(label)}</span>
                <span className={complete ? "font-bold text-mint drop-shadow-[0_0_8px_rgba(110,231,183,0.4)]" : "font-semibold text-slate-500"}>{complete ? "Done" : "Next"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Recent activity</h3>
            <button onClick={() => navigateTo("/payments")} className="secondary-button min-h-10 px-4 py-2 text-sm">Payments</button>
          </div>
          {latestPayment ? (
            <div className="surface p-5 transition-all duration-200 hover:scale-[1.01]">
              <p className="font-bold text-white">{latestPayment.serviceName}</p>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <span className="font-medium text-slate-400">Amount <b className="font-bold text-white">${latestPayment.amountUsdc}</b></span>
                <span className="font-medium text-slate-400">Status <b className="font-bold text-white">{latestPayment.status}</b></span>
                <span className="font-medium text-slate-400">Request <b className="font-bold text-white">{shortAddress(latestPayment.txHash ?? latestPayment.requestHash)}</b></span>
              </div>
            </div>
          ) : (
            <p className="surface p-5 text-sm font-medium text-slate-400">No payment activity yet. Publish or buy a marketplace service to create the first receipt.</p>
          )}
        </div>
      </section>
    </div>
  );
}
