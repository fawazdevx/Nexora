import {useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ArrowDownUp, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2, RefreshCw} from "lucide-react";
import {formatUnits} from "viem";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
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
  xylonetSwapTokens
} from "@/lib/contracts";

const tokens = Object.keys(xylonetSwapTokens) as XyloNetSwapToken[];
const routeVenues = ["XyloNet", "Synthra"] as const;
const swapFeeBps = Number(import.meta.env.VITE_SWAP_FEE_BPS ?? "0");
const swapFeeRecipient = import.meta.env.VITE_SWAP_FEE_RECIPIENT ?? "";
const eurcUsd = Number(import.meta.env.VITE_EURC_USD ?? "1.08") || 1.08;

const SLIPPAGE_PRESETS: Array<[string, string]> = [
  ["0.5%", "50"],
  ["1%", "100"],
  ["3%", "300"]
];

// Anchored USD estimate: USDC/USYC ≈ $1, EURC via configurable EUR/USD rate.
const TOKEN_META: Record<XyloNetSwapToken, {name: string; glyph: string; gradient: string; usd: number}> = {
  USDC: {name: "USD Coin", glyph: "$", gradient: "from-[#2775ca] to-[#1b5fa6]", usd: 1},
  EURC: {name: "Euro Coin", glyph: "€", gradient: "from-[#2f6bff] to-[#4453d6]", usd: eurcUsd},
  USYC: {name: "US Yield Coin", glyph: "%", gradient: "from-mint to-emerald-500", usd: 1}
};

type RoutePreview = {
  venue: typeof routeVenues[number];
  status: "best" | "available" | "quoteOnly" | "unavailable" | "error";
  output?: string;
  message: string;
};

type AggregatorQuote = XyloNetSwapQuote | SynthraSwapQuote;

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
  const exchangeRate = useMemo(() => {
    if (!quote) return null;
    const input = Number(quote.amountIn);
    if (!Number.isFinite(input) || input <= 0) return null;
    return Number(quote.amountOut) / input;
  }, [quote]);
  const balanceNumber = Number(balance?.formatted ?? "0");
  const feeEnabled = Number.isFinite(swapFeeBps) && swapFeeBps > 0 && Boolean(swapFeeRecipient);
  const feeAmount = feeEnabled && Number.isFinite(amountNumber) ? amountNumber * swapFeeBps / 10_000 : 0;
  const visibleRoutes = routes.filter((route) => route.venue);

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
    setTxHash(null);
    const toastId = toast.loading("Approve if needed, then confirm the swap in your wallet…");
    try {
      window.setTimeout(() => setSwapStep((step) => step === "approve" ? "swap" : step), 900);
      const result = quote.venue === "XyloNet"
        ? await executeXyloNetSwap({quote, slippageBps: Number(slippageBps)})
        : await executeSynthraSwap({quote, slippageBps: Number(slippageBps)});
      setTxHash(result.swapHash);
      setSwapStep("confirmed");
      toast.success(txToast(`Swap submitted through ${quote.venue}`, result.swapHash), {id: toastId});
    } catch (error) {
      setSwapStep("idle");
      toast.error(error instanceof Error ? error.message : "Swap failed", {id: toastId});
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
        <div className="panel space-y-4">
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
            <button type="button" className="secondary-button h-11 min-h-11 w-11 rounded-full p-0 transition-all duration-300 hover:rotate-180 hover:scale-110 hover:border-plasma/40" onClick={flipPair} aria-label="Flip swap pair">
              <ArrowDownUp size={18} />
            </button>
          </div>

          <SwapBox
            label="You receive"
            amount={quote?.amountOut ?? ""}
            token={tokenOut}
            onAmountChange={() => undefined}
            onTokenChange={updateTokenOut}
            readOnly
            loading={loading}
            placeholder="0.00"
          />

          {exchangeRate ? (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm">
              <span className="text-slate-400">Rate</span>
              <span className="font-semibold text-white">1 {tokenIn} ≈ {trimTokenAmount(String(exchangeRate))} {tokenOut}</span>
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-300">Max slippage</span>
              <span className={onArc ? "text-xs font-bold text-mint" : "text-xs font-bold text-orchid"}>{onArc ? "Arc Testnet" : "Switch needed"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {SLIPPAGE_PRESETS.map(([label, bps]) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippageBps(bps)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${slippageBps === bps ? "border-plasma/40 bg-gradient-to-br from-plasma/[0.2] to-plasma/[0.08] text-white" : "border-white/[0.1] bg-white/[0.04] text-slate-300 hover:border-plasma/30 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
              <div className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm ${SLIPPAGE_PRESETS.some(([, bps]) => bps === slippageBps) ? "border-white/[0.1] bg-white/[0.04]" : "border-plasma/40 bg-plasma/[0.12]"}`}>
                <input
                  inputMode="decimal"
                  value={(Number(slippageBps) / 100).toString()}
                  onChange={(event) => setSlippageBps(String(Math.max(0, Math.round((Number(event.target.value) || 0) * 100))))}
                  className="w-10 bg-transparent text-right font-semibold text-white outline-none"
                  aria-label="Custom slippage"
                />
                <span className="text-slate-400">%</span>
              </div>
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
                {executing ? <Loader2 size={17} className="animate-spin" /> : null}
                {executing ? swapButtonLabel(swapStep) : quote ? `Swap through ${quote.venue}` : "No executable route"}
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
                <span className="font-bold text-white">{trimTokenAmount(minReceived)} {quote.tokenOut}</span>
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
                <span className="font-semibold text-slate-300">Slippage protection</span>
                <span className="font-bold text-white">{Number(slippageBps) / 100}% max</span>
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

          {!isConnected ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-6 py-12 text-center">
              <p className="max-w-xs text-sm leading-6 text-slate-400">Connect your wallet on Arc Testnet to preview live routes across integrated venues.</p>
            </div>
          ) : loading ? (
            <div className="grid gap-3">
              {routeVenues.map((venue) => (
                <div key={venue} className="surface p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-2">
                      <div className="shimmer h-4 w-24 rounded" />
                      <div className="shimmer h-3 w-40 rounded" />
                    </div>
                    <div className="shimmer h-6 w-14 rounded-full" />
                  </div>
                  <div className="shimmer mt-4 h-9 w-full rounded-xl" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3">
              {visibleRoutes.map((route) => {
                const dim = route.status === "unavailable" || route.status === "error";
                return (
                  <div key={route.venue} className={`surface p-5 transition-all duration-200 ${dim ? "opacity-60" : "hover:scale-[1.01]"}`}>
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
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TokenBadge({token, size = 24}: {token: XyloNetSwapToken; size?: number}) {
  const meta = TOKEN_META[token];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${meta.gradient} font-bold text-white shadow-[0_0_12px_rgba(0,0,0,0.3)]`}
      style={{width: size, height: size, fontSize: size * 0.5}}
      aria-hidden="true"
    >
      {meta.glyph}
    </span>
  );
}

function TokenPicker({value, onChange}: {value: XyloNetSwapToken; onChange: (value: XyloNetSwapToken) => void}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{top: number; left: number} | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const MENU_WIDTH = 224; // w-56

  function place() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setCoords({top: rect.bottom + 8, left});
  }

  function toggle() {
    if (!open) place();
    setOpen((current) => !current);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.06] py-1.5 pl-1.5 pr-2.5 transition hover:border-plasma/40 hover:bg-white/[0.1]"
      >
        <TokenBadge token={value} size={26} />
        <span className="font-bold text-white">{value}</span>
        <ChevronDown size={15} className={`text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={menuRef}
              style={{top: coords.top, left: coords.left, width: MENU_WIDTH}}
              className="fixed z-[80] overflow-hidden rounded-xl border border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
            >
              {tokens.map((token) => {
                const active = token === value;
                return (
                  <button
                    key={token}
                    type="button"
                    onClick={() => {
                      onChange(token);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${active ? "bg-plasma/15" : "hover:bg-white/[0.05]"}`}
                  >
                    <TokenBadge token={token} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white">{token}</p>
                      <p className="truncate text-xs text-slate-500">{TOKEN_META[token].name}</p>
                    </div>
                    {active ? <Check size={15} className="text-mint" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
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
  loading?: boolean;
  placeholder?: string;
}) {
  const usd = Number(props.amount) * TOKEN_META[props.token].usd;
  const showUsd = Number.isFinite(usd) && usd > 0;
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
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/[0.12] bg-gradient-to-br from-slate-950/90 to-slate-950/70 p-4 shadow-inner backdrop-blur-sm">
        <div className="min-w-0">
          {props.readOnly && props.loading ? (
            <div className="shimmer h-9 w-32 rounded-lg" />
          ) : (
            <input
              className="min-h-9 w-full min-w-0 bg-transparent text-2xl font-bold text-white outline-none placeholder:text-slate-600 sm:text-3xl"
              value={props.amount}
              onChange={(event) => props.onAmountChange(event.target.value)}
              inputMode="decimal"
              readOnly={props.readOnly}
              placeholder={props.placeholder}
            />
          )}
          <p className="mt-1 h-4 text-xs font-medium text-slate-500">{showUsd ? `≈ $${usd.toFixed(2)}` : ""}</p>
        </div>
        <TokenPicker value={props.token} onChange={props.onTokenChange} />
      </div>
    </label>
  );
}

function RouteStatus({status}: {status: RoutePreview["status"]}) {
  const labels = {
    best: "Best",
    available: "Live",
    quoteOnly: "Quote only",
    unavailable: "No route",
    error: "Error"
  };
  const colors = {
    best: "border-mint/35 bg-gradient-to-br from-mint/15 to-mint/10 text-mint shadow-[0_0_16px_rgba(110,231,183,0.2)]",
    available: "border-cyan/35 bg-gradient-to-br from-cyan/15 to-cyan/10 text-cyan shadow-[0_0_16px_rgba(125,211,252,0.2)]",
    quoteOnly: "border-amber-300/35 bg-gradient-to-br from-amber-300/15 to-amber-300/10 text-amber-200 shadow-[0_0_16px_rgba(252,211,77,0.14)]",
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
      : `SDK route through ${quote.feeTier / 10_000}% fee tier`;
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
