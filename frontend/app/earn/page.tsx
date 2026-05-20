import {PageHeader} from "@/components/PageHeader";
import {SaveEarnPanel} from "@/components/SaveEarnPanel";

export default function EarnPage() {
  return (
    <div className="space-y-5">
      <SaveEarnPanel />
      <PageHeader
        kicker="One-click earn engine"
        title="Router-managed USDC earning"
        description="Save USDC in one flow while Nexora handles routing behind the scenes."
      />
      <div className="panel">
        <p className="text-sm leading-6 text-slate-300">
          Your position stays visible in USDC, including deposited amount, current value, estimated earnings, and withdrawable balance.
        </p>
      </div>
    </div>
  );
}
