import {PageHeader} from "@/components/PageHeader";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function ReputationPage() {
  const snapshot = useAppSnapshot();
  const reputation = snapshot.data?.reputation;
  const rows = [
    ["Reputation score", String(reputation?.score ?? 0), reputation?.verifiedBuilder ? "verified" : "building"],
    ["Successful payments", String(reputation?.successfulPayments ?? 0), "settled"],
    ["Completed agent tasks", String(reputation?.completedTasks ?? 0), "tasks"],
    ["Marketplace activity", String(reputation?.marketplaceSales ?? 0), "sales"],
    ["Ecosystem contributions", String(reputation?.ecosystemContributions ?? 0), "published"]
  ];

  return (
    <div className="panel">
      <PageHeader
        kicker="Operator reputation"
        title="Scorecard"
        description="Reputation accumulates from settled payments, completed tasks, marketplace activity, and ecosystem contributions."
      />
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {rows.map(([label, value, delta]) => (
          <div key={label} className="surface p-4">
            <p className="text-sm text-slate-400">{label}</p>
            <div className="mt-3 flex items-end justify-between">
              <strong className="text-3xl text-white">{value}</strong>
              <span className="text-mint">{delta}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
