import {useMemo, useState} from "react";
import {Check, Loader2} from "lucide-react";
import toast from "react-hot-toast";
import {useAccount} from "wagmi";
import {apiGet, apiPost, type AppSnapshot} from "@/lib/api";
import {payTreasuryUsdc} from "@/lib/contracts";
import {shortAddress} from "@/lib/arc";

type Plan = {
  id: string;
  name: string;
  amountUsdc: number;
  interval: "month" | "one_time";
  benefit: string;
  features: string[];
};

type PlansResponse = {
  plans: Array<Partial<Plan> & {id?: string}>;
  treasury: string;
  usdc: string;
  chainId: number;
};

type Subscription = AppSnapshot["subscriptions"][number] & {
  planName?: string;
  interval?: "month" | "one_time";
  txHash?: string | null;
  currentPeriodEnd?: string | null;
};

export function PlanSubscriptionCard({
  planId,
  subscriptions,
  onActivated,
  className = ""
}: {
  planId: string;
  subscriptions: Subscription[];
  onActivated?: () => Promise<void> | void;
  className?: string;
}) {
  const {address, isConnected} = useAccount();
  const [plans, setPlans] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);

  async function loadPlans() {
    if (plans || loading) return plans;
    setLoading(true);
    try {
      const result = await apiGet<PlansResponse>("/api/monetization/plans");
      setPlans(result);
      return result;
    } finally {
      setLoading(false);
    }
  }

  const activeSubscription = useMemo(() => {
    const now = Date.now();
    return subscriptions
      .filter((subscription) => subscription.plan === planId && subscription.status === "active")
      .filter((subscription) => !subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > now)
      .sort((a, b) => Date.parse(b.currentPeriodEnd ?? b.createdAt) - Date.parse(a.currentPeriodEnd ?? a.createdAt))[0] ?? null;
  }, [planId, subscriptions]);

  const pendingSubscription = useMemo(() => {
    return subscriptions
      .filter((subscription) => subscription.plan === planId && subscription.status === "pending_payment")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
  }, [planId, subscriptions]);

  const loadedPlan = plans?.plans.find((item) => item.id === planId);
  const fallbackPlan = fallbackPlans.find((plan) => plan.id === planId);
  const plan = normalizePlan(loadedPlan, fallbackPlan, planId);
  const active = Boolean(activeSubscription);

  async function activate() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before activating a plan.");
      return;
    }
    setActivating(true);
    const toastId = toast.loading(`Activating ${plan.name}...`);
    try {
      const planData = await loadPlans();
      const selected = normalizePlan(planData?.plans.find((item) => item.id === planId), fallbackPlan, planId);
      if (!selected) throw new Error("Plan is unavailable.");
      if (!planData?.treasury?.startsWith("0x")) throw new Error("Nexora treasury is not configured.");

      const payment = await payTreasuryUsdc({
        treasury: planData.treasury,
        amountUsdc: String(selected.amountUsdc)
      });
      await apiPost("/api/monetization/activate", {
        operatorAddress: address,
        plan: selected.id,
        txHash: payment.txHash,
        chainId: payment.chainId
      });
      await onActivated?.();
      toast.success(`${selected.name} is active`, {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Plan activation failed", {id: toastId});
    } finally {
      setActivating(false);
    }
  }

  return (
    <section className={`panel ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Monthly plan</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{plan.name}</h2>
          <p className="muted-copy mt-2 max-w-2xl">{plan.benefit}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-white">${plan.amountUsdc}</p>
          <p className="text-xs text-slate-500">per {plan.interval}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-3">
        {plan.features.map((feature) => (
          <div key={feature} className="surface flex items-start gap-2 px-3 py-3 text-sm text-slate-300">
            <Check size={14} className="mt-0.5 shrink-0 text-mint" />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-400">
          {activeSubscription ? (
            <span className="text-mint">
              Active until {activeSubscription.currentPeriodEnd ? new Date(activeSubscription.currentPeriodEnd).toLocaleDateString() : "renewal"}
            </span>
          ) : pendingSubscription ? (
            <span>Pending payment created {new Date(pendingSubscription.createdAt).toLocaleDateString()}</span>
          ) : plans?.treasury ? (
            <span>Treasury {shortAddress(plans.treasury)}</span>
          ) : (
            <span>Pay with Arc USDC to activate.</span>
          )}
        </div>
        <button type="button" className="action-button" onClick={activate} disabled={!isConnected || active || activating}>
          {activating ? <Loader2 size={16} className="animate-spin" /> : null}
          {active ? "Plan active" : activating ? "Activating..." : "Activate plan"}
        </button>
      </div>
    </section>
  );
}

const fallbackPlans: Plan[] = [
  {
    id: "developer_analytics",
    name: "Developer analytics",
    amountUsdc: 29,
    interval: "month",
    benefit: "API usage analytics and hosted service manifests",
    features: [
      "Per-service execution, gross, fee, and net revenue analytics",
      "Recent paid API execution receipts and x402 settlement links",
      "Builder revenue dashboard for published API services"
    ]
  },
  {
    id: "premium_agent_automation",
    name: "Premium agent automation",
    amountUsdc: 49,
    interval: "month",
    benefit: "Advanced controls for policy-driven agent payments",
    features: [
      "Weekly and monthly agent spending budgets",
      "Service allowlists, cooldowns, expiry, and max API unit limits",
      "On-chain policy enforcement requirement for agent payments"
    ]
  }
];

function normalizePlan(remote: (Partial<Plan> & {id?: string}) | undefined, fallback: Plan | undefined, planId: string): Plan {
  return {
    id: remote?.id ?? fallback?.id ?? planId,
    name: remote?.name ?? fallback?.name ?? "Nexora plan",
    amountUsdc: Number.isFinite(Number(remote?.amountUsdc)) ? Number(remote?.amountUsdc) : fallback?.amountUsdc ?? 0,
    interval: remote?.interval === "one_time" || remote?.interval === "month" ? remote.interval : fallback?.interval ?? "month",
    benefit: remote?.benefit ?? fallback?.benefit ?? "Nexora monthly plan.",
    features: Array.isArray(remote?.features) && remote.features.length > 0
      ? remote.features.filter((feature): feature is string => typeof feature === "string" && feature.trim().length > 0)
      : fallback?.features ?? ["Plan details are loading."]
  };
}
