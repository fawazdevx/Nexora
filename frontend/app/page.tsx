import {useState} from "react";
import {Activity, Bot, CircleDollarSign, Gauge, RadioTower, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {MetricCard} from "@/components/MetricCard";
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
    <div className="space-y-5">
      <section className="panel relative overflow-hidden p-0">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(155,92,246,0.12),transparent_34%)]" />
        <div className="relative grid gap-0 lg:grid-cols-[1fr_340px]">
          <div className="p-5 md:p-7">
            <div className="mb-5 flex flex-wrap gap-2">
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
            <h2 className="mt-3 max-w-4xl text-3xl font-semibold leading-tight text-white md:text-5xl">
              Programmable USDC rails for AI agents and DeFi earning.
            </h2>
            <p className="muted-copy mt-4 max-w-2xl">
              {isConnected ? (
                <>Signed in as <b className="text-white"><ArcNameLabel address={address} fallback={shortAddress(address)} /></b>. Create an agent wallet, route USDC, and keep autonomous actions inside policy.</>
              ) : (
                "Connect your wallet to create an agent wallet, route USDC, and manage autonomous spending policies."
              )}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={createAgentWallet} className="action-button" disabled={!isConnected}>
                <Bot size={16} />
                Create agent wallet
              </button>
              <button onClick={() => navigateTo("/earn")} className="secondary-button"><Sparkles size={16} /> Earn routes</button>
              <button onClick={() => navigateTo("/settings/policies")} className="secondary-button"><ShieldCheck size={16} /> Policies</button>
            </div>
            {status ? <p className="mt-4 break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
            <div className="mt-7 grid max-w-3xl gap-3 sm:grid-cols-3">
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
              <p className="text-sm font-medium text-white">Readiness</p>
              <Activity size={18} className="text-plasma" />
            </div>
            <div className="space-y-3">
              {[
                ["API", snapshot.data?.readiness.apiConfigured ? "Online" : "Offline"],
                ["Contracts", snapshot.data?.readiness.onchainConfigured ? "Configured" : "Env needed"],
                ["Circle", snapshot.data?.readiness.circleConfigured ? "Configured" : "API key needed"],
                ["Wallet", isConnected ? "Connected" : "Connect wallet"]
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
                Circle wallet creation needs the backend to be reachable and configured with production secrets.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {label: "Agent wallets", value: String(snapshot.data?.stats.agentWallets ?? 0), delta: "connected operator"},
          {label: "USDC settled", value: `$${(snapshot.data?.stats.usdcSettled ?? 0).toFixed(2)}`, delta: "x402 volume"},
          {label: "Earn routes", value: String(snapshot.data?.stats.earnRoutes ?? 0), delta: "queued actions"},
          {label: "Policy saves", value: String(snapshot.data?.stats.policySaves ?? 0), delta: "onchain submissions"}
        ].map((stat) => <MetricCard key={stat.label} {...stat} />)}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {title: "Agent wallets", copy: "Create and review Circle-backed agent wallets.", href: "/agents", icon: Bot},
          {title: "Marketplace", copy: "Publish services and test x402 payment flows.", href: "/marketplace", icon: CircleDollarSign},
          {title: "Policy settings", copy: "Set spend caps and allowlists for autonomous actions.", href: "/settings/policies", icon: ShieldCheck}
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.href} onClick={() => navigateTo(item.href)} className="panel text-left transition hover:border-white/[0.16] hover:bg-white/[0.055]">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">
                <Icon size={18} />
              </div>
              <h3 className="text-base font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.copy}</p>
            </button>
          );
        })}
      </section>
    </div>
  );
}
