import {useState} from "react";
import {Plus} from "lucide-react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {apiPost} from "@/lib/api";
import {navigateTo} from "@/lib/router";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {settleX402Request} from "@/lib/contracts";

function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  navigateTo(href);
}

export default function MarketplacePage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [serviceResults, setServiceResults] = useState<Record<string, unknown>>({});
  const snapshot = useAppSnapshot();

  async function purchase(service: NonNullable<typeof snapshot.data>["services"][number]) {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before purchasing an x402 service.");
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
      let txHash: string | null = null;
      if (service.chainServiceId) {
        setStatus(`Submitting USDC approval and x402 settlement for ${service.name}...`);
        const tx = await settleX402Request({
          chainServiceId: service.chainServiceId,
          requestHash,
          payer: address,
          units: 1,
          amountUsdc: String(result.settlement.amountUsdc)
        });
        txHash = tx.settleHash;
      }
      await apiPost("/api/x402/settle", {authorizationId: result.authorizationId, txHash});
      const execution = await apiPost<{result: unknown}>(`/api/marketplace/services/${service.id}/execute`, {
        payer: address,
        args: {
          handle: xHandle
        }
      });
      await snapshot.refetch();
      setServiceResults((current) => ({...current, [service.id]: execution.result}));
      setStatus(
        txHash
          ? `Purchased ${service.name} for ${shortAddress(address)}. Settlement: ${txHash}`
          : `Recorded test purchase for ${service.name}.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Service purchase failed");
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
              <span className="surface px-3 py-2">Ledger <b className="text-white">{service.chainServiceId ?? "Off-chain"}</b></span>
              <span className="surface px-3 py-2">Featured <b className="text-white">{service.featured ? "Yes" : "No"}</b></span>
            </div>
            {isXAnalyzer(service) ? (
              <label className="mt-5 grid gap-2 text-sm text-slate-300">
                X account
                <input className="field" value={xHandle} onChange={(event) => setXHandle(event.target.value)} placeholder="@username" />
              </label>
            ) : null}
            <button onClick={() => void purchase(service)} className="action-button mt-5 w-full" disabled={!isConnected}>
              {service.chainServiceId ? "Purchase per execution" : "Test purchase"}
            </button>
            {serviceResults[service.id] ? (
              <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-white/[0.08] bg-black/30 p-3 text-xs leading-5 text-slate-200">
                {JSON.stringify(serviceResults[service.id], null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
        {!snapshot.isLoading && (snapshot.data?.services.length ?? 0) === 0 ? (
          <div className="panel lg:col-span-2">
            <p className="text-sm text-slate-300">No APIs have been published yet. Publish the first x402 service from the developer console.</p>
          </div>
        ) : null}
      </div>

    </div>
  );
}

function isXAnalyzer(service: {name: string; endpointHash: string}) {
  const marker = `${service.name} ${service.endpointHash}`.toLowerCase();
  return marker.includes("x account") || marker.includes("x-account") || marker.includes("twitter");
}
