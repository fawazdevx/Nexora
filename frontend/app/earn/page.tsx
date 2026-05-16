import {useState} from "react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {SaveEarnPanel} from "@/components/SaveEarnPanel";
import {apiGet, apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useQuery} from "@tanstack/react-query";
import {Bot, CircuitBoard, Zap} from "lucide-react";

type EarnOpportunity = {
  id: string;
  title: string;
  payoutAsset: string;
  automationEnabled: boolean;
  risk: string;
  provider: string;
  status: string;
};

export default function EarnPage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const opportunities = useQuery({
    queryKey: ["earn-opportunities"],
    queryFn: () => apiGet<{opportunities: EarnOpportunity[]}>("/api/earn/opportunities")
  });

  async function activateStrategy(id: string) {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before activating an earn strategy.");
      return;
    }

    setStatus("Queueing earn strategy...");
    try {
      const result = await apiPost<{status: string; queue: string}>(`/api/earn/opportunities/${id}/activate`, {
        operatorAddress: address
      });
      setStatus(`Strategy queued for ${shortAddress(address)}: ${result.status} via ${result.queue}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Strategy activation failed");
    }
  }

  return (
    <div className="space-y-5">
      <SaveEarnPanel />
      <PageHeader
        kicker="One-click earn engine"
        title="Automate stablecoin-native earning"
        description="Launch curated earning workflows with explicit payout, risk, and approval boundaries."
      />
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(opportunities.data?.opportunities ?? []).map((opportunity) => {
          const Icon = opportunity.provider === "xylonet" ? Zap : opportunity.provider === "synthra" ? CircuitBoard : Bot;
          return (
            <article key={opportunity.title} className="panel">
              <div className="flex items-start gap-4">
                <div className="rounded-lg border border-plasma/30 bg-plasma/10 p-3 text-plasma"><Icon size={22} /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-white">{opportunity.title}</h3>
                  <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                    <span className="surface px-3 py-2">Asset <b className="text-white">{opportunity.payoutAsset}</b></span>
                    <span className="surface px-3 py-2">Risk <b className="text-white">{opportunity.risk}</b></span>
                    <span className="surface px-3 py-2">Mode <b className="text-white">{opportunity.automationEnabled ? "One-click" : "Setup needed"}</b></span>
                  </div>
                </div>
              </div>
              <button onClick={() => void activateStrategy(opportunity.id)} className="action-button mt-5 w-full" disabled={!isConnected || !opportunity.automationEnabled}>Activate strategy</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
