import {useEffect, useState} from "react";
import {ExternalLink, KeyRound, Landmark, Network, ReceiptText, ShieldCheck} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiGetWithHeaders} from "@/lib/api";
import {shortAddress} from "@/lib/arc";

type DeploymentDashboard = {
  treasury: {
    address: string;
    totalPlatformRevenueUsdc: number;
    marketplaceFeesUsdc: number;
    escrowFeesUsdc: number;
    planRevenueUsdc: number;
    bookedPlanVolumeUsdc?: number;
  };
  fees: {
    x402DefaultBps: number;
    escrowDefaultBps: number;
    saveEarnWithdrawalBps: number;
    deploymentFeeBps: number;
    editable: boolean;
  };
  chains: Array<{
    key: string;
    primary: boolean;
    name: string;
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    usdc: string;
    contracts: Record<string, string>;
    features: string[];
  }>;
};

export default function DeploymentDashboardPage() {
  const [dashboard, setDashboard] = useState<DeploymentDashboard | null>(null);
  const [error, setError] = useState("");
  const [adminSecret, setAdminSecret] = useState(() => sessionStorage.getItem("nexora-admin-secret") ?? "");
  const [loading, setLoading] = useState(false);

  function loadDashboard(secret = adminSecret) {
    const trimmedSecret = secret.trim();
    if (!trimmedSecret) {
      setError("Enter the admin secret to view deployments.");
      setDashboard(null);
      return;
    }

    sessionStorage.setItem("nexora-admin-secret", trimmedSecret);
    setLoading(true);
    void apiGetWithHeaders<DeploymentDashboard>("/api/admin/deployments", {"x-admin-secret": trimmedSecret})
      .then((data) => {
        setDashboard(data);
        setError("");
      })
      .catch((requestError) => {
        setDashboard(null);
        setError(requestError instanceof Error ? requestError.message : "Deployment dashboard unavailable");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (adminSecret) loadDashboard(adminSecret);
    // Run once on mount; the submit handler owns later reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Infrastructure admin"
        title="Chain deployments and treasury controls"
        description="Review Nexora deployments, enabled features, fee routing, and collected treasury controls."
      />

      <section className="panel">
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            loadDashboard();
          }}
        >
          <label className="flex-1">
            <span className="text-sm text-slate-400">Admin secret</span>
            <input
              className="mt-2 w-full rounded-md border border-white/[0.08] bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-mint/50"
              type="password"
              value={adminSecret}
              onChange={(event) => setAdminSecret(event.target.value)}
              placeholder="Enter backend admin secret"
              autoComplete="off"
            />
          </label>
          <button className="inline-flex items-center justify-center gap-2 rounded-md bg-mint px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={loading}>
            <KeyRound size={16} />
            {loading ? "Loading..." : "Unlock dashboard"}
          </button>
        </form>
        <p className="mt-3 text-xs leading-5 text-slate-500">The secret is sent as an admin header and kept only in this browser session.</p>
      </section>

      {error ? <p className="rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{error}</p> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Landmark size={18} />} label="Treasury fees" value={usd(dashboard?.treasury.totalPlatformRevenueUsdc)} />
        <Metric icon={<ReceiptText size={18} />} label="Marketplace fees" value={usd(dashboard?.treasury.marketplaceFeesUsdc)} />
        <Metric icon={<ShieldCheck size={18} />} label="Escrow fees" value={usd(dashboard?.treasury.escrowFeesUsdc)} />
        <Metric icon={<Network size={18} />} label="Deployed chains" value={dashboard?.chains.length ?? 0} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-4">
          {(dashboard?.chains ?? []).map((chain) => {
            const readyContracts = Object.values(chain.contracts).filter((address) => address.startsWith("0x")).length;
            const totalContracts = Object.keys(chain.contracts).length;
            return (
              <article key={chain.key} className="panel">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-white">{chain.name}</h2>
                      {chain.primary ? <span className="status-pill border-mint/25 bg-mint/10 text-mint">Primary</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-400">Chain ID {chain.chainId}</p>
                  </div>
                  <span className={readyContracts === totalContracts ? "status-pill border-mint/25 bg-mint/10 text-mint" : "status-pill text-orchid"}>
                    {readyContracts}/{totalContracts} contracts
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <ContractRow label="USDC" address={chain.usdc} explorerUrl={chain.explorerUrl} />
                  {Object.entries(chain.contracts).map(([label, address]) => (
                    <ContractRow key={label} label={formatLabel(label)} address={address} explorerUrl={chain.explorerUrl} />
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {chain.features.map((feature) => <span key={feature} className="status-pill">{feature}</span>)}
                </div>
              </article>
            );
          })}
        </div>

        <aside className="space-y-5">
          <section className="panel">
            <p className="text-sm text-slate-400">Treasury destination</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Fee routing</h2>
            <p className="mt-4 break-all font-mono text-sm text-white">{dashboard?.treasury.address || "Treasury address unavailable"}</p>
            <div className="mt-4 grid gap-2 text-sm">
              <FeeRow label="Marketplace" value={dashboard?.treasury.marketplaceFeesUsdc} />
              <FeeRow label="Escrow" value={dashboard?.treasury.escrowFeesUsdc} />
              <FeeRow label="Active plans" value={dashboard?.treasury.planRevenueUsdc} />
              <FeeRow label="Booked plan volume" value={dashboard?.treasury.bookedPlanVolumeUsdc} />
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Treasury balance on-chain remains the source of truth. Booked plan volume is activity, not collected USDC.</p>
          </section>

          <section className="panel">
            <p className="text-sm text-slate-400">Platform controls</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Fee configuration</h2>
            <div className="mt-4 grid gap-3">
              <ControlRow label="x402 marketplace" value={dashboard?.fees.x402DefaultBps} />
              <ControlRow label="Escrow" value={dashboard?.fees.escrowDefaultBps} />
              <ControlRow label="Save/Earn withdrawal" value={dashboard?.fees.saveEarnWithdrawalBps} />
              <ControlRow label="Deployment default" value={dashboard?.fees.deploymentFeeBps} />
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Controls are read-only in this release. Contract owner transactions should remain explicit and wallet-confirmed.</p>
          </section>
        </aside>
      </section>
    </div>
  );
}

function Metric({icon, label, value}: {icon: React.ReactNode; label: string; value: string | number}) {
  return (
    <div className="panel">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-orchid">{icon}</div>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function ContractRow({label, address, explorerUrl}: {label: string; address: string; explorerUrl: string}) {
  return (
    <div className="surface flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="text-slate-400">{label}</p>
            <p className={address ? "mt-1 font-mono text-white" : "mt-1 text-slate-500"}>{address ? shortAddress(address) : "Unavailable"}</p>
      </div>
      {address ? <a href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer" className="text-sky hover:text-white" aria-label={`View ${label}`}><ExternalLink size={15} /></a> : null}
    </div>
  );
}

function FeeRow({label, value}: {label: string; value?: number}) {
  return <div className="surface flex items-center justify-between gap-3 px-4 py-3"><span className="text-slate-400">{label}</span><b className="text-white">{usd(value)}</b></div>;
}

function ControlRow({label, value}: {label: string; value?: number}) {
  return <div className="surface flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="text-slate-300">{label}</span><b className="text-white">{((value ?? 0) / 100).toFixed(2)}%</b></div>;
}

function usd(value?: number) {
  return `$${(value ?? 0).toFixed(2)}`;
}

function formatLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
