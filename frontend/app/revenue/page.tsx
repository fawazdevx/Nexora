import {useEffect, useState} from "react";
import toast from "react-hot-toast";
import {BarChart3, Bot, Copy, ExternalLink, Landmark, ReceiptText, ShieldCheck, WalletCards} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGet} from "@/lib/api";
import {arcTestnet, shortAddress} from "@/lib/arc";

type RevenueDashboard = {
  treasury?: string;
  treasuryBalance?: {
    available: boolean;
    balanceUsdc: number;
    asset: string;
    treasury: string;
    updatedAt: string;
  };
  summary: {
    totalPlatformRevenueUsdc: number;
    analyticsSource?: "indexed" | "local";
    indexedEvents?: number;
    marketplaceGrossUsdc: number;
    facilitatorVolumeUsdc?: number;
    marketplaceFeesUsdc: number;
    escrowFeesUsdc: number;
    saveEarnFeesUsdc?: number;
    saveEarnDepositVolumeUsdc?: number;
    saveEarnWithdrawalVolumeUsdc?: number;
    subscriptionRevenueUsdc: number;
    bookedPlanVolumeUsdc?: number;
    developerAnalyticsRevenueUsdc?: number;
    premiumAutomationRevenueUsdc?: number;
    settledPayments: number;
    onchainMarketplaceSettlements?: number;
    onchainEscrowReleases?: number;
    publishedServices: number;
    activeAgents: number;
    policySaves: number;
  };
  bySource: Array<{source: string; revenueUsdc: number; amountUsdc?: number; kind?: "revenue" | "volume" | "usage"; count: number}>;
  feeReceipts: Array<{
    id: string;
    source: string;
    label: string;
    grossUsdc: number;
    feeUsdc: number;
    netUsdc: number;
    txHash?: string | null;
    createdAt: string;
  }>;
};

export default function RevenuePage() {
  const [dashboard, setDashboard] = useState<RevenueDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiGet<RevenueDashboard>("/api/revenue")
      .then((data) => {
        if (!active) return;
        setDashboard(data);
        setError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Revenue dashboard unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const summary = dashboard?.summary;

  if (loading && !dashboard) {
    return (
      <div className="space-y-5">
        <PageHeader
          kicker="Treasury"
          title="Revenue dashboard"
          description="Track collected treasury fees separately from gross marketplace volume and booked plan activity."
        />
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="panel space-y-4">
              <div className="shimmer h-10 w-10 rounded-lg" />
              <div className="shimmer h-3 w-24 rounded" />
              <div className="shimmer h-7 w-28 rounded" />
              <div className="shimmer h-3 w-32 rounded" />
            </div>
          ))}
        </section>
        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="panel space-y-3">
            <div className="shimmer h-40 w-full rounded-xl" />
            <div className="shimmer h-24 w-full rounded-xl" />
          </div>
          <div className="panel space-y-3">
            <div className="shimmer h-6 w-32 rounded" />
            {[0, 1, 2].map((item) => (
              <div key={item} className="shimmer h-14 w-full rounded-xl" />
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Treasury"
        title="Revenue dashboard"
        description="Track collected treasury fees separately from gross marketplace volume and booked plan activity."
      />

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">
          <span>{error}</span>
          <button type="button" className="secondary-button min-h-8 px-3 py-1 text-xs" onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RevenueMetric icon={<Landmark size={18} />} label="Treasury fees" value={usd(summary?.totalPlatformRevenueUsdc)} detail="collected fee revenue" />
        <RevenueMetric icon={<WalletCards size={18} />} label="Treasury balance" value={dashboard?.treasuryBalance?.available ? usd(dashboard.treasuryBalance.balanceUsdc) : "Unavailable"} detail="on-chain USDC balance" />
        <RevenueMetric icon={<ReceiptText size={18} />} label="Marketplace fees" value={usd(summary?.marketplaceFeesUsdc)} detail={`${summary?.settledPayments ?? 0} settled payments`} />
        <RevenueMetric icon={<ShieldCheck size={18} />} label="Escrow fees" value={usd(summary?.escrowFeesUsdc)} detail="released work agreements" />
        <RevenueMetric icon={<BarChart3 size={18} />} label="Analytics plans" value={usd(summary?.developerAnalyticsRevenueUsdc)} detail="monthly developer analytics" />
        <RevenueMetric icon={<Bot size={18} />} label="Automation plans" value={usd(summary?.premiumAutomationRevenueUsdc)} detail="monthly premium agents" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Treasury verification</p>
              <h2 className="text-xl font-semibold text-white">Fee destination</h2>
            </div>
            <span className="status-pill">USDC</span>
          </div>
          <div className="surface p-4">
            <p className="text-sm text-slate-400">Configured treasury</p>
            <p className="mt-2 break-all font-mono text-base text-white">{dashboard?.treasury || "Treasury address not configured"}</p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {summary?.analyticsSource === "indexed"
                ? `Using ${summary.indexedEvents ?? 0} indexed Arc events for contract activity. The treasury balance remains the source of truth for USDC actually received.`
                : "Using local app records until the Arc indexer syncs contract activity. The treasury balance remains the source of truth for USDC actually received."}
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="surface px-4 py-3">
              <p className="text-xs text-slate-500">Marketplace volume</p>
              <p className="mt-2 text-lg font-semibold text-white">{usd(summary?.marketplaceGrossUsdc)}</p>
            </div>
            <div className="surface px-4 py-3">
              <p className="text-xs text-slate-500">Facilitator volume</p>
              <p className="mt-2 text-lg font-semibold text-white">{usd(summary?.facilitatorVolumeUsdc)}</p>
            </div>
            <div className="surface px-4 py-3">
              <p className="text-xs text-slate-500">Save/Earn deposits</p>
              <p className="mt-2 text-lg font-semibold text-white">{usd(summary?.saveEarnDepositVolumeUsdc)}</p>
            </div>
            <div className="surface px-4 py-3">
              <p className="text-xs text-slate-500">Save/Earn withdrawals</p>
              <p className="mt-2 text-lg font-semibold text-white">{usd(summary?.saveEarnWithdrawalVolumeUsdc)}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {(dashboard?.bySource ?? []).map((source) => (
              <div key={source.source} className="surface flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="text-slate-300">{source.source}</span>
                <span className="text-right text-white">
                  {usd(source.kind === "volume" ? source.amountUsdc : source.revenueUsdc)}
                  <span className="text-slate-500"> · {source.kind === "volume" ? "volume" : "fees"} · {source.count}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="mb-4">
            <p className="text-sm text-slate-400">Latest receipts</p>
            <h2 className="text-xl font-semibold text-white">Fee proof</h2>
          </div>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-white/[0.08] text-slate-400">
                <tr>
                  <th className="py-3">Source</th>
                  <th>Gross</th>
                  <th>Fee</th>
                  <th>Net</th>
                  <th>Tx</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard?.feeReceipts ?? []).map((receipt) => (
                  <tr key={receipt.id} className="border-b border-white/[0.07]">
                    <td className="py-4">
                      <p className="font-medium text-white">{receipt.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{receipt.source}</p>
                    </td>
                    <td>{usd(receipt.grossUsdc)}</td>
                    <td className="text-mint">{usd(receipt.feeUsdc)}</td>
                    <td>{usd(receipt.netUsdc)}</td>
                    <td>
                      {receipt.txHash ? (
                        <a className="inline-flex items-center gap-1 text-sky hover:text-white" href={`${arcTestnet.explorerUrl}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                          {shortAddress(receipt.txHash)}
                          <ExternalLink size={13} />
                        </a>
                      ) : (
                        <span className="text-slate-500">recorded</span>
                      )}
                    </td>
                    <td><ReceiptActions receiptId={receipt.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {(dashboard?.feeReceipts ?? []).map((receipt) => (
              <div key={receipt.id} className="surface p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{receipt.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{receipt.source}</p>
                  </div>
                  <ReceiptActions receiptId={receipt.id} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-slate-500">Gross</p>
                    <p className="mt-1 font-semibold text-white">{usd(receipt.grossUsdc)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Fee</p>
                    <p className="mt-1 font-semibold text-mint">{usd(receipt.feeUsdc)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Net</p>
                    <p className="mt-1 font-semibold text-white">{usd(receipt.netUsdc)}</p>
                  </div>
                </div>
                {receipt.txHash ? (
                  <a className="mt-3 inline-flex items-center gap-1 text-sky hover:text-white" href={`${arcTestnet.explorerUrl}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                    {shortAddress(receipt.txHash)}
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">recorded</p>
                )}
              </div>
            ))}
          </div>

          {dashboard && dashboard.feeReceipts.length === 0 ? (
            <p className="py-5 text-sm text-slate-400">No fee receipts yet. Marketplace settlements and released escrows will appear here.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReceiptActions({receiptId}: {receiptId: string}) {
  const href = `/receipts/${encodeURIComponent(receiptId)}`;
  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}${href}`);
    toast.success("Receipt link copied");
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="secondary-button min-h-9 px-2.5 py-1.5 text-xs" onClick={() => void copy()} aria-label="Copy receipt link">
        <Copy size={13} />
      </button>
      <a className="secondary-button min-h-9 px-2.5 py-1.5 text-xs" href={href} aria-label="Open receipt">
        <ExternalLink size={13} />
      </a>
    </span>
  );
}

function RevenueMetric({icon, label, value, detail}: {icon: React.ReactNode; label: string; value: string | number; detail: string}) {
  return (
    <div className="panel">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">
        {icon}
      </div>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function usd(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `$${Number(value).toFixed(2)}`;
}
