import {useState} from "react";
import {ArrowDownToLine, ArrowRight, ArrowUpFromLine, Boxes, Gauge, Landmark, Loader2, RefreshCw, ShieldCheck, Sparkles, Wallet} from "lucide-react";
import {useAccount} from "wagmi";
import {useQuery} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {depositSaveEarn, readSaveEarnPosition, readUsdcBalance, withdrawSaveEarn, type SaveEarnProfile} from "@/lib/contracts";
import {shortAddress, arcTestnet, switchToArc} from "@/lib/arc";
import {StatMetric} from "@/components/StatMetric";
import {apiGet} from "@/lib/api";

const PERCENTS = [25, 50, 75] as const;

type OptimizerStatus = {
  profile: SaveEarnProfile;
  profileLabel: string;
  riskPreference: string;
  configured: boolean;
  enabled: boolean;
  executionEnabled: boolean;
  intervalHours: number;
  decision: {
    action: "stay" | "rebalance" | "unavailable";
    selectedStrategyId: number | null;
    reason: string;
  };
  strategies: Array<{
    strategyId: number;
    protocol: string;
    current: boolean;
    expectedApyBps: number | null;
    totalAssetsUsdc: number;
    underlyingVaultAssetsUsdc: number | null;
    assetsPerShare: number | null;
    telemetryStatus: "live" | "limited" | "unavailable";
    riskScoreBps: number | null;
    riskConfigured: boolean;
    liquidityScoreBps: number;
    optimizerScore: number | null;
    eligibleForAutomaticRouting: boolean;
  }>;
  lastRun: {
    status: string;
    reason: string;
    txHash: string | null;
    createdAt: string;
  } | null;
  nextCheckAt: string | null;
  checkedAt: string;
};

const PROFILE_DETAILS: Record<SaveEarnProfile, {label: string; risk: string}> = {
  conservative: {label: "Conservative", risk: "Liquidity and stability first"},
  balanced: {label: "Balanced", risk: "Yield balanced with risk"},
  growth: {label: "Growth", risk: "Higher reviewed yield variance"}
};

function num(value?: string) {
  return Number(value ?? 0);
}

function fmtAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function txToast(title: string, hash: string) {
  const href = `${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
  return (
    <span>
      {title} ·{" "}
      <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-mint underline-offset-2 hover:underline">
        View tx
      </a>
    </span>
  );
}

export function SaveEarnPanel() {
  const {address, chain, isConnected} = useAccount();
  const [mode, setMode] = useState<"save" | "withdraw">("save");
  const [amount, setAmount] = useState("0");
  const [pending, setPending] = useState(false);
  const [switchingChain, setSwitchingChain] = useState(false);
  const [profile, setProfile] = useState<SaveEarnProfile>("balanced");
  const onArc = chain?.id === arcTestnet.id;

  const optimizer = useQuery({
    queryKey: ["save-earn-optimizer"],
    queryFn: () => apiGet<{profiles: OptimizerStatus[]}>("/api/earn/optimizer"),
    refetchInterval: 60_000,
    retry: 2
  });
  const selectedOptimizer = optimizer.data?.profiles.find((item) => item.profile === profile);
  const profileReady = profile === "balanced" || selectedOptimizer?.configured === true;

  const position = useQuery({
    queryKey: ["save-earn-position", arcTestnet.id, address, profile],
    queryFn: () => readSaveEarnPosition(address as string, arcTestnet.id, profile),
    enabled: Boolean(address) && onArc && profileReady,
    refetchInterval: 12_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000)
  });
  const walletBalance = useQuery({
    queryKey: ["usdc-balance", arcTestnet.id, address],
    queryFn: () => readUsdcBalance(address as string, arcTestnet.id),
    enabled: Boolean(address) && onArc,
    refetchInterval: 12_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000)
  });
  const positionData = position.data;
  const loading = position.isLoading;
  const amountIsPositive = Number(amount) > 0;
  const maxSource = mode === "save" ? num(walletBalance.data) : num(positionData?.withdrawableAssets);
  const yieldToDate = num(positionData?.deposited) > 0 ? (num(positionData?.estimatedEarnings) / num(positionData?.deposited)) * 100 : 0;
  const lastUpdatedAt = Math.max(position.dataUpdatedAt, walletBalance.dataUpdatedAt);
  const activeStrategy = selectedOptimizer?.strategies.find((strategy) => strategy.current);

  function setPercent(pct: number) {
    setAmount(fmtAmount((maxSource * pct) / 100));
  }

  async function submit() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first.");
      return;
    }
    if (!amountIsPositive) {
      toast.error("Enter a USDC amount.");
      return;
    }
    if (!onArc) {
      toast.error("Switch to Arc Testnet before using Save/Earn.");
      return;
    }
    if (!profileReady) {
      toast.error(`${PROFILE_DETAILS[profile].label} Save/Earn is not configured yet.`);
      return;
    }
    setPending(true);
    const id = toast.loading(mode === "save" ? "Approving and routing deposit…" : "Withdrawing from Save/Earn…");
    try {
      if (mode === "save") {
        const result = await depositSaveEarn(amount, profile);
        await Promise.all([position.refetch(), walletBalance.refetch()]);
        toast.success(txToast("USDC saved", result.depositHash), {id});
      } else {
        const hash = await withdrawSaveEarn(amount, profile);
        await Promise.all([position.refetch(), walletBalance.refetch()]);
        toast.success(txToast("Withdrawal submitted", hash), {id});
      }
      setAmount("0");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transaction failed", {id});
    } finally {
      setPending(false);
    }
  }

  async function selectArc() {
    setSwitchingChain(true);
    try {
      await switchToArc();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch to Arc Testnet.");
    } finally {
      setSwitchingChain(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <p className="section-kicker">Choose optimization profile</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {(Object.keys(PROFILE_DETAILS) as SaveEarnProfile[]).map((value) => {
            const status = optimizer.data?.profiles.find((item) => item.profile === value);
            const selected = profile === value;
            const configured = value === "balanced" || status?.configured === true;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setProfile(value);
                  setAmount("0");
                }}
                className={`rounded-xl border p-4 text-left transition ${
                  selected
                    ? "border-plasma/40 bg-plasma/10 shadow-[0_0_24px_rgba(155,92,246,0.12)]"
                    : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-white">{PROFILE_DETAILS[value].label}</p>
                  <span className={`text-[11px] font-semibold ${configured ? "text-mint" : "text-amber"}`}>
                    {configured ? "Available" : "Setup pending"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{status?.riskPreference ?? PROFILE_DETAILS[value].risk}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Position summary */}
      <section className="panel relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(155,92,246,0.12),transparent_38%)]" />
        <div className="relative">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">
              <Sparkles size={13} />
              Optimizer monitored
            </span>
            <span className="status-pill border-mint/20 bg-mint/10 text-mint">
              <ShieldCheck size={13} />
              Owner-approved adapter
            </span>
          </div>

          {!address ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-orchid">
                <Wallet size={22} />
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-400">Connect your wallet to view your Save/Earn position, estimated earnings, and withdrawable balance.</p>
            </div>
          ) : !onArc ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-amber/25 bg-amber/10 px-6 py-10 text-center">
              <p className="max-w-md text-sm leading-6 text-amber">
                Save/Earn currently routes through the approved XyloNet USDC vault on Arc Testnet.
              </p>
              <button type="button" className="secondary-button min-h-10" onClick={selectArc} disabled={switchingChain}>
                {switchingChain ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {switchingChain ? "Switching…" : "Switch to Arc Testnet"}
              </button>
            </div>
          ) : (
            <>
              {!profileReady ? (
                <p className="rounded-xl border border-amber/25 bg-amber/10 p-4 text-sm text-amber">
                  This profile becomes available after its Arc Yield Router and approved strategy adapter are configured.
                </p>
              ) : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <StatMetric variant="landing" size="xl" value={num(positionData?.currentAssets)} prefix="$" decimals={2} label="Current value · USDC in vault" loading={loading} accent />
                </div>
                <StatMetric variant="landing" value={yieldToDate} suffix="%" decimals={2} label="Yield to date" loading={loading} />
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <StatMetric variant="panel" icon={ArrowDownToLine} value={num(positionData?.deposited)} prefix="$" decimals={2} label="Deposited" loading={loading} />
                <StatMetric variant="panel" icon={Sparkles} value={num(positionData?.estimatedEarnings)} prefix="$" decimals={2} label="Earned" loading={loading} accent />
                <StatMetric variant="panel" icon={ArrowUpFromLine} value={num(positionData?.withdrawableAssets)} prefix="$" decimals={2} label="Withdrawable" loading={loading} />
              </div>

              {!loading ? (
                <p className="mt-3 text-xs text-slate-500">
                  Shares <span className="font-semibold text-slate-300">{num(positionData?.shares).toFixed(2)}</span>
                  <span className="mx-2 text-slate-700">·</span>
                  Withdrawal fee <span className="font-semibold text-slate-300">${num(positionData?.withdrawalFee).toFixed(2)}</span>
                </p>
              ) : null}

              {position.isError ? (
                <p className="mt-3 rounded-xl border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">
                  Arc is taking longer than expected to return this position. Nexora will retry automatically and keep the last successful values.
                </p>
              ) : null}
              {lastUpdatedAt > 0 ? (
                <p className="mt-2 text-xs text-slate-600">
                  Onchain position refreshed {new Date(lastUpdatedAt).toLocaleTimeString()}.
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        {/* Action card */}
        <section className="panel">
          <div className="flex rounded-xl border border-white/[0.1] bg-white/[0.03] p-1">
            {(["save", "withdraw"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setAmount("0");
                }}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold capitalize transition ${mode === value ? "bg-gradient-to-br from-plasma/[0.22] to-plasma/[0.1] text-white shadow-[0_0_20px_rgba(155,92,246,0.15)]" : "text-slate-400 hover:text-white"}`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <label htmlFor="save-earn-amount" className="text-sm font-medium text-slate-300">USDC amount</label>
              <span className="text-xs text-slate-500">
                {mode === "save" ? "Wallet" : "Withdrawable"}:{" "}
                <button type="button" onClick={() => setAmount(fmtAmount(maxSource))} className="font-semibold text-mint hover:underline">
                  {address ? `$${maxSource.toFixed(2)}` : "—"}
                </button>
              </span>
            </div>
            <div className="field mt-2 flex items-center gap-2 p-0 pr-2">
              <input
                id="save-earn-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-2xl font-semibold text-white outline-none"
              />
              <button type="button" onClick={() => setAmount(fmtAmount(maxSource))} className="shrink-0 rounded-lg border border-mint/30 bg-mint/10 px-2.5 py-1 text-xs font-bold text-mint transition hover:bg-mint/20">
                MAX
              </button>
              <span className="shrink-0 text-sm font-medium text-slate-400">USDC</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {PERCENTS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setPercent(pct)}
                  disabled={!address || maxSource <= 0}
                  className="rounded-lg border border-white/[0.1] bg-white/[0.04] py-1.5 text-xs font-semibold text-slate-300 transition hover:border-plasma/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pct}%
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAmount(fmtAmount(maxSource))}
                disabled={!address || maxSource <= 0}
                className="rounded-lg border border-white/[0.1] bg-white/[0.04] py-1.5 text-xs font-semibold text-slate-300 transition hover:border-plasma/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Max
              </button>
            </div>
          </div>

          <div className="mt-4 surface flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-slate-400">Operator wallet</span>
            <span className="font-mono text-white">{address ? shortAddress(address) : "Connect wallet"}</span>
          </div>

          <button
            onClick={submit}
            className={`mt-4 min-h-12 w-full ${mode === "save" ? "action-button" : "secondary-button"}`}
            disabled={!isConnected || !onArc || !profileReady || !amountIsPositive || pending}
          >
            {pending ? <Loader2 size={17} className="animate-spin" /> : mode === "save" ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}
            {pending ? "Submitting…" : mode === "save" ? `Save to ${PROFILE_DETAILS[profile].label}` : `Withdraw from ${PROFILE_DETAILS[profile].label}`}
          </button>
        </section>

        {/* Routing diagram + facts */}
        <section className="panel">
          <p className="section-kicker">How routing works</p>
          <div className="mt-5 flex items-center justify-between gap-2">
            <RouteNode icon={Wallet} label="Your wallet" caption="USDC" />
            <ArrowRight size={16} className="shrink-0 text-slate-600" />
            <RouteNode icon={Landmark} label={`${PROFILE_DETAILS[profile].label} pool`} caption="Nexora Save/Earn" accent />
            <ArrowRight size={16} className="shrink-0 text-slate-600" />
            <RouteNode icon={Boxes} label="Underlying Arc vault" caption={activeStrategy?.protocol ?? "Approved route"} />
          </div>
          <div className="mt-6 grid gap-2.5">
            {[
              ["Asset", "USDC", ShieldCheck],
              ["Profile", PROFILE_DETAILS[profile].label, Sparkles],
              ["Routing target", activeStrategy ? `${activeStrategy.protocol} USDC vault` : "Approved USDC vault", Gauge]
            ].map(([label, value, Icon]) => {
              const ItemIcon = Icon as typeof ShieldCheck;
              return (
                <div key={label as string} className="surface flex items-center justify-between px-4 py-3">
                  <span className="flex items-center gap-2 text-sm text-slate-400">
                    <ItemIcon size={15} className="text-orchid" />
                    {label as string}
                  </span>
                  <b className="text-sm text-white">{value as string}</b>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-kicker">Optimizer status</p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {optimizer.isLoading ? "Reading approved Arc routes…" : `${selectedOptimizer?.strategies.length ?? 0} approved Arc route${selectedOptimizer?.strategies.length === 1 ? "" : "s"}`}
            </h3>
          </div>
          <span className="status-pill border-mint/25 bg-mint/10 text-mint">
            {activeStrategy ? `${activeStrategy.protocol} active` : "Route pending"}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          {selectedOptimizer?.decision.reason ?? "Nexora reads approved strategy adapters and compares only fresh, executable Arc telemetry. Unrelated mainnet market listings are not eligible for automatic routing."}
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <OptimizerFact label="Current route" value={activeStrategy ? `${activeStrategy.protocol} USDC vault` : "No active route"} />
          <OptimizerFact
            label="Risk review"
            value={activeStrategy ? riskBand(activeStrategy.riskScoreBps) : "No active route"}
          />
          <OptimizerFact
            label="Vault assets"
            value={activeStrategy?.underlyingVaultAssetsUsdc === null || activeStrategy?.underlyingVaultAssetsUsdc === undefined
              ? "Telemetry limited"
              : `$${activeStrategy.underlyingVaultAssetsUsdc.toLocaleString("en-US", {maximumFractionDigits: 2})}`}
          />
          <OptimizerFact label="Next 24-hour evaluation" value={selectedOptimizer?.nextCheckAt ? formatNextCheck(selectedOptimizer.nextCheckAt) : "Pending first check"} />
        </div>
        {optimizer.isError ? (
          <p className="mt-3 rounded-xl border border-amber/25 bg-amber/10 p-3 text-sm text-amber">
            Optimizer telemetry is temporarily unavailable. Deposits and withdrawals continue through the active onchain strategy.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function riskBand(riskScoreBps: number | null) {
  if (riskScoreBps === null) return "Owner review pending";
  if (riskScoreBps <= 3_500) return "Reviewed · lower risk";
  if (riskScoreBps <= 6_500) return "Reviewed · moderate risk";
  return "Reviewed · elevated risk";
}

function OptimizerFact({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function formatNextCheck(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Scheduled";
  if (timestamp <= Date.now()) return "Due now";
  const hours = Math.ceil((timestamp - Date.now()) / 3_600_000);
  if (hours < 24) return `In ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

function RouteNode({icon: Icon, label, caption, accent = false}: {icon: typeof Wallet; label: string; caption: string; accent?: boolean}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl border ${accent ? "border-mint/30 bg-mint/10 text-mint shadow-[0_0_20px_rgba(110,231,183,0.18)]" : "border-white/[0.1] bg-white/[0.04] text-orchid"}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-white">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{caption}</p>
      </div>
    </div>
  );
}
