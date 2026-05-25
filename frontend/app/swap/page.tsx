import {useMemo, useState} from "react";
import {ArrowDownUp, CheckCircle2, ExternalLink, RefreshCw} from "lucide-react";
import {formatUnits} from "viem";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {arcTestnet, shortAddress, switchToArc} from "@/lib/arc";
import {
  executeXyloNetSwap,
  isXyloNetRouteSupported,
  quoteSynthraSwap,
  quoteXyloNetSwap,
  type SynthraSwapQuote,
  type XyloNetSwapQuote,
  type XyloNetSwapToken,
  xylonet,
  xylonetSwapTokens
} from "@/lib/contracts";

const tokens = Object.keys(xylonetSwapTokens) as XyloNetSwapToken[];
const routeVenues = ["XyloNet", "Synthra", "UnitFlow"] as const;

type RoutePreview = {
  venue: typeof routeVenues[number];
  status: "best" | "available" | "unavailable" | "error";
  output?: string;
  message: string;
};

type AggregatorQuote = XyloNetSwapQuote | SynthraSwapQuote;

export default function SwapPage() {
  const {chain, isConnected} = useAccount();
  const [amount, setAmount] = useState("1");
  const [tokenIn, setTokenIn] = useState<XyloNetSwapToken>("USDC");
  const [tokenOut, setTokenOut] = useState<XyloNetSwapToken>("EURC");
  const [slippageBps, setSlippageBps] = useState("100");
  const [quote, setQuote] = useState<AggregatorQuote | null>(null);
  const [routes, setRoutes] = useState<RoutePreview[]>(defaultRoutes());
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const onArc = chain?.id === arcTestnet.id;
  const amountNumber = Number(amount);
  const routeSupported = isXyloNetRouteSupported(tokenIn, tokenOut);
  const minReceived = useMemo(() => {
    if (!quote) return "0.00";
    const minRaw = quote.amountOutRaw * BigInt(10_000 - Number(slippageBps)) / 10_000n;
    return formatUnits(minRaw, xylonetSwapTokens[quote.tokenOut].decimals);
  }, [quote, slippageBps]);

  function resetQuote() {
    setQuote(null);
    setTxHash(null);
    setRoutes(defaultRoutes());
  }

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

  async function getQuote() {
    setStatus("");
    setTxHash(null);
    if (!isConnected) {
      setStatus("Connect your wallet to preview routes.");
      return;
    }
    if (!onArc) {
      setStatus("Switch to Arc Testnet to use XyloNet routes.");
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setStatus("Enter an amount greater than zero.");
      return;
    }
    if (tokenIn === tokenOut) {
      setStatus("Choose two different assets.");
      return;
    }
    if (!routeSupported) {
      setRoutes(unavailableRoutes(`${tokenIn} to ${tokenOut} is not available on XyloNet yet.`));
      setStatus("This pair is not available through the verified XyloNet pools yet.");
      return;
    }

    setLoading(true);
    try {
      const settled: [PromiseSettledResult<XyloNetSwapQuote>, PromiseSettledResult<SynthraSwapQuote>] = await Promise.allSettled([
        quoteXyloNetSwap({tokenIn, tokenOut, amountIn: amount}),
        quoteSynthraSwap({tokenIn, tokenOut, amountIn: amount})
      ]);
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
        routePreviewFor("Synthra", liveQuotes, settled[1]),
        {venue: "UnitFlow", status: "unavailable", message: "Pending universal-router quote integration."}
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quote failed";
      setQuote(null);
      setRoutes([
        {venue: "XyloNet", status: "error", message},
        {venue: "Synthra", status: "unavailable", message: "Pending verified quote integration."},
        {venue: "UnitFlow", status: "unavailable", message: "Pending universal-router quote integration."}
      ]);
      setStatus(message);
    } finally {
      setLoading(false);
    }
  }

  async function swap() {
    if (!quote) return;
    setExecuting(true);
    setStatus("Approve the router, then confirm the swap in your wallet.");
    setTxHash(null);
    try {
      if (quote.venue !== "XyloNet") {
        setStatus("Synthra is quoting live, but execution is not enabled until its UniversalRouter approval path is verified.");
        return;
      }
      const result = await executeXyloNetSwap({quote, slippageBps: Number(slippageBps)});
      setTxHash(result.swapHash);
      setStatus("Swap submitted through XyloNet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Swap failed");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="DEX aggregator"
        title="Swap on Arc"
        description="Preview integrated Arc liquidity venues and execute the best verified route from your wallet."
      />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,520px)_1fr]">
        <div className="panel space-y-4">
          <SwapBox
            label="You pay"
            amount={amount}
            token={tokenIn}
            onAmountChange={(value) => {
              setAmount(value);
              resetQuote();
            }}
            onTokenChange={updateTokenIn}
          />

          <div className="flex justify-center">
            <button type="button" className="secondary-button h-11 min-h-11 w-11 rounded-full p-0" onClick={flipPair} aria-label="Flip swap pair">
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
            placeholder="0.00"
          />

          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <label className="grid gap-2 text-sm text-slate-300">
              Slippage
              <select className="field bg-slate-950 text-white" value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)}>
                <option value="50">0.5%</option>
                <option value="100">1%</option>
                <option value="300">3%</option>
              </select>
            </label>
            <div className="surface flex flex-col justify-center px-4 py-3 text-sm">
              <span className="text-slate-400">Network</span>
              <span className={onArc ? "text-mint" : "text-orchid"}>{onArc ? "Arc Testnet" : "Switch needed"}</span>
            </div>
          </div>

          {!onArc ? (
            <button type="button" className="action-button min-h-12 w-full" onClick={() => void switchToArc()}>
              Switch to Arc
            </button>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" className="secondary-button min-h-12" onClick={() => void getQuote()} disabled={loading || !isConnected}>
                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                Quote
              </button>
              <button type="button" className="action-button min-h-12" onClick={() => void swap()} disabled={!quote || executing}>
                {executing ? "Swapping..." : "Swap"}
              </button>
            </div>
          )}

          {quote ? (
            <div className="rounded-lg border border-mint/20 bg-mint/10 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Best route</span>
                <span className="font-medium text-white">{quote.venue}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-slate-300">Minimum received</span>
                <span className="font-medium text-white">{minReceived} {quote.tokenOut}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-slate-300">Router</span>
                <span className="font-medium text-white">{shortAddress(quote.router)}</span>
              </div>
              {quote.venue === "Synthra" ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-slate-300">Fee tier</span>
                  <span className="font-medium text-white">{quote.feeTier / 10_000}%</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {txHash ? (
            <a className="secondary-button min-h-10 justify-center text-sm" href={`${arcTestnet.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">
              View transaction <ExternalLink size={15} />
            </a>
          ) : null}

          {status ? <p className="break-words rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
        </div>

        <div className="panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Route comparison</p>
              <h2 className="text-xl font-semibold text-white">Best available price</h2>
            </div>
            {quote ? <CheckCircle2 className="text-mint" size={22} /> : null}
          </div>

          <div className="grid gap-3">
            {routes.map((route) => (
              <div key={route.venue} className="surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{route.venue}</p>
                    <p className="mt-1 text-sm text-slate-400">{route.message}</p>
                  </div>
                  <RouteStatus status={route.status} />
                </div>
                {route.output ? (
                  <div className="mt-3 rounded-md bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                    Output: <span className="font-medium text-white">{route.output} {tokenOut}</span>
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
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2 text-sm text-slate-300">
      {props.label}
      <div className="grid gap-3 rounded-lg border border-white/[0.08] bg-slate-950/70 p-3 sm:grid-cols-[1fr_132px]">
        <input
          className="min-h-12 bg-transparent text-3xl font-semibold text-white outline-none placeholder:text-slate-600"
          value={props.amount}
          onChange={(event) => props.onAmountChange(event.target.value)}
          inputMode="decimal"
          readOnly={props.readOnly}
          placeholder={props.placeholder}
        />
        <select className="field bg-slate-900 text-white" value={props.token} onChange={(event) => props.onTokenChange(event.target.value as XyloNetSwapToken)}>
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
    unavailable: "Pending",
    error: "Error"
  };
  const colors = {
    best: "border-mint/30 bg-mint/10 text-mint",
    available: "border-sky/30 bg-sky/10 text-sky",
    unavailable: "border-white/[0.08] bg-white/[0.04] text-slate-400",
    error: "border-magenta/30 bg-magenta/10 text-magenta"
  };
  return <span className={`rounded-full border px-3 py-1 text-xs font-medium ${colors[status]}`}>{labels[status]}</span>;
}

function defaultRoutes(): RoutePreview[] {
  return [
    {venue: "XyloNet", status: "available", message: "Live quotes for verified USDC to EURC/USYC pools."},
    {venue: "Synthra", status: "unavailable", message: "Pending verified quote integration."},
    {venue: "UnitFlow", status: "unavailable", message: "Pending universal-router quote integration."}
  ];
}

function unavailableRoutes(message: string): RoutePreview[] {
  return [
    {venue: "XyloNet", status: "unavailable", message},
    {venue: "Synthra", status: "unavailable", message: "Pending verified quote integration."},
    {venue: "UnitFlow", status: "unavailable", message: "Pending universal-router quote integration."}
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
  const message = result.reason instanceof Error ? result.reason.message : "Route unavailable.";
  return {venue, status: "unavailable", message};
}
