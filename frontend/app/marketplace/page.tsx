import {useState} from "react";
import {Plus} from "lucide-react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {apiGet, apiPost} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {settleX402Request} from "@/lib/contracts";
import {useQuery} from "@tanstack/react-query";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

export default function MarketplacePage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();
  const plans = useQuery({
    queryKey: ["monetization-plans"],
    queryFn: () => apiGet<{plans: Array<{id: string; name: string; amountUsdc: number; interval: string; benefit: string}>}>("/api/monetization/plans")
  });

  async function purchase(service: NonNullable<typeof snapshot.data>["services"][number]) {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before purchasing an x402 service.");
      return;
    }
    if (!service.chainServiceId) {
      setStatus("This service is indexed offchain only. Publish it on the x402 ledger before purchase.");
      return;
    }

    setStatus(`Authorizing x402 payment for ${service.name}...`);
    try {
      const requestHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}` as `0x${string}`;
      const result = await apiPost<{authorizationId: string; status: string; settlement: {amountUsdc: number}}>("/api/x402/authorize", {
        serviceId: service.id,
        payer: address,
        requestHash,
        units: 1
      });
      setStatus(`Submitting USDC approval and x402 settlement for ${service.name}...`);
      const tx = await settleX402Request({
        chainServiceId: service.chainServiceId,
        requestHash,
        payer: address,
        units: 1,
        amountUsdc: String(result.settlement.amountUsdc)
      });
      await apiPost("/api/x402/settle", {authorizationId: result.authorizationId, txHash: tx.settleHash});
      await snapshot.refetch();
      setStatus(`Purchased ${service.name} for ${shortAddress(address)}. Settlement: ${tx.settleHash}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Service purchase failed");
    }
  }

  async function subscribe(plan: {id: string; name: string; amountUsdc: number}) {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before activating a Nexora monetization plan.");
      return;
    }

    try {
      await apiPost("/api/monetization/subscribe", {
        operatorAddress: address,
        plan: plan.id,
        amountUsdc: plan.amountUsdc
      });
      await snapshot.refetch();
      setStatus(`${plan.name} created for ${shortAddress(address)}. Payment settlement can be wired to the x402 ledger treasury plan.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Plan activation failed");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="x402 marketplace"
        title="APIs and agent services priced in USDC"
        description="Discover monetized tools that agents can purchase per request under operator-defined policy limits."
        action={<a href="/marketplace/new" onClick={(event) => navigate(event, "/marketplace/new")} className="action-button"><Plus size={16} /> Publish API</a>}
      />
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
      {snapshot.error ? <p className="rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{snapshot.error instanceof Error ? snapshot.error.message : "Marketplace API unavailable"}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(snapshot.data?.services ?? []).map((service) => (
          <article key={service.id} className="panel relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-white">{service.name}</h3>
                <p className="text-sm text-slate-400">Published by {shortAddress(service.publisherAddress)}</p>
              </div>
              <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">x402</span>
            </div>
            <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
              <span className="surface px-3 py-2">Price <b className="text-white">${service.pricePerUnitUsdc}</b></span>
              <span className="surface px-3 py-2">Ledger <b className="text-white">{service.chainServiceId ?? "Pending"}</b></span>
              <span className="surface px-3 py-2">Featured <b className="text-white">{service.featured ? "Yes" : "No"}</b></span>
            </div>
            <button onClick={() => void purchase(service)} className="action-button mt-5 w-full" disabled={!isConnected}>Purchase per execution</button>
          </article>
        ))}
        {!snapshot.isLoading && (snapshot.data?.services.length ?? 0) === 0 ? (
          <div className="panel lg:col-span-2">
            <p className="text-sm text-slate-300">No APIs have been published yet. Publish the first x402 service from the developer console.</p>
          </div>
        ) : null}
      </div>

      <section className="panel">
        <PageHeader
          kicker="Nexora monetization"
          title="Platform revenue products"
          description="Activate marketplace and operator plans that Nexora can monetize through USDC settlement."
        />
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {(plans.data?.plans ?? []).map((plan) => (
            <article key={plan.id} className="surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-white">{plan.name}</h3>
                  <p className="mt-2 text-sm text-slate-400">{plan.benefit}</p>
                </div>
                <span className="status-pill">${plan.amountUsdc} {plan.interval}</span>
              </div>
              <button onClick={() => void subscribe(plan)} className="secondary-button mt-4 w-full" disabled={!isConnected}>
                Activate plan
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
