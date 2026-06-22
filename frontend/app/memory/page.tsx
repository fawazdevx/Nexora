import {useQuery} from "@tanstack/react-query";
import {Brain, CircleDollarSign, DatabaseZap, ReceiptText, ShieldAlert} from "lucide-react";
import {useAccount} from "wagmi";
import {EmptyState} from "@/components/EmptyState";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {apiGet} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {formatTimestamp} from "@/lib/time";

type AgentMemory = {
  operatorAddress: string;
  agents: Array<{
    id: string;
    arcName: string | null;
    address: string | null;
    dailyLimitUsdc: number;
    transactionCapUsdc: number;
  }>;
  summary: {
    totalPayments: number;
    settledPayments: number;
    blockedPayments: number;
    totalSpentUsdc: number;
    memoBackedPayments: number;
    uniqueServices: number;
    budgetBuckets: number;
  };
  byBudgetBucket: Array<{budgetBucket: string; totalUsdc: number; payments: number; settled: number; blocked: number}>;
  byService: Array<{serviceId: string; serviceName: string; totalUsdc: number; payments: number; settled: number; lastUsedAt: string}>;
  byIntent: Array<{intent: string; totalUsdc: number; payments: number; latestAt: string}>;
  recentMemories: Array<{
    paymentId: string;
    authorizationId: string | null;
    memoId: string | null;
    serviceId: string;
    serviceName: string;
    status: string;
    amountUsdc: number;
    budgetBucket: string;
    intent: string;
    privacyScope: string;
    requestHash: string;
    txHash: string | null;
    createdAt: string;
    settledAt: string | null;
  }>;
};

export default function AgentMemoryPage() {
  const {address, isConnected} = useAccount();
  const memory = useQuery({
    queryKey: ["agent-memory", address],
    queryFn: () => apiGet<AgentMemory>(`/api/agents/memory?operator=${encodeURIComponent(address as string)}`),
    enabled: Boolean(address),
    refetchInterval: 15_000
  });

  if (!isConnected || !address) {
    return (
      <EmptyState
        icon={<Brain size={26} />}
        title="Connect a wallet"
        copy="Connect an operator wallet to inspect memo-backed agent payment memory."
      />
    );
  }

  const data = memory.data;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Agent financial memory"
        title="Onchain context for agent spend"
        description="Review structured x402 memos, budget buckets, purchase intent, and policy outcomes for your agent wallets."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatMetric variant="landing" value={data?.summary.totalSpentUsdc ?? 0} prefix="$" decimals={2} label="Memo-aware spend" loading={memory.isLoading} icon={CircleDollarSign} accent />
        <StatMetric variant="landing" value={data?.summary.memoBackedPayments ?? 0} label="Memo-backed payments" loading={memory.isLoading} icon={ReceiptText} />
        <StatMetric variant="landing" value={data?.summary.uniqueServices ?? 0} label="Services used" loading={memory.isLoading} icon={DatabaseZap} />
        <StatMetric variant="landing" value={data?.summary.blockedPayments ?? 0} label="Policy blocks" loading={memory.isLoading} icon={ShieldAlert} />
      </section>

      {memory.isError ? (
        <p className="rounded-xl border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">
          {memory.error instanceof Error ? memory.error.message : "Agent memory is unavailable."}
        </p>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel">
          <p className="section-kicker">Budget buckets</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Spend by intent</h2>
          <div className="mt-5 space-y-3">
            {(data?.byBudgetBucket ?? []).map((bucket) => (
              <div key={bucket.budgetBucket} className="surface flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-semibold capitalize text-white">{bucket.budgetBucket.replaceAll("_", " ")}</p>
                  <p className="mt-1 text-xs text-slate-500">{bucket.settled} settled · {bucket.blocked} blocked · {bucket.payments} total</p>
                </div>
                <p className="text-lg font-semibold text-mint">{usd(bucket.totalUsdc)}</p>
              </div>
            ))}
            {!memory.isLoading && (data?.byBudgetBucket.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-400">No memo-backed payment memory yet.</p>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <p className="section-kicker">Recent memories</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Why agents spent</h2>
          <div className="mt-5 space-y-3">
            {(data?.recentMemories ?? []).slice(0, 8).map((item) => (
              <div key={item.paymentId} className="surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{item.serviceName}</p>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{item.intent}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${item.status === "settled" ? "border-mint/25 bg-mint/10 text-mint" : "border-white/[0.12] bg-white/[0.04] text-slate-300"}`}>
                    {item.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
                  <span>{usd(item.amountUsdc)}</span>
                  <span className="capitalize">{item.budgetBucket.replaceAll("_", " ")}</span>
                  <span>{item.memoId ? shortAddress(item.memoId) : "no memo id"}</span>
                  <span>{formatTimestamp(item.settledAt ?? item.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <MemoryList title="Top services" items={(data?.byService ?? []).map((item) => ({
          id: item.serviceId,
          title: item.serviceName,
          detail: `${item.settled} settled · ${item.payments} total · last ${formatTimestamp(item.lastUsedAt)}`,
          value: usd(item.totalUsdc)
        }))} />
        <MemoryList title="Recurring intents" items={(data?.byIntent ?? []).map((item) => ({
          id: item.intent,
          title: item.intent,
          detail: `${item.payments} payment${item.payments === 1 ? "" : "s"} · latest ${formatTimestamp(item.latestAt)}`,
          value: usd(item.totalUsdc)
        }))} />
      </section>
    </div>
  );
}

function MemoryList({title, items}: {title: string; items: Array<{id: string; title: string; detail: string; value: string}>}) {
  return (
    <div className="panel">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.slice(0, 8).map((item) => (
          <div key={item.id} className="surface flex items-start justify-between gap-4 p-4">
            <div>
              <p className="font-semibold text-white">{item.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
            </div>
            <p className="shrink-0 font-semibold text-mint">{item.value}</p>
          </div>
        ))}
        {items.length === 0 ? <p className="text-sm text-slate-400">No data yet.</p> : null}
      </div>
    </div>
  );
}

function usd(value?: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})}`;
}
