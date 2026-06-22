import {useEffect, useRef, useState} from "react";
import {motion, useScroll, useSpring} from "framer-motion";
import toast from "react-hot-toast";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Braces,
  ChartNoAxesCombined,
  Check,
  CircleDollarSign,
  Code2,
  Copy,
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
import {AgentMesh} from "@/components/AgentMesh";
import {StatMetric} from "@/components/StatMetric";

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

const infra: Array<[string, string, typeof Network]> = [
  ["Primary network", "Arc Testnet", Network],
  ["Settlement asset", "USDC", CircleDollarSign],
  ["Payment protocol", "x402", RadioTower],
  ["Wallet layer", "Circle agent wallets", WalletCards],
  ["SDK package", "@nexorafi/x402", Braces]
];

const navLinks = [
  {id: "platform", label: "Platform"},
  {id: "developers", label: "Developers"},
  {id: "users", label: "Users"},
  {id: "security", label: "Security"}
];

const CODE_SAMPLE = `npm install @nexorafi/x402

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
);`;

export default function LandingPage() {
  const snapshot = usePlatformSnapshot();
  const loading = snapshot.isLoading;
  const stats = snapshot.data?.stats;
  const services = snapshot.data?.services.length ?? 0;
  const agentWallets = stats?.agentWallets ?? 0;
  const settled = stats?.usdcSettled ?? 0;
  const policySaves = stats?.policySaves ?? 0;

  const activeSection = useActiveSection(navLinks.map((link) => link.id));

  // Thin scroll-progress bar pinned under the header.
  const {scrollYProgress} = useScroll();
  const progress = useSpring(scrollYProgress, {stiffness: 120, damping: 30, mass: 0.3});

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06070b] text-slate-100">
      <img
        src="/hero_image.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full object-cover object-center opacity-45"
        loading="eager"
        decoding="async"
      />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(6,7,11,0.86)_0%,rgba(6,7,11,0.58)_48%,rgba(6,7,11,0.84)_100%),linear-gradient(180deg,rgba(12,16,24,0.64),rgba(6,7,11,0.94))]" />
      <div className="aurora pointer-events-none fixed inset-0" />
      <div className="grain pointer-events-none fixed inset-0" />

      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#06070b]/70 px-4 py-4 backdrop-blur-xl md:px-6">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <a href="/" onClick={(event) => navigate(event, "/")} className="flex items-center transition hover:opacity-90">
            <img src="/nexora-wordmark-tight.png" alt="Nexora" className="h-8 w-auto" />
          </a>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-400 lg:flex">
            {navLinks.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={`relative transition hover:text-white ${activeSection === link.id ? "text-white" : ""}`}
              >
                {link.label}
                {activeSection === link.id && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute -bottom-1.5 left-0 right-0 h-0.5 rounded-full bg-gradient-to-r from-plasma to-mint"
                  />
                )}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button hidden min-h-10 px-4 py-2 text-sm sm:inline-flex">
              Docs
            </a>
            <a href="/home" onClick={(event) => navigate(event, "/home")} className="action-button min-h-10 px-4 py-2 text-sm">
              Launch App
              <ArrowRight size={15} />
            </a>
          </div>
        </div>
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-px origin-left bg-gradient-to-r from-plasma via-orchid to-mint"
          style={{scaleX: progress}}
        />
      </header>

      <main className="relative z-10">
        <section className="relative mx-auto grid min-h-[calc(100vh-72px)] max-w-[1440px] items-center gap-12 px-4 py-16 md:px-6 lg:grid-cols-[1fr_440px]">
          <AgentMesh />
          <motion.div className="relative" initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} transition={{duration: 0.55}}>
            <div className="inline-flex items-center gap-2 rounded-full border border-mint/20 bg-mint/10 px-4 py-2 text-sm font-semibold text-mint">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
              </span>
              Built for Arc USDC workflows
            </div>
            <h1 className="mt-7 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight text-white md:text-6xl xl:text-7xl">
              The financial control layer for{" "}
              <span className="bg-gradient-to-r from-orchid via-plasma to-mint bg-clip-text text-transparent">
                AI agents
              </span>{" "}
              on Arc.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300/90">
              Create policy-controlled agent wallets, monetize APIs with x402, manage escrow payments, and route USDC through swap and Save/Earn flows.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/home" onClick={(event) => navigate(event, "/home")} className="action-button px-6">
                Launch App
                <ArrowRight size={17} />
              </a>
              <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button px-6">
                Read Docs
                <FileText size={17} />
              </a>
            </div>

            <div className="mt-10 grid max-w-3xl gap-3 sm:grid-cols-4">
              <StatMetric value={settled} prefix="$" decimals={2} label="Settled volume" loading={loading} accent />
              <StatMetric value={services} label="Published services" loading={loading} />
              <StatMetric value={agentWallets} label="Agent wallets" loading={loading} />
              <StatMetric value={policySaves} label="Policies saved" loading={loading} />
            </div>
          </motion.div>

          <motion.aside
            className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-br from-panel/88 to-panel/72 shadow-neon backdrop-blur-2xl"
            initial={{opacity: 0, y: 20}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.55, delay: 0.1}}
          >
            <div className="border-b border-white/[0.08] bg-black/20 p-4">
              <img
                src="/nexora-banner.png"
                alt="Nexora app preview"
                className="aspect-[16/10] w-full rounded-xl border border-white/[0.08] object-cover"
                loading="eager"
                decoding="async"
              />
            </div>
            <div className="p-6">
              <p className="section-kicker flex items-center gap-2">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_rgba(110,231,183,0.8)]" />
                Live infrastructure
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Agent finance, not another wallet dashboard.</h2>
              <div className="mt-6 grid gap-3">
                {infra.map(([label, value, Icon]) => (
                  <div key={label} className="surface flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Icon size={17} className="text-orchid" />
                      <span className="text-sm text-slate-400">{label}</span>
                    </div>
                    <span className="text-right text-sm font-semibold text-white">{value}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-500">
                Swap and Save/Earn are Arc-only today. Arbitrum Sepolia and Base Sepolia are wired for core Nexora contract flows.
              </p>
            </div>
          </motion.aside>
        </section>

        <Reveal id="platform" className="mx-auto max-w-[1440px] px-4 py-10 md:px-6">
          <div className="mb-8 max-w-3xl">
            <p className="section-kicker">What Nexora does</p>
            <h2 className="page-title">A control plane for agent payments and USDC services.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Feature cell spans two columns on wide screens for a bento rhythm. */}
            <article className="bento-feature flex flex-col justify-between md:col-span-2 md:row-span-2">
              <div>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-mint/20 bg-mint/10 text-mint">
                  <ShieldCheck size={22} />
                </div>
                <h3 className="text-2xl font-semibold text-white">{capabilities[0].title}</h3>
                <p className="mt-3 max-w-xl text-[15px] leading-7 text-slate-300/90">{capabilities[0].copy}</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {["Daily limits", "Transaction caps", "Contract allowlists", "Recipient allowlists"].map((tag) => (
                  <span key={tag} className="status-pill text-mint/90">{tag}</span>
                ))}
              </div>
            </article>
            {capabilities.slice(1).map((item) => {
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
          <CodeWindow />
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
                <div key={item} className="surface flex items-start gap-3 px-4 py-3 text-sm leading-6 text-slate-300">
                  <Check size={16} className="mt-0.5 shrink-0 text-mint" />
                  <span>{item}</span>
                </div>
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
              <a href="/home" onClick={(event) => navigate(event, "/home")} className="action-button">Open Console</a>
              <a href="/docs/api" onClick={(event) => navigate(event, "/docs/api")} className="secondary-button">Read Docs</a>
            </div>
          </div>
        </Reveal>
      </main>
    </div>
  );
}

/** Code block with macOS-style window chrome, light syntax tokens, and a copy button. */
function CodeWindow() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(CODE_SAMPLE);
      setCopied(true);
      toast.success("Copied to clipboard");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#050813] shadow-neon">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Code2 size={14} />
            protect-route.ts
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-plasma/40 hover:text-white"
        >
          {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-6">
        <code>
          <span className="text-slate-500">npm install </span>
          <span className="text-mint">@nexorafi/x402</span>
          {"\n\n"}
          <span className="text-orchid">import</span>
          <span className="text-slate-200"> {"{ nexoraX402 }"} </span>
          <span className="text-orchid">from</span>
          <span className="text-mint"> "@nexorafi/x402"</span>
          <span className="text-slate-200">;</span>
          {"\n\n"}
          <span className="text-slate-200">app.</span>
          <span className="text-cyan">get</span>
          <span className="text-slate-200">(</span>
          <span className="text-mint">"/paid-report"</span>
          <span className="text-slate-200">,</span>
          {"\n  "}
          <span className="text-cyan">nexoraX402</span>
          <span className="text-slate-200">({"{"}</span>
          {"\n    "}
          <span className="text-slate-400">facilitatorUrl</span>
          <span className="text-slate-200">: </span>
          <span className="text-mint">"https://nexorafibackend.vercel.app"</span>
          <span className="text-slate-200">,</span>
          {"\n    "}
          <span className="text-slate-400">payTo</span>
          <span className="text-slate-200">: </span>
          <span className="text-mint">"0xYourPublisherWallet"</span>
          <span className="text-slate-200">,</span>
          {"\n    "}
          <span className="text-slate-400">asset</span>
          <span className="text-slate-200">: </span>
          <span className="text-mint">"0x3600000000000000000000000000000000000000"</span>
          <span className="text-slate-200">,</span>
          {"\n    "}
          <span className="text-slate-400">price</span>
          <span className="text-slate-200">: </span>
          <span className="text-mint">"0.05"</span>
          <span className="text-slate-200">,</span>
          {"\n    "}
          <span className="text-slate-400">network</span>
          <span className="text-slate-200">: </span>
          <span className="text-mint">"arc-testnet"</span>
          {"\n  "}
          <span className="text-slate-200">{"}"}),</span>
          {"\n  "}
          <span className="text-slate-200">(_req, res) </span>
          <span className="text-orchid">{"=>"}</span>
          <span className="text-slate-200"> res.</span>
          <span className="text-cyan">json</span>
          <span className="text-slate-200">({"{ ok: "}</span>
          <span className="text-amber">true</span>
          <span className="text-slate-200">{" })"}</span>
          {"\n"}
          <span className="text-slate-200">);</span>
        </code>
      </pre>
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

/** Tracks which section is in view so the header nav can highlight it. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string>(ids[0] ?? "");
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      {rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1]}
    );

    const elements = idsRef.current
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return active;
}
