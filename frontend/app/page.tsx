import {useState} from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CircleDollarSign,
  Clock,
  Code2,
  Gauge,
  Landmark,
  Loader2,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Store,
  WalletCards
} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {StatMetric} from "@/components/StatMetric";
import {navigateTo} from "@/lib/router";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function HomePage() {
  const {address, isConnected} = useAccount();
  const walletReady = Boolean(address);
  const [creating, setCreating] = useState(false);
  const snapshot = useAppSnapshot();
  const loading = snapshot.isLoading;
  const agents = snapshot.data?.agents ?? [];
  const readyAgents = agents.filter((agent) => Boolean(agent.address)).length;
  const pendingAgents = agents.length - readyAgents;
  const services = snapshot.data?.services ?? [];
  const payments = snapshot.data?.payments ?? [];
  const recentPayments = payments.slice(0, 5);
  const needsContracts = snapshot.data ? !snapshot.data.readiness.onchainConfigured : false;
  const needsCircle = snapshot.data ? !snapshot.data.readiness.circleConfigured : false;
  const settledVolume = snapshot.data?.stats.usdcSettled ?? 0;
  const policySaves = snapshot.data?.stats.policySaves ?? 0;
  const earnActions = snapshot.data?.stats.earnRoutes ?? 0;

  async function createAgentWallet() {
    if (!walletReady || !address) {
      toast.error("Connect your wallet to activate an agent wallet.");
      return;
    }

    setCreating(true);
    const toastId = toast.loading("Creating starter agent wallet…");
    try {
      const result = await apiPost<{id: string; circleWalletStatus: string}>("/api/agents", {
        operatorAddress: address,
        dailyLimitUsdc: 400,
        transactionCapUsdc: 45
      });
      await snapshot.refetch();
      toast.success(`Agent wallet ${shortAddress(result.id)} created · ${result.circleWalletStatus}`, {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent wallet creation failed", {id: toastId});
    } finally {
      setCreating(false);
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

  const readiness = [
    {label: "API", tone: toneFor(snapshot.data?.readiness.apiConfigured, "Online", "Offline")},
    {label: "Contracts", tone: toneFor(snapshot.data?.readiness.onchainConfigured, "Ready", "Setup needed")},
    {label: "Circle", tone: toneFor(snapshot.data?.readiness.circleConfigured, "Ready", "Setup needed")},
    {label: "Wallet", tone: toneFor(isConnected, "Connected", "Connect wallet")}
  ];

  const mainAreas = [
    {title: "Agent wallets", copy: pendingAgents > 0 ? `${pendingAgents} pending wallet${pendingAgents === 1 ? "" : "s"} need review.` : "Create and manage policy-controlled agent wallets.", href: "/agents", icon: WalletCards},
    {title: "Marketplace", copy: services.length > 0 ? `${services.length} paid service${services.length === 1 ? "" : "s"} available.` : "Publish or buy x402 paid APIs.", href: "/marketplace", icon: Store},
    {title: "Escrow", copy: "Fund work agreements in USDC and release after verification.", href: "/escrow", icon: BriefcaseBusiness},
    {title: "Revenue", copy: "Compare on-chain treasury balance with app-recorded fees and volume.", href: "/revenue", icon: Landmark},
    {title: "Developer docs", copy: "Install the SDK or test the x402 playground.", href: "/docs/api", icon: Code2}
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="panel relative overflow-hidden p-0">
        <div className="aurora pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative grid gap-0 lg:grid-cols-[1fr_390px]">
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
              <button onClick={createAgentWallet} className="action-button" disabled={!walletReady || creating}>
                {creating ? <Loader2 size={17} className="animate-spin" /> : <Bot size={17} />}
                {creating ? "Creating wallet…" : walletReady ? "Create agent wallet" : "Connect wallet first"}
              </button>
              <button onClick={() => navigateTo("/earn")} className="secondary-button"><Sparkles size={17} /> Save and earn</button>
              <button onClick={() => navigateTo("/settings/policies")} className="secondary-button"><ShieldCheck size={17} /> Spending rules</button>
            </div>
            <div className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-4">
              <StatMetric variant="panel" label="Agent wallets" value={readyAgents} suffix={`/${agents.length}`} loading={loading} icon={WalletCards} />
              <StatMetric variant="panel" label="USDC volume" value={settledVolume} prefix="$" decimals={2} loading={loading} icon={CircleDollarSign} accent />
              <StatMetric variant="panel" label="Policies" value={policySaves} loading={loading} icon={ShieldCheck} />
              <StatMetric variant="panel" label="Services" value={services.length} loading={loading} icon={Store} />
            </div>
          </div>
          <div className="relative border-t border-white/[0.1] bg-black/20 p-6 backdrop-blur-sm md:p-8 lg:border-l lg:border-t-0">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm font-bold text-white">System readiness</p>
              <Activity size={19} className="text-plasma" />
            </div>
            <div className="space-y-2.5">
              {readiness.map(({label, tone}) => (
                <div key={label} className="flex items-center justify-between rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] px-4 py-3.5 text-sm backdrop-blur-sm transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.08]">
                  <span className="font-medium text-slate-400">{label}</span>
                  <span className={`flex items-center gap-2 font-bold ${tone.text}`}>
                    <StatusDot tone={tone.kind} />
                    {tone.value}
                  </span>
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

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Workspace</p>
            <h3 className="mt-2 text-xl font-bold text-white">Main areas</h3>
          </div>
          <span className="text-sm font-semibold text-slate-500">{earnActions} Save/Earn actions</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {mainAreas.map((item) => {
            const Icon = item.icon;
            const highlighted = item.href === recommendedAction.href;
            return (
              <button
                key={item.href}
                onClick={() => navigateTo(item.href)}
                className={`${highlighted ? "bento-feature md:col-span-2" : "panel"} group flex w-full items-start justify-between gap-4 text-left`}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-200 ${highlighted ? "border-mint/25 bg-mint/10 text-mint" : "border-white/[0.1] bg-white/[0.04] text-orchid group-hover:text-white"}`}>
                    <Icon size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-white">{item.title}</p>
                      {highlighted ? <span className="rounded-full border border-mint/25 bg-mint/10 px-2 py-0.5 text-[11px] font-semibold text-mint">Suggested</span> : null}
                    </div>
                    <p className="mt-1 text-sm leading-5 text-slate-400">{item.copy}</p>
                  </div>
                </div>
                <ArrowRight size={16} className="mt-1 shrink-0 text-slate-600 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-orchid" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-white">Recent activity</h3>
            <button onClick={() => navigateTo("/payments")} className="secondary-button min-h-10 px-4 py-2 text-sm">Payments</button>
          </div>
          {recentPayments.length > 0 ? (
            <ol className="relative ml-1.5 border-l border-white/[0.1]">
              {recentPayments.map((payment) => {
                const tone = statusTone(payment.status);
                return (
                  <li key={payment.id} className="relative mb-4 pl-6 last:mb-0">
                    <span className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 border-[#12101b] ${tone.dot}`} />
                    <div className="surface flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{payment.serviceName}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock size={12} />
                          {timeAgo(payment.createdAt)}
                          <span className="text-slate-700">·</span>
                          {shortAddress(payment.txHash ?? payment.requestHash)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-white">${payment.amountUsdc}</span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${tone.pill}`}>{payment.status}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="surface p-5 text-sm font-medium text-slate-400">No payment activity yet. Publish or buy a marketplace service to create the first receipt.</p>
          )}
        </div>

        <div className="panel">
          <h3 className="text-lg font-bold text-white">Quick actions</h3>
          <p className="mt-1 text-sm text-slate-500">Jump straight into the most-used operator tools.</p>
          <div className="mt-5 grid gap-3">
            <button onClick={() => navigateTo("/settings/policies")} className="surface flex items-center justify-between px-4 py-3.5 text-left text-sm font-semibold text-white transition hover:border-plasma/30">
              <span className="flex items-center gap-2.5"><ShieldCheck size={16} className="text-orchid" /> Policy center</span>
              <ArrowRight size={15} className="text-slate-600" />
            </button>
            <button onClick={() => navigateTo("/x402/playground")} className="surface flex items-center justify-between px-4 py-3.5 text-left text-sm font-semibold text-white transition hover:border-plasma/30">
              <span className="flex items-center gap-2.5"><RadioTower size={16} className="text-orchid" /> x402 playground</span>
              <ArrowRight size={15} className="text-slate-600" />
            </button>
            <button onClick={() => navigateTo("/marketplace/new")} className="surface flex items-center justify-between px-4 py-3.5 text-left text-sm font-semibold text-white transition hover:border-plasma/30">
              <span className="flex items-center gap-2.5"><Store size={16} className="text-orchid" /> Publish a service</span>
              <ArrowRight size={15} className="text-slate-600" />
            </button>
            <button onClick={() => navigateTo("/earn")} className="surface flex items-center justify-between px-4 py-3.5 text-left text-sm font-semibold text-white transition hover:border-plasma/30">
              <span className="flex items-center gap-2.5"><Sparkles size={16} className="text-mint" /> Save / Earn</span>
              <ArrowRight size={15} className="text-slate-600" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

type Tone = {kind: "good" | "warn" | "bad"; value: string; text: string};

function toneFor(ready: boolean | undefined, onValue: string, offValue: string): Tone {
  if (ready) return {kind: "good", value: onValue, text: "text-mint"};
  return {kind: "warn", value: offValue, text: "text-amber"};
}

function StatusDot({tone}: {tone: "good" | "warn" | "bad"}) {
  const color = tone === "good" ? "bg-mint" : tone === "warn" ? "bg-amber" : "bg-magenta";
  return (
    <span className="relative flex h-2 w-2">
      {tone === "good" ? <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-75`} /> : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (["settled", "success", "released", "completed", "verified", "paid", "active"].some((k) => s.includes(k))) {
    return {dot: "bg-mint", pill: "border-mint/25 bg-mint/10 text-mint"};
  }
  if (["pending", "processing", "submitted", "funded", "await"].some((k) => s.includes(k))) {
    return {dot: "bg-amber", pill: "border-amber/25 bg-amber/10 text-amber"};
  }
  if (["failed", "rejected", "cancel", "error", "denied"].some((k) => s.includes(k))) {
    return {dot: "bg-magenta", pill: "border-magenta/25 bg-magenta/10 text-magenta"};
  }
  return {dot: "bg-slate-500", pill: "border-white/[0.12] bg-white/[0.04] text-slate-300"};
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
