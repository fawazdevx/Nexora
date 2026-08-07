import {PageHeader} from "@/components/PageHeader";
import {SaveEarnPanel} from "@/components/SaveEarnPanel";

export default function EarnPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Nexora Save / Earn"
        title="One deposit, continuously optimized across approved Arc vaults"
        description="Choose Conservative, Balanced, or Growth and deposit USDC once. Nexora routes the profile pool into its active underlying Arc vault, reevaluates approved routes every 24 hours, and can migrate the pool when a better risk-adjusted route passes its controls."
      />
      <SaveEarnPanel />
    </div>
  );
}
