import {useEffect, useMemo, useRef, useState} from "react";
import {ArrowDownUp, CheckCircle2, ExternalLink, RefreshCw} from "lucide-react";
import {formatUnits} from "viem";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {arcTestnet, shortAddress, switchToArc} from "@/lib/arc";
import {
  executeSynthraSwap,
  executeXyloNetSwap,
  isXyloNetRouteSupported,
  quoteSynthraSwap,
  quoteXyloNetSwap,
  readSwapTokenBalance,
  type SynthraSwapQuote,
  type XyloNetSwapQuote,
  type XyloNetSwapToken,
  xylonet,
  xylonetSwapTokens
} from "@/lib/contracts";

const tokens = Object.keys(xylonetSwapTokens) as XyloNetSwapToken[];
const routeVenues = ["XyloNet", "Synthra"] as const;
const swapFeeBps = Number(import.meta.env.VITE_SWAP_FEE_BPS ?? "0");
const swapFeeRecipient = import.meta.env.VITE_SWAP_FEE_RECIPIENT ?? "";

type RoutePreview = {
  venue: typeof routeVenues[number];
  status: "best" | "available" | "unavailable" | "error";
  output?: string;
  message: string;
};

type AggregatorQuote = XyloNetSwapQuote | SynthraSwapQuote;

export default function SwapPage() {
  const {address, chain, isConnected} = useAccount();
  const [amount, setAmount] = useState("1");
  const [tokenIn, setTokenIn] = useState<XyloNetSwapToken>("USDC");
  const [tokenOut, setTokenOut] = useState<XyloNetSwapToken>("EURC");
  const [slippageBps, setSlippageBps] = useState("100");
  const [quote, setQuote] = useState<AggregatorQuote | null>(null);
  const [routes, setRoutes] = useState<RoutePreview[]>(defaultRoutes());
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<{token: XyloNetSwapToken; formatted: string} | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [swapStep, setSwapStep] = useState<"idle" | "approve" | "swap" | "confirmed">("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const quoteRequestId = useRef(0);

  const onArc = chain?.id === arcTestnet.id;
  const amountNumber = Number(amount);
  const routeSupported = isXyloNetRouteSupported(tokenIn, tokenOut);
  const executableQuote = quote?.venue === "XyloNet" || quote?.venue === "Synthra";
  const swapDisabled = !quote || !executableQuote || executing || loading;
  const minReceived = useMemo(() => {
    if (!quote) return "0.00";
    const minRaw = quote.amountOutRaw * BigInt(10_000 - Number(slippageBps)) / 10_000n;
    return formatUnits(minRaw, xylonetSwapTokens[quote.tokenOut].decimals);
  }, [quote, slippageBps]);
  const balanceNumber = Number(balance?.formatted ?? "0");
  const feeEnabled = Number.isFinite(swapFeeBps) && swapFeeBps > 0 && Boolean(swapFeeRecipient);
  const feeAmount = feeEnabled && Number.isFinite(amountNumber) ? amountNumber * swapFeeBps / 10_000 : 0;

  function resetQuote() {
    setQuote(null);
    setTxHash(null);
    setRoutes(defaultRoutes());
  }

  useEffect(() => {
    const requestId = ++quoteRequestId.current;
    setTxHash(null);

    if (!isConnected) {
      setQuote(null);
      setRoutes(defaultRoutes());
      setStatus("");
      setLoading(false);
      return;
    }
    if (!onArc) {
      setQuote(null);
      setRoutes(defaultRoutes());
      setStatus("Switch to Arc Testnet to see live swap routes.");
      setLoading(false);
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0 || tokenIn === tokenOut) {
      setQuote(null);
      setRoutes(defaultRoutes());
      setStatus("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setStatus("");
    const timeout = window.setTimeout(() => {
      void refreshQuote(requestId);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [amount, amountNumber, isConnected, onArc, tokenIn, tokenOut]);

  useEffect(() => {
    let cancelled = false;
    if (!address || !onArc) {
      setBalance(null);
      return;
    }
    setBalanceLoading(true);
    void readSwapTokenBalance({owner: address, token: tokenIn})
      .then((result) => {
        if (!cancelled) setBalance({token: result.token, formatted: trimTokenAmount(result.formatted)});
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, onArc, tokenIn, txHash]);

  function updateTokenIn(value: XyloNetSwapToken) {
    if (value === tokenOut) setTokenOut(tokenIn);
    setTokenIn(value);
    resetQuote();
  }

  function updateTokenOut(value: XyloNetSwapToken) {
    if (value === tokenIn) setTokenIn(tokenOut);
    setTokenOut(value);
    resetQuote();
  }

  function flipPair() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    resetQuote();
  }

  async function refreshQuote(requestId = ++quoteRequestId.current) {
    setStatus("");
    try {
      const settled: [PromiseSettledResult<XyloNetSwapQuote>, PromiseSettledResult<SynthraSwapQuote>] = await Promise.allSettled([
        routeSupported
          ? quoteXyloNetSwap({tokenIn, tokenOut, amountIn: amount})
          : Promise.reject(new Error("No route available.")),
        quoteSynthraSwap({tokenIn, tokenOut, amountIn: amount})
      ]);
      if (requestId !== quoteRequestId.current) return;

      const liveQuotes = settled
        .flatMap((item) => item.status === "fulfilled" ? [item.value as AggregatorQuote] : [])
        .sort((a, b) => a.amountOutRaw > b.amountOutRaw ? -1 : a.amountOutRaw < b.amountOutRaw ? 1 : 0);
      const best = liveQuotes[0];
      if (!best) {
        throw new Error("No integrated route returned a live quote for this pair.");
      }

      setQuote(best);
      setRoutes([
        routePreviewFor("XyloNet", liveQuotes, settled[0]),
        routePreviewFor("Synthra", liveQuotes, settled[1])
      ]);
    } catch (error) {
      if (requestId !== quoteRequestId.current) return;
      const message = error instanceof Error ? error.message : "Quote failed";
      setQuote(null);
      setRoutes([
        {venue: "XyloNet", status: "unavailable", message: "No live route for this pair."},
        {venue: "Synthra", status: "unavailable", message: "No live route for this pair."}
      ]);
      setStatus(message);
    } finally {
      if (requestId === quoteRequestId.current) setLoading(false);
    }
  }

  async function swap() {
    if (!quote) return;
    setExecuting(true);
    setSwapStep("approve");
    setStatus("Approve if needed, then confirm the swap in your wallet.");
    setTxHash(null);
    try {
      window.setTimeout(() => setSwapStep((step) => step === "approve" ? "swap" : step), 900);
      const result = quote.venue === "XyloNet"
        ? await executeXyloNetSwap({quote, slippageBps: Number(slippageBps)})
        : await executeSynthraSwap({quote, slippageBps: Number(slippageBps)});
      setTxHash(result.swapHash);
      setSwapStep("confirmed");
      setStatus(`Swap submitted through ${quote.venue}.`);
    } catch (error) {
      setSwapStep("idle");
      setStatus(error instanceof Error ? error.message : "Swap failed");
    } finally {
      setExecuting(false);
    }
  }

  function setAmountFromBalance(multiplier: number) {
    if (!balance || !Number.isFinite(balanceNumber) || balanceNumber <= 0) return;
    setAmount(trimTokenAmount(String(balanceNumber * multiplier)));
    resetQuote();
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="DEX aggregator"
        title="Swap on Arc"
        description="Preview integrated Arc liquidity venues and execute the best verified route from your wallet."
      />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,540px)_1fr]">
        <div className="panel space-y-5">
          <SwapBox
            label="You pay"
            amount={amount}
            token={tokenIn}
            balance={balance?.token === tokenIn ? balance.formatted : null}
            balanceLoading={balanceLoading}
            onHalf={() => setAmountFromBalance(0.5)}
            onMax={() => setAmountFromBalance(1)}
            onAmountChange={(value) => {
              setAmount(value);
              resetQuote();
            }}
            onTokenChange={updateTokenIn}
          />

          <div className="flex justify-center">
            <button type="button" className="secondary-button h-12 min-h-12 w-12 rounded-full p-0 transition-all duration-200 hover:rotate-180 hover:scale-110" onClick={flipPair} aria-label="Flip swap pair">
              <ArrowDownUp size={19} />
            </button>
          </div>

          <SwapBox
            label="You receive"
            amount={quote?.amountOut ?? ""}
            token={tokenOut}
            onAmountChange={() => undefined}
            onTokenChange={updateTokenOut}
            readOnly
            placeholder="0.00"
          />

          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <label className="grid gap-2.5 text-sm font-semibold text-slate-300">
              Slippage
              <select className="field bg-slate-950 text-white" value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)}>
                <option value="50">0.5%</option>
                <option value="100">1%</option>
                <option value="300">3%</option>
              </select>
            </label>
            <div className="surface flex flex-col justify-center px-4 py-3.5 text-sm">
              <span className="font-semibold text-slate-400">Network</span>
              <span className={onArc ? "font-bold text-mint drop-shadow-[0_0_8px_rgba(110,231,183,0.4)]" : "font-bold text-orchid"}>{onArc ? "Arc Testnet" : "Switch needed"}</span>
            </div>
          </div>

          {!onArc ? (
            <button type="button" className="action-button min-h-12 w-full" onClick={() => void switchToArc()}>
              Switch to Arc
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[56px_1fr]">
              <button type="button" className="secondary-button min-h-12 px-0 transition-all duration-200 hover:rotate-180" onClick={() => void refreshQuote()} disabled={loading || !isConnected} aria-label="Refresh quote">
                <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
              </button>
              <button type="button" className="action-button min-h-12" onClick={() => void swap()} disabled={swapDisabled}>
                {executing ? swapButtonLabel(swapStep) : quote ? `Swap through ${quote.venue}` : "Swap"}
              </button>
            </div>
          )}

          {quote ? (
            <div className="rounded-xl border border-mint/30 bg-gradient-to-br from-mint/15 to-mint/5 p-5 text-sm shadow-[0_0_24px_rgba(110,231,183,0.15)]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-300">Best route</span>
                <span className="font-bold text-white">{quote.venue}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-300">Minimum received</span>
                <span className="font-bold text-white">{minReceived} {quote.tokenOut}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-300">Router</span>
                <span className="font-bold text-white">{shortAddress(quote.router)}</span>
              </div>
              {quote.venue === "Synthra" ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-300">Fee tier</span>
                  <span className="font-bold text-white">{quote.feeTier / 10_000}%</span>
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-300">Price impact</span>
                <span className="font-bold text-white">Protected by slippage</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-semibold text-slate-300">Nexora swap fee</span>
                <span className="font-bold text-white">{feeEnabled ? `${feeAmount.toFixed(6)} ${tokenIn}` : "0.00 USDC"}</span>
              </div>
              {!feeEnabled ? (
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Swap fee capture is disabled until a verified router fee path is configured.
                </p>
              ) : null}
            </div>
          ) : null}

          {executing || swapStep === "confirmed" ? (
            <div className="grid gap-2.5 rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] p-5 text-sm backdrop-blur-sm">
              {[
                ["Approval", swapStep === "approve" ? "Pending" : "Ready"],
                ["Swap", swapStep === "swap" ? "Pending" : swapStep === "confirmed" ? "Submitted" : "Waiting"],
                ["Receipt", txHash ? "Available" : "Pending"]
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-400">{label}</span>
                  <span className={value === "Pending" ? "font-bold text-orchid" : value === "Available" || value === "Submitted" || value === "Ready" ? "font-bold text-mint drop-shadow-[0_0_8px_rgba(110,231,183,0.4)]" : "font-semibold text-slate-500"}>{value}</span>
                </div>
              ))}
            </div>
          ) : null}

          {txHash ? (
            <a className="secondary-button min-h-10 justify-center text-sm" href={`${arcTestnet.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">
              View transaction <ExternalLink size={16} />
            </a>
          ) : null}

          {status ? <p className="break-words rounded-xl border border-white/[0.1] bg-gradient-to-br from-white/[0.08] to-white/[0.04] p-4 text-sm font-medium text-slate-300 shadow-inner backdrop-blur-sm">{status}</p> : null}
        </div>

        <div className="panel">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-400">Route comparison</p>
              <h2 className="mt-1 text-xl font-bold text-white">Best available price</h2>
            </div>
            {quote ? <CheckCircle2 className="text-mint drop-shadow-[0_0_12px_rgba(110,231,183,0.5)]" size={24} /> : null}
          </div>

          <div className="grid gap-3">
            {routes.filter((route) => route.status !== "unavailable").map((route) => (
              <div key={route.venue} className="surface p-5 transition-all duration-200 hover:scale-[1.01]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">{route.venue}</p>
                    <p className="mt-1.5 text-sm font-medium text-slate-400">{route.message}</p>
                  </div>
                  <RouteStatus status={route.status} />
                </div>
                {route.output ? (
                  <div className="mt-4 rounded-xl bg-slate-950/70 px-4 py-3 text-sm font-medium text-slate-300 backdrop-blur-sm">
                    Output: <span className="font-bold text-white">{route.output} {tokenOut}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SwapBox(props: {
  label: string;
  amount: string;
  token: XyloNetSwapToken;
  onAmountChange: (value: string) => void;
  onTokenChange: (value: XyloNetSwapToken) => void;
  balance?: string | null;
  balanceLoading?: boolean;
  onHalf?: () => void;
  onMax?: () => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2.5 text-sm font-semibold text-slate-300">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span>{props.label}</span>
        {props.balance !== undefined ? (
          <span className="flex items-center gap-2 text-xs font-medium text-slate-400">
            Balance: <b className="text-white">{props.balanceLoading ? "..." : props.balance ?? "0"} {props.token}</b>
            {!props.readOnly ? (
              <>
                <button type="button" className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-slate-300 transition hover:border-white/[0.18] hover:text-white" onClick={props.onHalf}>50%</button>
                <button type="button" className="rounded-md border border-mint/25 bg-mint/10 px-2 py-1 text-[11px] text-mint transition hover:border-mint/45" onClick={props.onMax}>Max</button>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      <div className="grid min-w-0 gap-3 rounded-xl border border-white/[0.12] bg-gradient-to-br from-slate-950/90 to-slate-950/70 p-4 shadow-inner backdrop-blur-sm sm:grid-cols-[minmax(0,1fr)_minmax(116px,140px)]">
        <input
          className="min-h-12 min-w-0 bg-transparent text-2xl font-bold text-white outline-none placeholder:text-slate-600 sm:text-3xl"
          value={props.amount}
          onChange={(event) => props.onAmountChange(event.target.value)}
          inputMode="decimal"
          readOnly={props.readOnly}
          placeholder={props.placeholder}
        />
        <select className="field w-full min-w-0 bg-slate-900 text-white" value={props.token} onChange={(event) => props.onTokenChange(event.target.value as XyloNetSwapToken)}>
          {tokens.map((token) => <option key={token} value={token}>{token}</option>)}
        </select>
      </div>
    </label>
  );
}

function RouteStatus({status}: {status: RoutePreview["status"]}) {
  const labels = {
    best: "Best",
    available: "Live",
    unavailable: "No route",
    error: "Error"
  };
  const colors = {
    best: "border-mint/35 bg-gradient-to-br from-mint/15 to-mint/10 text-mint shadow-[0_0_16px_rgba(110,231,183,0.2)]",
    available: "border-cyan/35 bg-gradient-to-br from-cyan/15 to-cyan/10 text-cyan shadow-[0_0_16px_rgba(125,211,252,0.2)]",
    unavailable: "border-white/[0.1] bg-gradient-to-br from-white/[0.06] to-white/[0.03] text-slate-400",
    error: "border-magenta/35 bg-gradient-to-br from-magenta/15 to-magenta/10 text-magenta shadow-[0_0_16px_rgba(236,72,153,0.2)]"
  };
  return <span className={`rounded-full border px-4 py-1.5 text-xs font-bold ${colors[status]}`}>{labels[status]}</span>;
}

function defaultRoutes(): RoutePreview[] {
  return [
    {venue: "XyloNet", status: "available", message: "Live quotes for verified USDC to EURC/USYC pools."},
    {venue: "Synthra", status: "available", message: "Live quotes for verified USDC to EURC pools."}
  ];
}

function unavailableRoutes(message: string): RoutePreview[] {
  return [
    {venue: "XyloNet", status: "unavailable", message},
    {venue: "Synthra", status: "unavailable", message: "No live route for this pair."}
  ];
}

function routePreviewFor(
  venue: "XyloNet" | "Synthra",
  liveQuotes: AggregatorQuote[],
  result: PromiseSettledResult<AggregatorQuote>
): RoutePreview {
  if (result.status === "fulfilled") {
    const isBest = liveQuotes[0]?.venue === venue;
    const quote = result.value;
    const detail = quote.venue === "XyloNet"
      ? `Live route through ${shortAddress(quote.pool)}`
      : `Live route through ${quote.feeTier / 10_000}% fee tier`;
    return {
      venue,
      status: isBest ? "best" : "available",
      output: quote.amountOut,
      message: isBest ? `Best ${detail.toLowerCase()}` : detail
    };
  }
  return {venue, status: "unavailable", message: "No live route for this pair."};
}

function swapButtonLabel(step: "idle" | "approve" | "swap" | "confirmed") {
  if (step === "approve") return "Waiting for approval...";
  if (step === "swap") return "Waiting for swap...";
  if (step === "confirmed") return "Submitted";
  return "Swapping...";
}

function trimTokenAmount(value: string) {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d{1,6})\d+$/, "$1").replace(/\.?0+$/, "");
}
