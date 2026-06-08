import {motion} from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Braces,
  ChartNoAxesCombined,
  CircleDollarSign,
  Code2,
  FileText,
  Landmark,
  LockKeyhole,
  Network,
  RadioTower,
  ShieldCheck,
  Store,
  WalletCards
} from "lucide-react";
import {navigateTo} from "@/lib/router";
import {usePlatformSnapshot} from "@/hooks/useAppSnapshot";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

const reveal = {
  hidden: {opacity: 0, y: 18},
  visible: {opacity: 1, y: 0}
};

function Reveal({children, className = "", id}: {children: React.ReactNode; className?: string; id?: string}) {
  return (
    <motion.section
      id={id}
      className={className}
      variants={reveal}
      initial="hidden"
      whileInView="visible"
      viewport={{once: true, margin: "-80px"}}
      transition={{duration: 0.5, ease: [0.22, 1, 0.36, 1]}}
    >
      {children}
    </motion.section>
  );
}

const capabilities = [
  {
    title: "Agent wallet policies",
    copy: "Create agent wallets, set daily limits, transaction caps, contract allowlists, and recipient allowlists before agents spend.",
    icon: ShieldCheck
  },
  {
    title: "x402 API payments",
    copy: "Publish paid APIs, protect endpoints with the Nexora SDK, and settle per-request USDC payments through the facilitator.",
    icon: RadioTower
  },
  {
    title: "Escrow for work",
    copy: "Hold USDC for service work, track deliverables, verify completion, and route platform fees to treasury.",
    icon: LockKeyhole
  },
  {
    title: "Arc Swap + Save/Earn",
    copy: "Compare Arc liquidity routes and route USDC into Save/Earn opportunities. These flows currently run on Arc only.",
    icon: ChartNoAxesCombined
  }
];

const userSteps = [
  "Connect wallet",
  "Create agent wallet",
  "Save spending policy",
  "Pay for services, use escrow, swap, or Save/Earn"
];

const infra = [
  ["Primary network", "Arc Testnet", Network],
  ["Settlement asset", "USDC", CircleDollarSign],
  ["Payment protocol", "x402", RadioTower],
  ["Wallet layer", "Circle agent wallets", WalletCards],
  ["SDK package", "@nexorafi/x402", Braces]
];

export default function LandingPage() {
  const snapshot = usePlatformSnapshot();
  const stats = snapshot.data?.stats;
  const services = snapshot.data?.services.length ?? 0;
  const agentWallets = stats?.agentWallets ?? 0;
  const settled = stats?.usdcSettled ?? 0;
  const policySaves = stats?.policySaves ?? 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06070b] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(12,16,24,0.92),rgba(6,7,11,0.96)),radial-gradient(circle_at_78%_12%,rgba(125,211,252,0.16),transparent_28rem),radial-gradient(circle_at_18%_22%,rgba(155,92,246,0.18),transparent_30rem)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.024)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.024)_1px,transparent_1px)] bg-[size:88px_88px] opacity-35" />

      <header className="relative z-10 border-b border-white/[0.08] bg-[#06070b]/70 px-4 py-4 backdrop-blur-xl md:px-6">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <a href="/" onClick={(event) => navigate(event, "/")} className="flex items-center transition hover:opacity-90">
            <img src="/nexora-wordmark-tight.png" alt="Nexora" className="h-8 w-auto" />
          </a>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-400 lg:flex">
            <a href="#platform" className="hover:text-white">Platform</a>
            <a href="#developers" className="hover:text-white">Developers</a>
            <a href="#users" className="hover:text-white">Users</a>
            <a href="#security" className="hover:text-white">Security</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button hidden min-h-10 px-4 py-2 text-sm sm:inline-flex">
              Docs
            </a>
            <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button min-h-10 px-4 py-2 text-sm">
              Launch App
              <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid min-h-[calc(100vh-72px)] max-w-[1440px] items-center gap-12 px-4 py-16 md:px-6 lg:grid-cols-[1fr_440px]">
          <motion.div initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} transition={{duration: 0.55}}>
            <div className="inline-flex items-center gap-2 rounded-full border border-mint/20 bg-mint/10 px-4 py-2 text-sm font-semibold text-mint">
              <BadgeCheck size={15} />
              Built for Arc USDC workflows
            </div>
            <h1 className="mt-7 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-normal text-white md:text-7xl xl:text-8xl">
              Nexora
            </h1>
            <p className="mt-6 max-w-3xl text-2xl font-medium leading-9 text-slate-200 md:text-3xl">
              The financial control layer for AI agents on Arc.
            </p>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-400">
              Create policy-controlled agent wallets, monetize APIs with x402, manage escrow payments, and route USDC through swap and Save/Earn flows.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button px-6">
                Launch App
                <ArrowRight size={17} />
              </a>
              <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button px-6">
                Read Docs
                <FileText size={17} />
              </a>
              <a href="/builders" onClick={(event) => navigate(event, "/builders")} className="secondary-button px-6">
                Builder Directory
              </a>
            </div>

            <div className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-4">
              <Metric value={`$${settled.toFixed(2)}`} label="Settled volume" />
              <Metric value={String(services)} label="Published services" />
              <Metric value={String(agentWallets)} label="Agent wallets" />
              <Metric value={String(policySaves)} label="Policies saved" />
            </div>
          </motion.div>

          <motion.aside
            className="panel"
            initial={{opacity: 0, y: 20}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.55, delay: 0.1}}
          >
            <p className="section-kicker">Live infrastructure</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Agent finance, not another wallet dashboard.</h2>
            <div className="mt-6 grid gap-3">
              {infra.map(([label, value, Icon]) => {
                const ItemIcon = Icon as typeof Network;
                return (
                  <div key={label as string} className="surface flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ItemIcon size={17} className="text-orchid" />
                      <span className="text-sm text-slate-400">{label as string}</span>
                    </div>
                    <span className="text-right text-sm font-semibold text-white">{value as string}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-500">
              Swap and Save/Earn are Arc-only today. Arbitrum Sepolia and Base Sepolia are wired for core Nexora contract flows.
            </p>
          </motion.aside>
        </section>

        <Reveal id="platform" className="mx-auto max-w-[1440px] px-4 py-10 md:px-6">
          <div className="mb-8 max-w-3xl">
            <p className="section-kicker">What Nexora does</p>
            <h2 className="page-title">A control plane for agent payments and USDC services.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="panel">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">
                    <Icon size={20} />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{item.copy}</p>
                </article>
              );
            })}
          </div>
        </Reveal>

        <Reveal id="developers" className="mx-auto grid max-w-[1440px] gap-5 px-4 py-10 md:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="panel">
            <p className="section-kicker">For developers</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">Monetize API routes with x402.</h2>
            <p className="muted-copy mt-4">
              Use the Nexora SDK to return payment requirements, verify signed payment headers, settle USDC payments, and serve paid responses.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="action-button">SDK Docs</a>
              <a href="/x402/playground" onClick={(event) => navigate(event, "/x402/playground")} className="secondary-button">x402 Playground</a>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#050813]">
            <div className="flex items-center gap-2 border-b border-white/[0.08] px-5 py-3 text-sm text-slate-400">
              <Code2 size={16} />
              Install and protect a route
            </div>
            <pre className="overflow-x-auto p-5 text-[13px] leading-6 text-slate-200"><code>{`npm install @nexorafi/x402

import { nexoraX402 } from "@nexorafi/x402";

app.get("/paid-report",
  nexoraX402({
    facilitatorUrl: "https://nexorafibackend.vercel.app",
    payTo: "0xYourPublisherWallet",
    asset: "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet"
  }),
  (_req, res) => res.json({ ok: true })
);`}</code></pre>
          </div>
        </Reveal>

        <Reveal id="users" className="mx-auto grid max-w-[1440px] gap-5 px-4 py-10 md:px-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="panel">
            <p className="section-kicker">For users</p>
            <h2 className="mt-3 text-3xl font-semibold text-white">A safer way to let agents spend USDC.</h2>
            <div className="mt-6 grid gap-3">
              {userSteps.map((step, index) => (
                <div key={step} className="surface flex items-center gap-4 px-4 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-mint/25 bg-mint/10 text-sm font-semibold text-mint">{index + 1}</span>
                  <span className="font-medium text-white">{step}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <p className="section-kicker">Public surfaces</p>
            <div className="mt-5 grid gap-3">
              <SurfaceLink href="/marketplace" icon={<Store size={18} />} title="Marketplace" copy="Discover and buy paid APIs." />
              <SurfaceLink href="/builders" icon={<Bot size={18} />} title="Builder directory" copy="View builders and published services." />
              <SurfaceLink href="/revenue" icon={<Landmark size={18} />} title="Revenue proof" copy="Separate treasury fees from gross volume." />
            </div>
          </div>
        </Reveal>

        <Reveal id="security" className="mx-auto max-w-[1440px] px-4 py-10 md:px-6">
          <div className="panel grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="section-kicker">Security and limits</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">Built for explicit controls before mainnet.</h2>
              <p className="muted-copy mt-4">
                Nexora keeps policy limits, fee routing, and network support visible so users can understand what is live and what is still testnet-only.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {[
                "Arc Testnet is the primary deployment.",
                "Swap and Save/Earn currently work only on Arc.",
                "Treasury wallet balance is the source of truth for collected USDC.",
                "Contracts are upgradeable; app env should use proxy addresses.",
                "Agent policies use caps and allowlists before autonomous spending.",
                "x402 SDK payments include signature and replay checks."
              ].map((item) => (
                <div key={item} className="surface px-4 py-3 text-sm leading-6 text-slate-300">{item}</div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal className="mx-auto max-w-[1440px] px-4 py-14 md:px-6">
          <div className="panel flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div>
              <p className="section-kicker">Build with Nexora</p>
              <h2 className="page-title">Start with an agent wallet or integrate the x402 SDK.</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="/app" onClick={(event) => navigate(event, "/app")} className="action-button">Open Console</a>
              <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button">Read Docs</a>
            </div>
          </div>
        </Reveal>
      </main>
    </div>
  );
}

function Metric({value, label}: {value: string; label: string}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 backdrop-blur-sm">
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function SurfaceLink({href, icon, title, copy}: {href: string; icon: React.ReactNode; title: string; copy: string}) {
  return (
    <a href={href} onClick={(event) => navigate(event, href)} className="surface flex items-center gap-4 px-4 py-3 transition hover:border-plasma/30">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">
        {icon}
      </div>
      <div>
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-slate-400">{copy}</p>
      </div>
    </a>
  );
}
