import {useMemo, useState} from "react";
import {Bot, CheckCircle2, ExternalLink, Loader2, ReceiptText, Route, ShieldCheck, Wallet} from "lucide-react";
import toast from "react-hot-toast";
import {formatUnits, parseUnits} from "viem";
import {useAccount} from "wagmi";
import {BotchainPaymentPanel} from "@/components/BotchainPaymentPanel";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {botChainTestnetWagmiChain, shortAddress, switchToChain} from "@/lib/arc";
import {contractAddressesForChain, isNexoraContractChain, readX402MarketplaceService, settleX402Request, writeAgentPolicy} from "@/lib/contracts";
import {userFacingPaymentError} from "@/lib/user-errors";

type BotService = Awaited<ReturnType<typeof readX402MarketplaceService>>;

export default function BotchainPage() {
  const {address, chain, isConnected} = useAccount();
  const contracts = useMemo(() => contractAddressesForChain(botChainTestnetWagmiChain.id), []);
  const commerceConfigured = isNexoraContractChain(botChainTestnetWagmiChain.id);
  const [dailyLimit, setDailyLimit] = useState("20");
  const [transactionCap, setTransactionCap] = useState("5");
  const [weeklyLimit, setWeeklyLimit] = useState("100");
  const [monthlyLimit, setMonthlyLimit] = useState("300");
  const [cooldownSeconds, setCooldownSeconds] = useState("0");
  const [serviceId, setServiceId] = useState("1");
  const [units, setUnits] = useState("1");
  const [service, setService] = useState<BotService | null>(null);
  const [loadingService, setLoadingService] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  const grossAmount = useMemo(() => {
    if (!service) return "0";
    try {
      return formatUnits(parseUnits(service.pricePerUnitUsdc, 6) * BigInt(Math.max(1, Number(units) || 1)), 6);
    } catch {
      return "0";
    }
  }, [service, units]);

  async function ensureBotChain() {
    if (chain?.id !== botChainTestnetWagmiChain.id) await switchToChain(botChainTestnetWagmiChain);
  }

  async function loadService() {
    const parsedId = Number(serviceId);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
      toast.error("Enter a valid BOT Marketplace service id.");
      return;
    }
    setLoadingService(true);
    try {
      const result = await readX402MarketplaceService({chainId: botChainTestnetWagmiChain.id, chainServiceId: parsedId});
      if (!result.active || /^0x0{40}$/i.test(result.publisher)) throw new Error("This BOT Marketplace service is not active.");
      setService(result);
      toast.success("BOT Marketplace service loaded.");
    } catch (error) {
      setService(null);
      toast.error(userFacingPaymentError(error, "The BOT Marketplace service could not be loaded."));
    } finally {
      setLoadingService(false);
    }
  }

  async function savePolicy() {
    if (!isConnected || !address) {
      toast.error("Connect the BOT EOA wallet that will make purchases.");
      return;
    }
    if (!commerceConfigured) {
      toast.error("The Nexora BOT commerce contracts are not configured yet.");
      return;
    }
    if (!contracts.x402Ledger) {
      toast.error("The Nexora BOT ledger address is missing.");
      return;
    }
    if (!service) {
      toast.error("Load the BOT Marketplace service before creating its allowlist policy.");
      return;
    }
    setSavingPolicy(true);
    const toastId = toast.loading("Saving the connected-wallet BOT policy…");
    try {
      await ensureBotChain();
      await writeAgentPolicy({
        agentWallet: address,
        operatorAddress: address,
        arcName: `bot-eoa:${address.toLowerCase()}`,
        dailyLimitUsdc: dailyLimit,
        transactionCapUsdc: transactionCap,
        contractAllowlist: [contracts.x402Ledger],
        recipientAllowlist: [service.publisher],
        active: true,
        policyV2: {
          weeklyLimitUsdc: weeklyLimit,
          monthlyLimitUsdc: monthlyLimit,
          maxUnitsPerRequest: units,
          cooldownSeconds,
          serviceAllowlist: [serviceId],
          requireOnchainPolicy: true
        }
      });
      toast.success("BOT spending policy saved on-chain.", {id: toastId});
    } catch (error) {
      toast.error(userFacingPaymentError(error, "The BOT policy could not be saved."), {id: toastId});
    } finally {
      setSavingPolicy(false);
    }
  }

  async function payService() {
    if (!isConnected || !address || !service) {
      toast.error("Connect a wallet and load a BOT Marketplace service first.");
      return;
    }
    const parsedId = Number(serviceId);
    const parsedUnits = Number(units);
    if (!Number.isSafeInteger(parsedUnits) || parsedUnits <= 0) {
      toast.error("Units must be a positive whole number.");
      return;
    }
    setPaying(true);
    const toastId = toast.loading(`Approving and settling ${grossAmount} testnet USDT…`);
    try {
      await ensureBotChain();
      const result = await settleX402Request({
        chainServiceId: parsedId,
        requestHash: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
        payer: address,
        units: parsedUnits,
        amountUsdc: grossAmount
      });
      setLastReceipt(result.settleHash);
      toast.success("BOT Marketplace payment settled under Nexora policy.", {id: toastId});
    } catch (error) {
      toast.error(userFacingPaymentError(error, "The BOT Marketplace payment was blocked or reverted."), {id: toastId});
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="BOT Chain commerce"
        title="Policy-controlled USDT payments for BOT developers and agents"
        description="Use a connected or self-hosted BOT EOA with Nexora policy limits, service allowlists, fee splitting, receipts, and reputation. Circle agent wallets are intentionally not used on BOT Chain."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatMetric variant="panel" icon={Route} label="Payment paths" value={2} />
        <StatMetric variant="panel" icon={ShieldCheck} label="Configured policy contracts" value={commerceConfigured ? 3 : 0} suffix="/3" accent={commerceConfigured} />
        <StatMetric variant="panel" icon={Wallet} label="Connected EOA payment path" value={1} />
      </div>

      {!commerceConfigured ? (
        <section className="panel border-amber/25 bg-amber/5">
          <p className="font-semibold text-amber">BOT policy commerce is awaiting contract configuration.</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">Deploy the minimal BOT suite, then set the policy registry, ledger, and reputation addresses. Meridian remains available below for external x402 resources.</p>
        </section>
      ) : null}

      <section className="panel space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker">Nexora Marketplace · direct ledger</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Buy BOT services under an on-chain spending policy</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">The connected EOA registers itself as the controlled wallet. The ledger checks caps and allowlists before pulling USDT, splits Nexora’s platform fee, and emits the payment receipt.</p>
          </div>
          <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-semibold text-mint">BOT testnet</span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[160px_auto_minmax(0,1fr)] lg:items-end">
          <label className="grid gap-2 text-xs font-semibold text-slate-300">Service id<input value={serviceId} onChange={(event) => { setServiceId(event.target.value); setService(null); }} inputMode="numeric" className="field" /></label>
          <button type="button" onClick={() => void loadService()} disabled={!commerceConfigured || loadingService} className="secondary-button">
            {loadingService ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />} Load service
          </button>
          <div className="surface min-h-12 px-4 py-3 text-sm text-slate-300">
            {service ? <><span className="font-semibold text-white">{service.endpointHash}</span> · {service.pricePerUnitUsdc} USDT/unit · {shortAddress(service.publisher)}</> : "Load a published service to bind its publisher and id into the policy."}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <PolicyField label="Daily limit" value={dailyLimit} onChange={setDailyLimit} suffix="USDT" />
          <PolicyField label="Transaction cap" value={transactionCap} onChange={setTransactionCap} suffix="USDT" />
          <PolicyField label="Weekly limit" value={weeklyLimit} onChange={setWeeklyLimit} suffix="USDT" />
          <PolicyField label="Monthly limit" value={monthlyLimit} onChange={setMonthlyLimit} suffix="USDT" />
          <PolicyField label="Cooldown" value={cooldownSeconds} onChange={setCooldownSeconds} suffix="seconds" />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-end gap-3">
            <PolicyField label="Purchase units" value={units} onChange={setUnits} suffix="units" />
            <div className="pb-2 text-sm text-slate-400">Gross: <span className="font-semibold text-white">{grossAmount} USDT</span></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void savePolicy()} disabled={!service || savingPolicy || !commerceConfigured} className="secondary-button">
              {savingPolicy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Save BOT policy
            </button>
            <button type="button" onClick={() => void payService()} disabled={!service || paying || !commerceConfigured} className="action-button">
              {paying ? <Loader2 size={15} className="animate-spin" /> : <ReceiptText size={15} />} Pay service
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.1] bg-white/[0.03] p-4 text-sm leading-6 text-slate-400">
          To demonstrate a blocked payment, save a transaction cap below the loaded service total and try the purchase. Nexora’s ledger rejects it before funds move.
        </div>

        {lastReceipt ? (
          <a href={`${botChainTestnetWagmiChain.blockExplorers.default.url.replace(/\/$/, "")}/tx/${lastReceipt}`} target="_blank" rel="noreferrer" className="secondary-button w-fit">
            <CheckCircle2 size={15} /> Open on-chain receipt <ExternalLink size={14} />
          </a>
        ) : null}
      </section>

      <BotchainPaymentPanel />
    </div>
  );
}

function PolicyField({label, value, onChange, suffix}: {label: string; value: string; onChange: (value: string) => void; suffix: string}) {
  return (
    <label className="grid min-w-[130px] gap-2 text-xs font-semibold text-slate-300">
      {label}
      <span className="relative block">
        <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="decimal" className="field w-full pr-16" />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] uppercase tracking-wide text-slate-500">{suffix}</span>
      </span>
    </label>
  );
}
