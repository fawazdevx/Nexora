import {useEffect, useState} from "react";
import {motion} from "framer-motion";
import {BadgeCheck, CheckCircle2, Coins, ExternalLink, Sparkles, Store} from "lucide-react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {AgentAvatar} from "@/components/AgentAvatar";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {useArcName} from "@/hooks/useArcName";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

const TIERS = [
  {name: "Building", min: 0},
  {name: "Active", min: 100},
  {name: "Trusted", min: 500},
  {name: "Elite", min: 1000}
] as const;

type Tier = {name: string; min: number};

function tierFor(score: number) {
  let current: Tier = TIERS[0];
  let index = 0;
  TIERS.forEach((tier, i) => {
    if (score >= tier.min) {
      current = tier;
      index = i;
    }
  });
  const next: Tier | null = TIERS[index + 1] ?? null;
  return {current, next};
}

const FACTOR_COLORS = ["bg-mint", "bg-cyan", "bg-orchid", "bg-amber"] as const;

export default function ReputationPage() {
  const {address} = useAccount();
  const {arcName} = useArcName(address);
  const snapshot = useAppSnapshot();
  const loading = snapshot.isLoading;
  const reputation = snapshot.data?.reputation;
  const score = reputation?.score ?? 0;
  const {current, next} = tierFor(score);
  const gaugeMax = next ? next.min : Math.max(score, current.min || 1);
  const progress = next ? Math.min(1, score / next.min) : 1;

  const factors = [
    {label: "Successful payments", value: reputation?.successfulPayments ?? 0, icon: Coins},
    {label: "Completed agent tasks", value: reputation?.completedTasks ?? 0, icon: CheckCircle2},
    {label: "Marketplace activity", value: reputation?.marketplaceSales ?? 0, icon: Store},
    {label: "Ecosystem contributions", value: reputation?.ecosystemContributions ?? 0, icon: Sparkles}
  ];
  const totalActivity = factors.reduce((total, factor) => total + factor.value, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Operator reputation"
        title="Reputation scorecard"
        description="Reputation accumulates from settled payments, completed tasks, marketplace activity, and ecosystem contributions."
      />

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Score hero */}
        <div className="panel flex flex-col items-center text-center">
          <ScoreGauge score={score} max={gaugeMax} loading={loading} />
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orchid">{current.name} tier</p>
            {reputation?.verifiedBuilder ? (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-bold text-mint">
                <BadgeCheck size={13} /> Verified builder
              </span>
            ) : (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-400">
                Building reputation
              </span>
            )}
          </div>
          {next ? (
            <p className="mt-3 text-xs text-slate-500">{Math.max(0, next.min - score)} pts to <span className="font-semibold text-slate-300">{next.name}</span></p>
          ) : (
            <p className="mt-3 text-xs text-mint">Top tier reached</p>
          )}
        </div>

        {/* Identity + composition */}
        <div className="panel">
          <p className="section-kicker">Operator</p>
          {address ? (
            <div className="mt-4 flex items-center gap-3">
              <AgentAvatar seed={address} label={arcName ?? address} size={44} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{arcName ?? shortAddress(address)}</p>
                <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/address/${address}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-orchid">
                  {shortAddress(address)} <ExternalLink size={11} />
                </a>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">Connect your wallet to view your operator reputation.</p>
          )}

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Activity composition</p>
            {loading ? (
              <div className="shimmer mt-2 h-2.5 w-full rounded-full" />
            ) : totalActivity > 0 ? (
              <>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                  {factors.map((factor, index) =>
                    factor.value > 0 ? (
                      <div key={factor.label} className={`h-full ${FACTOR_COLORS[index]}`} style={{width: `${(factor.value / totalActivity) * 100}%`}} />
                    ) : null
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  {factors.map((factor, index) => (
                    <span key={factor.label} className="flex items-center gap-1.5 text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${FACTOR_COLORS[index]}`} />
                      {factor.label} <b className="text-white">{factor.value}</b>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No activity recorded yet. Settle payments, complete tasks, and publish services to build reputation.</p>
            )}
          </div>
        </div>
      </section>

      {/* Factor cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {factors.map((factor, index) => (
          <StatMetric key={factor.label} variant="panel" icon={factor.icon} label={factor.label} value={factor.value} loading={loading} accent={index === 0} />
        ))}
      </section>
    </div>
  );
}

function ScoreGauge({score, max, loading}: {score: number; max: number; loading: boolean}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(1, score / max) : 0;
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    if (loading) return;
    const controls = {raf: 0, start: 0};
    const duration = 1000;
    function step(timestamp: number) {
      if (!controls.start) controls.start = timestamp;
      const ratio = Math.min(1, (timestamp - controls.start) / duration);
      const eased = 1 - Math.pow(1 - ratio, 3);
      setAnimatedScore(Math.round(score * eased));
      if (ratio < 1) controls.raf = requestAnimationFrame(step);
    }
    controls.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(controls.raf);
  }, [score, loading]);

  return (
    <div className="relative h-40 w-40">
      <svg viewBox="0 0 120 120" className="h-40 w-40 -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="url(#scoreGradient)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{strokeDashoffset: circumference}}
          animate={{strokeDashoffset: loading ? circumference : circumference * (1 - progress)}}
          transition={{duration: 1, ease: [0.22, 1, 0.36, 1]}}
        />
        <defs>
          <linearGradient id="scoreGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6ee7b7" />
            <stop offset="100%" stopColor="#9b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {loading ? (
          <div className="shimmer h-9 w-16 rounded-md" />
        ) : (
          <p className="text-4xl font-bold text-white">{animatedScore}</p>
        )}
        <p className="text-xs text-slate-500">score</p>
      </div>
    </div>
  );
}
