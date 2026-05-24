import {CheckCircle2, KeyRound, RadioTower, Sparkles, Wallet} from "lucide-react";
import {useAccount} from "wagmi";
import {ArcNameLabel} from "@/components/ArcNameLabel";
import {PageHeader} from "@/components/PageHeader";
import {useArcName} from "@/hooks/useArcName";
import {arcTestnet, shortAddress, switchToArc} from "@/lib/arc";

export default function IdentityPage() {
  const {address, chain, isConnected} = useAccount();
  const {arcName, isLoading, error} = useArcName(address);
  const onArc = chain?.id === arcTestnet.id;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Arc identity"
        title="Operator profile"
        description="Connect your wallet to resolve your primary .arc name and bind it to Nexora activity."
      />
      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="panel">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-plasma/30 bg-plasma/15 text-plasma">
            <KeyRound size={22} />
          </div>
          <div className="mt-6 rounded-lg border border-white/[0.08] bg-white/[0.035] p-4">
            <p className="text-sm text-slate-400">Resolved identity</p>
            <p className="mt-2 break-all text-2xl font-semibold text-white">
              <ArcNameLabel address={address} fallback="Connect wallet to resolve .arc" />
            </p>
            <div className="mt-4 grid gap-2 text-sm text-slate-300">
              <div className="surface flex items-center justify-between px-3 py-2">
                <span className="text-slate-400">Wallet</span>
                <span className="font-mono text-white">{address ? shortAddress(address) : "Not connected"}</span>
              </div>
              <div className="surface flex items-center justify-between px-3 py-2">
                <span className="text-slate-400">Network</span>
                <span className={onArc ? "text-mint" : "text-magenta"}>{chain?.name ?? "Not connected"}</span>
              </div>
              <div className="surface flex items-center justify-between px-3 py-2">
                <span className="text-slate-400">Arc Names</span>
                <span className={arcName ? "text-mint" : "text-slate-300"}>
                  {isLoading ? "Resolving..." : arcName ? "Primary name found" : "No primary name yet"}
                </span>
              </div>
            </div>
            {!onArc && isConnected ? (
              <button type="button" onClick={() => void switchToArc()} className="action-button mt-4 w-full">
                <RadioTower size={16} />
                Switch wallet to Arc Testnet
              </button>
            ) : null}
            {error ? <p className="mt-4 rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">{error}</p> : null}
          </div>
        </section>
        <section className="panel">
          <h3 className="flex items-center gap-2 font-semibold text-white"><Sparkles size={18} className="text-plasma" /> Identity status</h3>
          <div className="mt-4 grid gap-3">
            {[
              ["Wallet connected", isConnected],
              ["Arc network selected", onArc],
              ["Primary .arc resolved", Boolean(arcName)]
            ].map(([label, complete]) => (
              <div key={String(label)} className="surface flex items-center justify-between px-4 py-3 text-sm">
                <span className="flex items-center gap-2 text-slate-300">
                  {complete ? <CheckCircle2 size={16} className="text-mint" /> : <Wallet size={16} className="text-slate-500" />}
                  {String(label)}
                </span>
                <span className={complete ? "text-mint" : "text-slate-500"}>{complete ? "Ready" : "Needed"}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-slate-300">
            {arcName ? (
              <p>Nexora will use <b className="text-white">{arcName}</b> as your operator identity for agent wallets, x402 publishing, payments, reputation, and Save/Earn activity.</p>
            ) : address ? (
              <p>Nexora will use <b className="text-white">{shortAddress(address)}</b> as your operator identity until a primary .arc name resolves for this wallet.</p>
            ) : (
              <p>Connect a wallet to create your Nexora operator identity.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
