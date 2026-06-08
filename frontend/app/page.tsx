import {useState} from "react";
import {Activity, ArrowRight, Bot, BriefcaseBusiness, CircleDollarSign, Code2, Gauge, Landmark, RadioTower, ShieldCheck, Sparkles, Store, WalletCards} from "lucide-react";
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
  const settledVolume = snapshot.data?.stats.usdcSettled ?? 0;
  const policySaves = snapshot.data?.stats.policySaves ?? 0;
  const earnActions = snapshot.data?.stats.earnRoutes ?? 0;

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

  const recommendedAction = nextAction({
    connected: isConnected,
    needsCircle,
    needsContracts,
    agents: agents.length,
    readyAgents,
    policySaves,
    services: services.length
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="panel overflow-hidden p-0">
        <div className="grid gap-0 lg:grid-cols-[1fr_390px]">
          <div className="p-6 md:p-8">
            <div className="mb-6 flex flex-wrap gap-2.5">
              <span className="status-pill border-plasma/25 bg-plasma/10 text-violet-100">
                <Bot size={14} />
                Agent finance
              </span>
              <span className="status-pill border-white/[0.12] bg-white/[0.04] text-slate-200">
                <RadioTower size={14} />
                Arc testnet
              </span>
              <span className="status-pill border-mint/25 bg-mint/10 text-mint">
                <CircleDollarSign size={14} />
                USDC native
              </span>
            </div>
            <p className="section-kicker">Control center</p>
            <h2 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight text-white md:text-5xl">
              Manage agent wallets, paid APIs, escrow, and USDC activity from one place.
            </h2>
            <p className="muted-copy mt-5 max-w-2xl">
              {isConnected ? (
                <>Signed in as <b className="font-semibold text-white"><ArcNameLabel address={address} fallback={shortAddress(address)} /></b>. Review policy status, payment receipts, marketplace services, and treasury-linked activity.</>
              ) : (
                "Connect your wallet to create an agent wallet, publish or buy paid APIs, use escrow, and track USDC activity."
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
            <div className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-4">
              {[
                {label: "Agent wallets", value: `${readyAgents} ready`},
                {label: "Pending wallets", value: String(pendingAgents)},
                {label: "Services", value: String(services.length)},
                {label: "Identity", value: isConnected ? <ArcNameLabel address={address} fallback={shortAddress(address)} /> : ".arc ready"}
              ].map(({label, value}) => (
                <div key={label} className="surface px-4 py-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-2.5 text-[15px] font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-white/[0.1] bg-black/20 p-6 backdrop-blur-sm md:p-8 lg:border-l lg:border-t-0">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm font-bold text-white">System readiness</p>
              <Activity size={19} className="text-plasma" />
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
                  <span className={String(value).includes("Ready") || value === "Online" || value === "Connected" ? "font-bold text-mint" : "font-bold text-white"}>{value}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-plasma/25 bg-plasma/10 p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Gauge size={17} className="text-plasma" />
                Recommended next step
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300/90">{recommendedAction.copy}</p>
              <button className="secondary-button mt-4 min-h-10 px-4 py-2 text-sm" onClick={() => recommendedAction.href ? navigateTo(recommendedAction.href) : undefined} disabled={!recommendedAction.href}>
                {recommendedAction.label}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {label: "Agent wallets", value: String(agents.length), delta: "operator scope"},
          {label: "USDC volume", value: `$${settledVolume.toFixed(2)}`, delta: "settled payments"},
          {label: "Earn actions", value: String(earnActions), delta: "save activity"},
          {label: "Rules saved", value: String(policySaves), delta: "agent controls"}
        ].map((stat) => <MetricCard key={stat.label} {...stat} />)}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {title: "Agent wallets", copy: pendingAgents > 0 ? `${pendingAgents} wallet${pendingAgents === 1 ? "" : "s"} pending activation.` : "Create and review Circle-backed agent wallets.", href: "/agents", icon: WalletCards},
          {title: "Marketplace", copy: services.length > 0 ? `${services.length} service${services.length === 1 ? "" : "s"} available for paid execution.` : "Publish paid APIs or buy a marketplace service.", href: "/marketplace", icon: Store},
          {title: "Escrow", copy: "Create work agreements, fund them in USDC, and release after verification.", href: "/escrow", icon: BriefcaseBusiness},
          {title: "Developer docs", copy: "Integrate the Nexora x402 SDK or test the facilitator playground.", href: "/docs/api", icon: Code2}
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.href} onClick={() => navigateTo(item.href)} className="panel text-left transition-all duration-200 hover:border-white/[0.18]">
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-orchid">
                <Icon size={20} />
              </div>
              <h3 className="text-lg font-bold text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{item.copy}</p>
            </button>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Operational checklist</h3>
            <span className="status-pill border-orchid/30 bg-orchid/10 font-semibold text-orchid">Workspace</span>
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

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          {label: "Treasury", title: "Revenue proof", copy: "Compare app-recorded fees with on-chain treasury balance.", href: "/revenue", icon: Landmark},
          {label: "Policies", title: "Policy center", copy: "Review caps, allowlists, and saved on-chain policy state.", href: "/settings/policies", icon: ShieldCheck},
          {label: "x402", title: "Facilitator playground", copy: "Inspect supported x402 config and test verification payloads.", href: "/x402/playground", icon: RadioTower}
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.href} className="surface p-5 text-left transition hover:border-plasma/30" onClick={() => navigateTo(item.href)}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-orchid">
                <Icon size={15} />
                {item.label}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.copy}</p>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function nextAction(input: {
  connected: boolean;
  needsCircle: boolean;
  needsContracts: boolean;
  agents: number;
  readyAgents: number;
  policySaves: number;
  services: number;
}) {
  if (!input.connected) return {label: "Connect wallet", copy: "Connect your wallet to start using the Nexora workspace.", href: ""};
  if (input.needsCircle) return {label: "View agents", copy: "Agent wallet activation is not available right now. You can still review services and docs.", href: "/agents"};
  if (input.needsContracts) return {label: "View deployments", copy: "Some on-chain features need deployment settings before transactions are available.", href: "/admin/deployments"};
  if (input.agents === 0) return {label: "Create agent", copy: "Create your first agent wallet before setting spending rules or buying paid services.", href: "/agents"};
  if (input.readyAgents === 0) return {label: "Review agents", copy: "Your agent wallet is being prepared. Check agent status before using policy-gated payments.", href: "/agents"};
  if (input.policySaves === 0) return {label: "Save policy", copy: "Set policy limits and allowlists before letting an agent make payments.", href: "/settings/policies"};
  if (input.services === 0) return {label: "Publish service", copy: "Publish your first paid API or browse the marketplace for available services.", href: "/marketplace/new"};
  return {label: "Open marketplace", copy: "Your workspace is ready. Try a paid service, escrow flow, or Save/Earn action.", href: "/marketplace"};
}
