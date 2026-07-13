import {useEffect, useState} from "react";
import {motion, useReducedMotion} from "framer-motion";
import {Activity, Clock, ExternalLink, Github, RefreshCw, ShieldCheck, Wrench} from "lucide-react";
import {AgentMesh} from "@/components/AgentMesh";
import {apiGet} from "@/lib/api";
import {arcTestnet} from "@/lib/arc";

const RETRY_SECONDS = 60;
const xUrl = import.meta.env.VITE_NEXORA_X_URL || "https://x.com/nexorafi";
const githubUrl = import.meta.env.VITE_NEXORA_GITHUB_URL || "https://github.com";

function XGlyph({size = 15}: {size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

export default function MaintenancePage() {
  const reduceMotion = useReducedMotion();
  const [secondsLeft, setSecondsLeft] = useState(RETRY_SECONDS);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  // Auto-retry: reload when the countdown hits zero.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.location.reload();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Passive readiness ping for the live status dot (does not force a reload).
  useEffect(() => {
    let cancelled = false;
    function check() {
      apiGet("/api/readiness")
        .then(() => !cancelled && setApiReachable(true))
        .catch(() => !cancelled && setApiReachable(false));
    }
    check();
    const id = window.setInterval(check, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const countdown = `0:${String(secondsLeft).padStart(2, "0")}`;
  const statusCards = [
    {icon: Activity, label: "Status", value: "Upgrade window", tone: "warn" as const},
    {icon: ShieldCheck, label: "Contracts", value: "On-chain", tone: "good" as const},
    {icon: Clock, label: "Services", value: apiReachable === null ? "Checking…" : apiReachable ? "Responding" : "Offline", tone: apiReachable ? ("good" as const) : ("warn" as const)}
  ];

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-12">
      <img src="/hero_image.png" alt="" aria-hidden="true" className="pointer-events-none fixed inset-0 h-full w-full object-cover object-center opacity-25" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(8,7,17,0.82),rgba(8,7,17,0.95))]" />
      <div className="aurora pointer-events-none fixed inset-0" />
      <div className="grain pointer-events-none fixed inset-0" />
      {!reduceMotion ? <div className="pointer-events-none fixed inset-0 opacity-60"><AgentMesh /></div> : null}

      <motion.section
        className="panel relative z-10 max-w-2xl overflow-hidden p-0 text-center"
        initial={{opacity: 0, y: 18, scale: 0.98}}
        animate={{opacity: 1, y: 0, scale: 1}}
        transition={{duration: 0.5, ease: [0.22, 1, 0.36, 1]}}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-plasma/50 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(155,92,246,0.18),transparent_18rem)]" />

        <div className="relative p-6 md:p-10">
          <img src="/nexora-wordmark-tight.png" alt="Nexora" className="mx-auto h-7 w-auto" />

          <div className="relative mx-auto mt-7 flex h-16 w-16 items-center justify-center rounded-2xl border border-plasma/30 bg-gradient-to-br from-plasma/20 to-violet/10 text-orchid shadow-[0_0_24px_rgba(155,92,246,0.25)]">
            <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15" />
            {reduceMotion ? (
              <Wrench size={28} />
            ) : (
              <motion.div animate={{rotate: [0, -12, 12, 0]}} transition={{duration: 2.4, repeat: Infinity, ease: "easeInOut"}}>
                <Wrench size={28} />
              </motion.div>
            )}
          </div>

          <p className="section-kicker mt-6">Maintenance mode</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-white md:text-5xl">
            Nexora is upgrading its agent finance layer.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-300">
            The console is temporarily offline while contracts, integrations, or platform services are being updated. Funds and policies remain governed by deployed on-chain contracts.
          </p>

          {/* Indeterminate progress */}
          <div className="mx-auto mt-7 max-w-md">
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              {reduceMotion ? (
                <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-plasma to-mint" />
              ) : (
                <motion.div
                  className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-plasma to-mint"
                  animate={{left: ["-35%", "100%"]}}
                  transition={{duration: 1.8, repeat: Infinity, ease: "easeInOut"}}
                />
              )}
            </div>
          </div>

          {/* Status cards */}
          <div className="mt-7 grid gap-3 text-left sm:grid-cols-3">
            {statusCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="surface p-4">
                  <div className="flex items-center justify-between">
                    <Icon className="text-orchid" size={18} />
                    <span className="relative flex h-2 w-2">
                      {card.tone === "good" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" /> : null}
                      <span className={`relative inline-flex h-2 w-2 rounded-full ${card.tone === "good" ? "bg-mint" : "bg-amber"}`} />
                    </span>
                  </div>
                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
                  <p className="mt-1 text-sm font-medium text-white">{card.value}</p>
                </div>
              );
            })}
          </div>

          {/* Auto-retry */}
          <div className="mt-7 flex flex-col items-center gap-3">
            <button type="button" onClick={() => window.location.reload()} className="action-button">
              <RefreshCw size={16} /> Try again now
            </button>
            <p className="text-xs text-slate-500">Retrying automatically in <span className="font-mono font-semibold text-slate-300">{countdown}</span></p>
          </div>

          {/* Links + footer */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <a href={xUrl} target="_blank" rel="noreferrer" aria-label="Updates on X" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-slate-300 transition hover:border-plasma/40 hover:text-white">
              <XGlyph />
            </a>
            <a href={githubUrl} target="_blank" rel="noreferrer" aria-label="GitHub" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-slate-300 transition hover:border-plasma/40 hover:text-white">
              <Github size={16} />
            </a>
            <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}`} target="_blank" rel="noreferrer" className="secondary-button min-h-10 px-4 text-sm">
              Arc Explorer <ExternalLink size={14} />
            </a>
          </div>

          <p className="mt-6 text-xs font-medium text-slate-600">© {new Date().getFullYear()} Nexora · Arc Testnet · USDC · x402</p>
        </div>
      </motion.section>
    </div>
  );
}
