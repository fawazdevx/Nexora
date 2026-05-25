import {useEffect, useMemo, useState} from "react";
import {ArrowRightLeft, Info, RefreshCw} from "lucide-react";
import {createPublicClient, formatUnits, http, parseUnits, type Address} from "viem";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {arcTestnet, shortAddress} from "@/lib/arc";

const XYLONET_ROUTER = "0x73742278c31a76dBb0D2587d03ef92E6E2141023" as const;
const ARC_CHAIN_ID = 5042002;

const tokens = [
  {symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6},
  {symbol: "EURC", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6},
  {symbol: "USYC", address: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C", decimals: 6}
] as const;

const pools = [
  {tokenA: "USDC", tokenB: "EURC", address: "0x3DF3966F5138143dce7a9cFDdC2c0310ce083BB1"},
  {tokenA: "USDC", tokenB: "USYC", address: "0x8296cC7477A9CD12cF632042fDDc2aB89151bb61"}
] as const;

const routerAbi = [
  {
    type: "function",
    name: "getAmountOut",
    stateMutability: "view",
    inputs: [
      {name: "pool", type: "address"},
      {name: "tokenIn", type: "address"},
      {name: "tokenOut", type: "address"},
      {name: "amountIn", type: "uint256"}
    ],
    outputs: [{name: "amountOut", type: "uint256"}]
  }
] as const;

type Quote = {
  venue: string;
  status: "ready" | "unavailable" | "error";
  amountOut?: string;
  rate?: string;
  detail: string;
};

export default function SwapPage() {
  const {chain} = useAccount();
  const [amount, setAmount] = useState("100");
  const [tokenIn, setTokenIn] = useState("USDC");
  const [tokenOut, setTokenOut] = useState("EURC");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const routePool = useMemo(() => findPool(tokenIn, tokenOut), [tokenIn, tokenOut]);
  const canQuote = Number(amount) > 0 && tokenIn !== tokenOut && chain?.id === ARC_CHAIN_ID && Boolean(routePool);

  useEffect(() => {
    void refreshQuotes();
  }, [chain?.id, tokenIn, tokenOut]);

  async function refreshQuotes() {
    setStatus("");
    setQuotes([]);
    if (tokenIn === tokenOut) {
      setStatus("Choose two different assets.");
      return;
    }
    if (chain?.id && chain.id !== ARC_CHAIN_ID) {
      setQuotes(staticUnavailableQuotes("Live swap quotes are currently available on Arc Testnet only."));
      return;
    }
    if (!routePool) {
      setQuotes(staticUnavailableQuotes("No supported pool exists for this pair yet."));
      return;
    }
    if (Number(amount) <= 0) return;

    setLoading(true);
    try {
      const quote = await getXyloNetQuote(amount, tokenIn, tokenOut, routePool.address);
      setQuotes([
        quote,
        {
          venue: "UnitFlow",
          status: "unavailable",
          detail: "UniversalRouter execution details are available, but no quote/quoter endpoint has been integrated yet."
        },
        {
          venue: "Synthra",
          status: "unavailable",
          detail: "Waiting for verified Arc router/quoter contract addresses before enabling quotes."
        }
      ]);
    } catch (error) {
      setQuotes([
        {
          venue: "XyloNet",
          status: "error",
          detail: error instanceof Error ? error.message : "Quote failed"
        },
        ...staticUnavailableQuotes("Quote unavailable until integration details are complete.")
      ]);
    } finally {
      setLoading(false);
    }
  }

  function flipPair() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="DEX aggregator"
        title="Compare stablecoin routes"
        description="Preview routes across integrated Arc liquidity venues before any wallet approval or swap transaction."
      />

      <section className="panel grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto]">
        <label className="grid gap-2 text-sm text-slate-300">
          You pay
          <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Asset
          <select className="field min-w-32 bg-slate-950 text-white" value={tokenIn} onChange={(event) => setTokenIn(event.target.value)}>
            {tokens.map((token) => <option key={token.symbol} value={token.symbol}>{token.symbol}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          You receive
          <select className="field bg-slate-950 text-white" value={tokenOut} onChange={(event) => setTokenOut(event.target.value)}>
            {tokens.map((token) => <option key={token.symbol} value={token.symbol}>{token.symbol}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="button" className="secondary-button min-h-12 px-4" onClick={flipPair} aria-label="Flip pair">
            <ArrowRightLeft size={17} />
          </button>
          <button type="button" className="action-button min-h-12 px-4" onClick={() => void refreshQuotes()} disabled={loading || !canQuote}>
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Quote
          </button>
        </div>
        {status ? <p className="break-all text-sm text-slate-400 lg:col-span-4">{status}</p> : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {quotes.map((quote) => <QuoteCard key={quote.venue} quote={quote} tokenOut={tokenOut} />)}
        {quotes.length === 0 ? (
          <div className="panel lg:col-span-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Info size={16} className="text-orchid" />
              Enter an amount and request a quote. No swap will be executed from this page.
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function QuoteCard({quote, tokenOut}: {quote: Quote; tokenOut: string}) {
  const tone = quote.status === "ready" ? "border-mint/20 bg-mint/10" : quote.status === "error" ? "border-magenta/25 bg-magenta/10" : "border-white/[0.08] bg-white/[0.035]";
  return (
    <article className={`rounded-xl border p-5 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">{quote.venue}</h3>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{quote.status === "ready" ? "Live quote" : quote.status}</p>
        </div>
        <span className="status-pill">{quote.status === "ready" ? "Available" : "Pending"}</span>
      </div>
      {quote.amountOut ? (
        <div className="mt-5">
          <p className="text-3xl font-semibold text-white">{quote.amountOut}</p>
          <p className="mt-1 text-sm text-slate-400">{tokenOut}</p>
          {quote.rate ? <p className="mt-3 text-sm text-mint">Rate {quote.rate}</p> : null}
        </div>
      ) : null}
      <p className="mt-4 text-sm leading-6 text-slate-300">{quote.detail}</p>
    </article>
  );
}

async function getXyloNetQuote(amount: string, tokenInSymbol: string, tokenOutSymbol: string, pool: string): Promise<Quote> {
  const tokenIn = tokenBySymbol(tokenInSymbol);
  const tokenOut = tokenBySymbol(tokenOutSymbol);
  const amountIn = parseUnits(amount || "0", tokenIn.decimals);
  const client = createPublicClient({
    chain: {
      id: arcTestnet.id,
      name: arcTestnet.name,
      nativeCurrency: arcTestnet.nativeCurrency,
      rpcUrls: {default: {http: [arcTestnet.rpcUrl]}},
      blockExplorers: {default: {name: "Arc Explorer", url: arcTestnet.explorerUrl}}
    },
    transport: http(arcTestnet.rpcUrl)
  });
  const amountOut = await client.readContract({
    address: XYLONET_ROUTER,
    abi: routerAbi,
    functionName: "getAmountOut",
    args: [pool as Address, tokenIn.address as Address, tokenOut.address as Address, amountIn]
  });
  const formatted = formatUnits(amountOut, tokenOut.decimals);
  const numericAmount = Number(amount);
  const numericOut = Number(formatted);

  return {
    venue: "XyloNet",
    status: "ready",
    amountOut: trimAmount(formatted),
    rate: numericAmount > 0 && Number.isFinite(numericOut) ? `1 ${tokenIn.symbol} = ${trimAmount(String(numericOut / numericAmount))} ${tokenOut.symbol}` : undefined,
    detail: `Pool ${shortAddress(pool)} via router ${shortAddress(XYLONET_ROUTER)}. Quote only; no approval or swap is submitted.`
  };
}

function staticUnavailableQuotes(detail: string): Quote[] {
  return [
    {venue: "UnitFlow", status: "unavailable", detail},
    {venue: "Synthra", status: "unavailable", detail}
  ];
}

function findPool(tokenIn: string, tokenOut: string) {
  return pools.find((pool) =>
    (pool.tokenA === tokenIn && pool.tokenB === tokenOut) ||
    (pool.tokenA === tokenOut && pool.tokenB === tokenIn)
  );
}

function tokenBySymbol(symbol: string) {
  const token = tokens.find((item) => item.symbol === symbol);
  if (!token) throw new Error(`Unsupported token ${symbol}`);
  return token;
}

function trimAmount(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toLocaleString(undefined, {maximumFractionDigits: 6});
}
