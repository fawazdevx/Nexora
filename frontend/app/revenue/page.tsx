import {useEffect, useState} from "react";
import {ExternalLink, Landmark, ReceiptText, ShieldCheck, WalletCards} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGet} from "@/lib/api";
import {arcTestnet, shortAddress} from "@/lib/arc";

type RevenueDashboard = {
  treasury?: string;
  summary: {
    totalPlatformRevenueUsdc: number;
    marketplaceGrossUsdc: number;
    marketplaceFeesUsdc: number;
    escrowFeesUsdc: number;
    subscriptionRevenueUsdc: number;
    bookedPlanVolumeUsdc?: number;
    settledPayments: number;
    publishedServices: number;
    activeAgents: number;
    policySaves: number;
  };
  bySource: Array<{source: string; revenueUsdc: number; count: number}>;
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

  useEffect(() => {
    void apiGet<RevenueDashboard>("/api/revenue")
      .then((data) => {
        setDashboard(data);
        setError("");
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Revenue dashboard unavailable"));
  }, []);

  const summary = dashboard?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Treasury"
        title="Revenue dashboard"
        description="Track collected treasury fees separately from gross marketplace volume and booked plan activity."
      />

      {error ? <p className="rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{error}</p> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RevenueMetric icon={<Landmark size={18} />} label="Treasury fees" value={usd(summary?.totalPlatformRevenueUsdc)} detail="collected fee revenue" />
        <RevenueMetric icon={<ReceiptText size={18} />} label="Marketplace fees" value={usd(summary?.marketplaceFeesUsdc)} detail={`${summary?.settledPayments ?? 0} settled payments`} />
        <RevenueMetric icon={<ShieldCheck size={18} />} label="Escrow fees" value={usd(summary?.escrowFeesUsdc)} detail="released work agreements" />
        <RevenueMetric icon={<WalletCards size={18} />} label="Marketplace volume" value={usd(summary?.marketplaceGrossUsdc)} detail={`${summary?.activeAgents ?? 0} active agents`} />
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
              This dashboard reports app-recorded collected fees. The treasury wallet balance is the source of truth for on-chain USDC actually received.
            </p>
          </div>
          <div className="mt-4 grid gap-3">
            {(dashboard?.bySource ?? []).map((source) => (
              <div key={source.source} className="surface flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="text-slate-300">{source.source}</span>
                <span className="text-right text-white">{usd(source.revenueUsdc)} <span className="text-slate-500">· {source.count}</span></span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="mb-4">
            <p className="text-sm text-slate-400">Latest receipts</p>
            <h2 className="text-xl font-semibold text-white">Fee proof</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-white/[0.08] text-slate-400">
                <tr>
                  <th className="py-3">Source</th>
                  <th>Gross</th>
                  <th>Fee</th>
                  <th>Net</th>
                  <th>Tx</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
            {!dashboard || dashboard.feeReceipts.length === 0 ? (
              <p className="py-5 text-sm text-slate-400">No fee receipts yet. Marketplace settlements and released escrows will appear here.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
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

function usd(value?: number) {
  return `$${(value ?? 0).toFixed(2)}`;
}
