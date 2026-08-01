import {useMemo, useState} from "react";
import {Cpu, Loader2, ReceiptText, Route, ShieldCheck, Wallet} from "lucide-react";
import toast from "react-hot-toast";
import {formatUnits} from "viem";
import {BotchainPaymentPanel} from "@/components/BotchainPaymentPanel";
import {JsonViewer, type JsonStatus} from "@/components/JsonViewer";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {apiPost} from "@/lib/api";
import {configuredBotChain} from "@/lib/arc";
import {botchainMeridian} from "@/lib/permit2";
import {userFacingPaymentError} from "@/lib/user-errors";

type VComputeQuote = {
  network: "bot-chain-testnet" | "bot-chain";
  chainId: number;
  serviceId: string;
  job: {type: string; units: number; provider: string; providerConfigured: boolean};
  pricing: {asset: string; unitPrice: number; amountBaseUnits: string; marketplaceFeeBps: number};
  policy: {maxUnitsPerRequest: number; requireServiceAllowlist: boolean; serviceId: string};
  paymentRequirements: Record<string, unknown>;
};

export default function BotchainPage() {
  const chain = configuredBotChain();
  const mainnet = botchainMeridian.network === "bot-chain";
  const feePercent = botchainMeridian.marketplaceFeeBps / 100;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="BOT Chain commerce"
        title="Policy-controlled USDT payments from BOT EOAs"
        description="Use a connected or self-hosted EOA to authorize Permit2 payments through Meridian. Nexora reserves policy spend before settlement, records receipts and reputation after settlement, and attributes the seller through Meridian Marketplace."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatMetric variant="panel" icon={Route} label="Configured chain ID" value={chain.id} />
        <StatMetric variant="panel" icon={Wallet} label="Payment routes" value={1} suffix=" Meridian" />
        <StatMetric variant="panel" icon={ReceiptText} label="Meridian Marketplace fee" value={feePercent} suffix="%" decimals={2} accent />
      </div>

      <section className={`panel ${mainnet ? "border-amber/25 bg-amber/5" : "border-cyan/20 bg-cyan/5"}`}>
        <div className="flex items-start gap-3">
          <ShieldCheck size={19} className={mainnet ? "mt-0.5 text-amber" : "mt-0.5 text-cyan"} />
          <div>
            <p className={`font-semibold ${mainnet ? "text-amber" : "text-cyan"}`}>
              {mainnet ? "BOT Chain mainnet is enabled" : "BOT Chain testnet is enabled"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Chain ID {chain.id}. This route uses an external EOA signer, not a Circle Agent Wallet.
              {mainnet ? " Payments use real USDT and require explicit confirmation." : " Payments use testnet USDT."}
            </p>
          </div>
        </div>
      </section>

      <BotchainPaymentPanel />
      <VComputeQuotePanel />
    </div>
  );
}

function VComputeQuotePanel() {
  const [jobType, setJobType] = useState("inference");
  const [units, setUnits] = useState("100");
  const [provider, setProvider] = useState("");
  const [quote, setQuote] = useState<VComputeQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const status = useMemo<JsonStatus | undefined>(
    () => quote ? {label: "Quote ready", tone: "ok"} : undefined,
    [quote]
  );

  async function createQuote() {
    const parsedUnits = Number(units);
    if (!Number.isSafeInteger(parsedUnits) || parsedUnits <= 0) {
      toast.error("Compute units must be a positive whole number.");
      return;
    }
    setLoading(true);
    try {
      const result = await apiPost<VComputeQuote>("/api/botchain/vcompute/quote", {
        network: botchainMeridian.network,
        jobType: jobType.trim().toLowerCase(),
        units: parsedUnits,
        provider: provider.trim() || undefined
      });
      setQuote(result);
      toast.success("vCompute payment requirements created.");
    } catch (error) {
      setQuote(null);
      toast.error(userFacingPaymentError(error, "Nexora could not create the vCompute quote."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">vCompute adapter</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Create policy-bound compute payment requirements</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Price inference, GPU, data-processing, or verification jobs by compute unit. The returned service ID can be allowlisted and the unit count maps directly to the policy’s maximum units per request.
          </p>
        </div>
        <Cpu size={22} className="text-orchid" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_140px_1.4fr_auto] md:items-end">
        <label className="grid gap-2 text-xs font-semibold text-slate-300">
          Job type
          <select value={jobType} onChange={(event) => setJobType(event.target.value)} className="field">
            <option value="inference">Inference</option>
            <option value="gpu-render">GPU render</option>
            <option value="data-processing">Data processing</option>
            <option value="verification">Verification</option>
          </select>
        </label>
        <label className="grid gap-2 text-xs font-semibold text-slate-300">
          Compute units
          <input value={units} onChange={(event) => setUnits(event.target.value)} inputMode="numeric" className="field" />
        </label>
        <label className="grid gap-2 text-xs font-semibold text-slate-300">
          Provider endpoint
          <input
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="Optional provider URL or identifier"
            className="field"
          />
        </label>
        <button type="button" onClick={() => void createQuote()} disabled={loading} className="action-button min-h-12">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Cpu size={16} />}
          Build quote
        </button>
      </div>

      {quote ? (
        <div className="mt-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <QuoteMetric label="Amount" value={`${formatUnits(BigInt(quote.pricing.amountBaseUnits), botchainMeridian.usdtDecimals)} ${quote.pricing.asset}`} />
            <QuoteMetric label="Max policy units" value={String(quote.policy.maxUnitsPerRequest)} />
            <QuoteMetric label="Marketplace fee" value={`${(quote.pricing.marketplaceFeeBps / 100).toFixed(2)}%`} />
          </div>
          <JsonViewer title="vCompute x402 requirements" code={JSON.stringify(quote, null, 2)} status={status} />
        </div>
      ) : null}
    </section>
  );
}

function QuoteMetric({label, value}: {label: string; value: string}) {
  return (
    <div className="surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
