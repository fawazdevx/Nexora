import {PageHeader} from "@/components/PageHeader";
import {SaveEarnPanel} from "@/components/SaveEarnPanel";

export default function EarnPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Nexora Save / Earn"
        title="Save USDC while Nexora routes to the best Arc vault"
        description="Deposits enter the Nexora Save/Earn vault, then the router allocates through approved Arc strategy adapters. Your position stays visible in USDC — deposited amount, current value, estimated earnings, and withdrawable balance."
      />
      <SaveEarnPanel />
    </div>
  );
}
