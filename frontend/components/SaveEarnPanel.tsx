import {useState} from "react";
import {ArrowDownToLine, ArrowRight, ArrowUpFromLine, Boxes, Gauge, Landmark, Loader2, ShieldCheck, Sparkles, Wallet} from "lucide-react";
import {useAccount} from "wagmi";
import {useQuery} from "@tanstack/react-query";
import toast from "react-hot-toast";
import {depositSaveEarn, readSaveEarnPosition, readUsdcBalance, withdrawSaveEarn} from "@/lib/contracts";
import {shortAddress, arcTestnet} from "@/lib/arc";
import {StatMetric} from "@/components/StatMetric";
import {apiGet} from "@/lib/api";

const PERCENTS = [25, 50, 75] as const;
const parsedApr = Number(import.meta.env.VITE_SAVE_EARN_APR ?? "");
const estApr = Number.isFinite(parsedApr) && parsedApr > 0 ? parsedApr : null;

type EarnOpportunity = {
  id: string;
  title: string;
  payoutAsset: "USDC";
  automationEnabled: boolean;
  risk: "low" | "medium" | "high";
  provider: string;
  status: string;
  contractAddress?: string | null;
  chain?: string;
  project?: string;
  symbol?: string;
  poolMeta?: string | null;
  tvlUsd?: number;
  apy?: number;
  notes?: string[];
  sourceUrl?: string;
  error?: string;
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
  const {address, isConnected} = useAccount();
  const [mode, setMode] = useState<"save" | "withdraw">("save");
  const [amount, setAmount] = useState("0");
  const [pending, setPending] = useState(false);

  const position = useQuery({
    queryKey: ["save-earn-position", address],
    queryFn: () => readSaveEarnPosition(address as string),
    enabled: Boolean(address),
    refetchInterval: 12_000
  });
  const walletBalance = useQuery({
    queryKey: ["usdc-balance", address],
    queryFn: () => readUsdcBalance(address as string),
    enabled: Boolean(address),
    refetchInterval: 12_000
  });
  const earnOpportunities = useQuery({
    queryKey: ["earn-opportunities"],
    queryFn: () => apiGet<{opportunities: EarnOpportunity[]}>("/api/earn/opportunities"),
    refetchInterval: 60_000
  });

  const positionData = position.data;
  const loading = position.isLoading;
  const amountIsPositive = Number(amount) > 0;
  const maxSource = mode === "save" ? num(walletBalance.data) : num(positionData?.withdrawableAssets);
  const yieldToDate = num(positionData?.deposited) > 0 ? (num(positionData?.estimatedEarnings) / num(positionData?.deposited)) * 100 : 0;
  const marketOpportunities = (earnOpportunities.data?.opportunities ?? [])
    .filter((opportunity) => opportunity.provider === "defillama" && typeof opportunity.apy === "number")
    .slice(0, 3);

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
    setPending(true);
    const id = toast.loading(mode === "save" ? "Approving and routing deposit…" : "Withdrawing from Save/Earn…");
    try {
      if (mode === "save") {
        const result = await depositSaveEarn(amount);
        await Promise.all([position.refetch(), walletBalance.refetch()]);
        toast.success(txToast("USDC saved", result.depositHash), {id});
      } else {
        const hash = await withdrawSaveEarn(amount);
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

  return (
    <div className="space-y-4">
      {/* Position summary */}
      <section className="panel relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(155,92,246,0.12),transparent_38%)]" />
        <div className="relative">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">
              <Sparkles size={13} />
              Autonomous route
            </span>
            <span className="status-pill border-mint/20 bg-mint/10 text-mint">
              <ShieldCheck size={13} />
              Policy guarded
            </span>
          </div>

          {!address ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-orchid">
                <Wallet size={22} />
              </div>
              <p className="max-w-sm text-sm leading-6 text-slate-400">Connect your wallet to view your Save/Earn position, estimated earnings, and withdrawable balance.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <StatMetric variant="landing" size="xl" value={num(positionData?.currentAssets)} prefix="$" decimals={2} label="Current value · USDC in vault" loading={loading} accent />
                </div>
                {estApr !== null ? (
                  <StatMetric variant="landing" value={estApr} suffix="%" decimals={2} label="Est. APR · target" loading={false} />
                ) : (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
                    <p className="text-2xl font-semibold text-white">—</p>
                    <p className="mt-1 text-xs text-slate-500">Est. APR</p>
                  </div>
                )}
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
                  Save/Earn position could not be read from Arc. Refresh or check the connected wallet and RPC connection.
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
            disabled={!isConnected || !amountIsPositive || pending}
          >
            {pending ? <Loader2 size={17} className="animate-spin" /> : mode === "save" ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}
            {pending ? "Submitting…" : mode === "save" ? "Save USDC" : "Withdraw USDC"}
          </button>
        </section>

        {/* Routing diagram + facts */}
        <section className="panel">
          <p className="section-kicker">How routing works</p>
          <div className="mt-5 flex items-center justify-between gap-2">
            <RouteNode icon={Wallet} label="Your wallet" caption="USDC" />
            <ArrowRight size={16} className="shrink-0 text-slate-600" />
            <RouteNode icon={Landmark} label="Nexora vault" caption="Save/Earn" accent />
            <ArrowRight size={16} className="shrink-0 text-slate-600" />
            <RouteNode icon={Boxes} label="Arc adapter" caption="XyloNet" />
          </div>
          <div className="mt-6 grid gap-2.5">
            {[
              ["Asset", "USDC", ShieldCheck],
              ["Routing", "Best approved Arc vault", Sparkles],
              ["Routing target", "XyloNet USDC vault", Gauge]
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
            <p className="section-kicker">Provider intelligence</p>
            <h3 className="mt-1 text-lg font-semibold text-white">USDC yield market data</h3>
          </div>
          <span className="status-pill border-amber/25 bg-amber/10 text-amber">Discovery only</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          DeFiLlama data helps Nexora agents monitor USDC yield markets, but these are not executable routes until a protocol adapter is approved.
        </p>

        {earnOpportunities.isLoading ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="shimmer h-32 rounded-xl" />)}
          </div>
        ) : marketOpportunities.length > 0 ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {marketOpportunities.map((opportunity) => <YieldMarketCard key={opportunity.id} opportunity={opportunity} />)}
          </div>
        ) : (
          <div className="surface mt-5 p-4 text-sm leading-6 text-slate-400">
            {earnOpportunities.isError ? "Live DeFiLlama market data is unavailable right now. Save/Earn vault actions are unaffected." : "No USDC yield market data is available right now."}
          </div>
        )}
      </section>
    </div>
  );
}

function YieldMarketCard({opportunity}: {opportunity: EarnOpportunity}) {
  const tvl = typeof opportunity.tvlUsd === "number" ? compactUsd(opportunity.tvlUsd) : "—";
  const apy = typeof opportunity.apy === "number" ? `${opportunity.apy.toFixed(2)}%` : "—";
  const riskClass = opportunity.risk === "low" ? "border-mint/25 bg-mint/10 text-mint" : opportunity.risk === "medium" ? "border-amber/25 bg-amber/10 text-amber" : "border-magenta/25 bg-magenta/10 text-magenta";
  return (
    <article className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{opportunity.project ?? opportunity.symbol ?? "USDC pool"}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{[opportunity.chain, opportunity.symbol].filter(Boolean).join(" · ") || "USDC market"}</p>
        </div>
        <span className={`status-pill ${riskClass}`}>{opportunity.risk}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
          <p className="text-lg font-semibold text-mint">{apy}</p>
          <p className="text-[11px] text-slate-500">APY</p>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
          <p className="text-lg font-semibold text-white">{tvl}</p>
          <p className="text-[11px] text-slate-500">TVL</p>
        </div>
      </div>
      {opportunity.poolMeta ? (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{opportunity.poolMeta}</p>
      ) : null}
    </article>
  );
}

function compactUsd(value: number) {
  return `$${value.toLocaleString("en-US", {notation: "compact", maximumFractionDigits: 1})}`;
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
