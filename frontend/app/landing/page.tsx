import {
  ArrowRight,
  Bot,
  ChartNoAxesCombined,
  CircleDollarSign,
  DatabaseZap,
  FileText,
  Globe2,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Store,
  UserRoundCheck,
  WalletCards
} from "lucide-react";
import {navigateTo} from "@/lib/router";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

const platformFeatures = [
  ["AI Agent Wallets", "Autonomous wallets with granular policies, limits, allowlists, and agent execution rules.", WalletCards],
  ["x402 Payments", "Pay-per-request APIs, agent-to-agent payments, metering, authorization, and USDC settlement.", RadioTower],
  ["One-Click Earn", "Discover stablecoin yield routes, automate workflows, and keep earning actions policy-capped.", ChartNoAxesCombined],
  ["Marketplace", "Publish APIs and agent services with transparent USDC pricing and execution receipts.", Store],
  ["Arc Identity", "Resolve .arc names, operator profiles, ecosystem badges, and trusted participation history.", UserRoundCheck],
  ["Reputation System", "Track settled payments, completed tasks, verified builders, and agent reliability.", Sparkles]
];

const infrastructure = [
  [CircleDollarSign, "USDC", "Stablecoin"],
  [WalletCards, "Agent Wallets", "Autonomous custody"],
  [RadioTower, "x402", "Payment protocol"],
  [Globe2, "Arc Names", ".arc identity"],
  [DatabaseZap, "Arc Network", "Scalable settlement"]
];

export default function LandingPage() {
  const snapshot = useAppSnapshot();
  const stats = [
    [`$${(snapshot.data?.stats.usdcSettled ?? 0).toFixed(2)}`, "USDC settled"],
    [String(snapshot.data?.services.length ?? 0), "Published services"],
    [String(snapshot.data?.stats.agentWallets ?? 0), "Agent wallets"],
    [String(snapshot.data?.reputation.score ?? 0), "Reputation score"]
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05040b]">
      <img
        src="/hero_image.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full object-cover opacity-46"
      />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(5,4,11,0.96)_0%,rgba(5,4,11,0.76)_42%,rgba(5,4,11,0.38)_100%),linear-gradient(180deg,rgba(5,4,11,0.18)_0%,rgba(5,4,11,0.72)_58%,#05040b_100%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:78px_78px] opacity-30" />

      <header className="relative z-10 px-4 py-5 md:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <a href="/" onClick={(event) => navigate(event, "/")} className="flex items-center gap-3">
            <div className="relative h-9 w-9 overflow-hidden rounded-lg bg-gradient-to-br from-plasma via-violet to-cyan p-px">
              <div className="grid h-full w-full place-items-center rounded-lg bg-[#090716] text-lg font-black text-white">N</div>
            </div>
            <span className="text-xl font-semibold uppercase tracking-[0.18em] text-white">Nexora</span>
          </a>

          <nav className="hidden items-center gap-8 text-sm text-slate-300 lg:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#ecosystem" className="transition hover:text-white">Ecosystem</a>
            <a href="#developers" className="transition hover:text-white">Developers</a>
            <a href="#docs" className="transition hover:text-white">Docs</a>
            <a href="#about" className="transition hover:text-white">About</a>
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden rounded-md border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-sm text-slate-200 sm:inline-flex">
              <span className="mr-2 mt-1 h-2 w-2 rounded-full bg-mint" />
              Arc Testnet
            </span>
            <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button">
              Launch App
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex min-h-[calc(100vh-88px)] max-w-[1500px] items-center px-4 pb-16 pt-10 md:px-6">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan">
              AI agent commerce. Programmable earnings. Autonomous payments.
            </p>
            <h1 className="mt-5 max-w-3xl text-6xl font-black leading-none tracking-normal md:text-8xl xl:text-9xl">
              <span className="bg-gradient-to-r from-fuchsia-400 via-plasma to-cyan bg-clip-text text-transparent">Nexora</span>
            </h1>
            <p className="mt-6 max-w-xl text-xl leading-8 text-slate-200">
              The AI-native economy layer on Arc. Empowering agents, builders, and users to earn, pay, and scale autonomously with USDC.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button min-h-12 px-7">
                Launch App
                <ArrowRight size={18} />
              </a>
              <a href="#docs" className="secondary-button min-h-12 px-7">
                Explore Docs
                <FileText size={17} />
              </a>
            </div>

            <div className="mt-8 grid max-w-xl grid-cols-2 gap-3 rounded-lg border border-white/[0.08] bg-white/[0.035] p-3 backdrop-blur-xl sm:grid-cols-4">
              {[
                ["Built on", "Arc"],
                ["Powered by", "Circle"],
                ["Protocol", "x402"],
                ["Asset", "USDC"]
              ].map(([label, value]) => (
                <div key={label} className="border-white/[0.08] px-3 py-2 sm:border-r last:border-r-0">
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <span className="status-pill border-mint/20 bg-mint/10 text-mint">
                <ShieldCheck size={13} />
                Policy guarded
              </span>
              <span className="status-pill border-white/[0.12] bg-black/25 text-slate-200">
                {snapshot.data?.stats.agentWallets ?? 0} agent wallets monitored
              </span>
            </div>
          </div>
        </section>

        <section id="ecosystem" className="mx-auto max-w-[1500px] px-4 py-6 md:px-6">
          <div className="panel p-5">
            <p className="mb-4 text-xs uppercase tracking-[0.18em] text-plasma">Trusted infrastructure</p>
            <div className="grid gap-3 md:grid-cols-5">
              {infrastructure.map(([Icon, title, subtitle]) => {
                const InfraIcon = Icon as typeof CircleDollarSign;
                return (
                  <div key={String(title)} className="surface flex items-center gap-3 p-4">
                    <div className="grid h-11 w-11 place-items-center rounded-full border border-plasma/30 bg-plasma/10 text-plasma">
                      <InfraIcon size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{String(title)}</p>
                      <p className="text-xs text-slate-500">{String(subtitle)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto grid max-w-[1500px] gap-5 px-4 py-10 md:px-6 lg:grid-cols-[1fr_0.9fr_0.65fr]">
          <div className="panel">
            <p className="section-kicker">The Nexora platform</p>
            <h2 className="mt-3 text-3xl font-semibold uppercase text-white">
              Everything agents need to automate, earn, and transact.
            </h2>
            <p className="muted-copy mt-3">A production-focused stack for the autonomous stablecoin economy.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {platformFeatures.map(([title, description, Icon]) => {
                const FeatureIcon = Icon as typeof Bot;
                return (
                  <article key={String(title)} className="surface p-4">
                    <div className="mb-4 grid h-11 w-11 place-items-center rounded-full border border-plasma/30 bg-plasma/10 text-plasma">
                      <FeatureIcon size={19} />
                    </div>
                    <h3 className="text-sm font-semibold uppercase tracking-normal text-white">{String(title)}</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{String(description)}</p>
                    <a href="/app" onClick={(event) => navigate(event, "/app")} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-plasma">
                      Learn more <ArrowRight size={13} />
                    </a>
                  </article>
                );
              })}
            </div>
          </div>

          <div id="developers" className="panel p-0">
            <div className="border-b border-white/[0.08] p-5">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded bg-gradient-to-br from-plasma to-cyan" />
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white">Nexora Console</p>
              </div>
            </div>
            <div className="grid min-h-[430px] grid-cols-[120px_1fr]">
              <aside className="border-r border-white/[0.08] p-4">
                {["Dashboard", "Wallets", "Earn", "Payments", "Agents"].map((item, index) => (
                  <div key={item} className={index === 0 ? "mb-2 rounded-md bg-plasma/15 px-3 py-2 text-xs text-white" : "mb-2 px-3 py-2 text-xs text-slate-500"}>
                    {item}
                  </div>
                ))}
              </aside>
              <div className="p-5">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Overview</p>
                <p className="mt-3 text-3xl font-semibold text-white">{(snapshot.data?.stats.usdcSettled ?? 0).toFixed(2)} <span className="text-sm text-slate-400">USDC</span></p>
                <div className="mt-5 h-28 rounded-lg border border-white/[0.08] bg-[linear-gradient(135deg,rgba(168,85,247,0.16),rgba(6,182,212,0.05))]" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="surface p-4">
                    <p className="text-sm text-slate-400">Active agents</p>
                    <p className="mt-1 text-2xl font-semibold text-white">{snapshot.data?.stats.agentWallets ?? 0}</p>
                    <p className="mt-1 text-xs text-mint">All systems operational</p>
                  </div>
                  <div className="surface p-4">
                    <p className="text-sm text-slate-400">Pending payments</p>
                    <p className="mt-1 text-2xl font-semibold text-white">{snapshot.data?.payments.filter((payment) => payment.status === "authorized").length ?? 0}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {(snapshot.data?.payments.filter((payment) => payment.status === "authorized").reduce((sum, payment) => sum + payment.amountUsdc, 0) ?? 0).toFixed(2)} USDC total
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="about" className="space-y-5">
            <div className="panel">
              <p className="section-kicker">Autonomy. Intelligence. Infrastructure.</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">Powering the agentic economy</h2>
              <p className="muted-copy mt-4">
                Nexora combines AI automation, stablecoin rails, and on-chain infrastructure to create a new economy where agents and humans can collaborate, transact, and grow.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {stats.map(([value, label]) => (
                <div key={label} className="surface p-5">
                  <p className="text-3xl font-semibold text-plasma">{value}</p>
                  <p className="mt-2 text-sm text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="docs" className="mx-auto max-w-[1500px] px-4 py-12 md:px-6">
          <div className="panel flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div>
              <p className="section-kicker">Start with Nexora</p>
              <h2 className="page-title">Create an agent wallet and manage autonomous USDC workflows.</h2>
              <p className="muted-copy mt-3 max-w-2xl">
                Connect your wallet to create agent policies, publish or buy paid APIs, track payments, and save USDC through the Earn flow.
              </p>
            </div>
            <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button min-h-12 px-6">
              Open console
              <ArrowRight size={17} />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
