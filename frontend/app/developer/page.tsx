import {useEffect, useState} from "react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {apiGet} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function DeveloperDashboardPage() {
  const {address} = useAccount();
  const snapshot = useAppSnapshot();
  const [dashboard, setDashboard] = useState<any | null>(null);
  const operator = address ?? "";

  useEffect(() => {
    if (!operator) return;
    void apiGet(`/api/developers/${encodeURIComponent(operator)}/dashboard`).then(setDashboard).catch(() => setDashboard(null));
  }, [operator]);

  const data = dashboard ?? snapshot.data;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Developer dashboard"
        title="Hosted x402 revenue"
        description="Track published APIs, marketplace revenue, facilitator fees, and active escrows."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Services" value={dashboard?.summary?.publishedServices ?? data?.services.length ?? 0} />
        <Metric label="Executions" value={dashboard?.summary?.totalExecutions ?? data?.payments.length ?? 0} />
        <Metric label="Gross USDC" value={`$${(dashboard?.summary?.grossRevenueUsdc ?? 0).toFixed(2)}`} />
        <Metric label="Platform revenue" value={`$${(dashboard?.summary?.platformRevenueUsdc ?? 0).toFixed(2)}`} />
      </div>
      <div className="panel">
        <p className="text-sm text-slate-400">Operator</p>
        <p className="mt-2 text-lg text-white">{address ? shortAddress(address) : "Connect wallet"}</p>
      </div>
    </div>
  );
}

function Metric({label, value}: {label: string; value: string | number}) {
  return (
    <div className="panel">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
