import {Activity, Clock, ShieldCheck, Wrench} from "lucide-react";

export default function MaintenancePage() {
  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-12">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(168,85,247,0.28),transparent_30rem),linear-gradient(120deg,rgba(110,231,249,0.08),transparent_40rem)]" />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:76px_76px] opacity-35" />

      <section className="panel relative z-10 max-w-2xl overflow-hidden p-0 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(168,85,247,0.2),transparent_18rem)]" />
        <div className="relative p-6 md:p-10">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-lg border border-plasma/35 bg-plasma/15 text-plasma">
            <Wrench size={26} />
          </div>
          <p className="section-kicker mt-6">Maintenance mode</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-white md:text-5xl">
            Nexora is upgrading its agent finance layer.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-slate-300">
            The console is temporarily offline while contracts, integrations, or platform services are being updated. Funds and policies remain governed by deployed on-chain contracts.
          </p>

          <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
            {[
              [Activity, "Status", "Upgrade window"],
              [ShieldCheck, "Contracts", "Protected"],
              [Clock, "Console", "Back shortly"]
            ].map(([Icon, label, value]) => {
              const ItemIcon = Icon as typeof Activity;
              return (
                <div key={String(label)} className="surface p-4">
                  <ItemIcon className="text-plasma" size={18} />
                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">{String(label)}</p>
                  <p className="mt-1 text-sm font-medium text-white">{String(value)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
