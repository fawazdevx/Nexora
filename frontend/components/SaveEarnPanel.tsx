import {useState} from "react";
import {ArrowDownToLine, ArrowUpFromLine, Gauge, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {depositSaveEarn, withdrawSaveEarn} from "@/lib/contracts";
import {shortAddress} from "@/lib/arc";

export function SaveEarnPanel() {
  const {address, isConnected} = useAccount();
  const [amount, setAmount] = useState("250");
  const [status, setStatus] = useState("");

  async function deposit() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before routing USDC into Save/Earn.");
      return;
    }
    setStatus("Approving USDC and routing deposit...");
    try {
      const result = await depositSaveEarn(amount);
      setStatus(`Deposit submitted from ${shortAddress(address)}: ${result.depositHash}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deposit failed");
    }
  }

  async function withdraw() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before withdrawing from Save/Earn.");
      return;
    }
    setStatus("Withdrawing from Save/Earn...");
    try {
      const hash = await withdrawSaveEarn(amount);
      setStatus(`Withdrawal submitted from ${shortAddress(address)}: ${hash}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Withdrawal failed");
    }
  }

  return (
    <section className="panel relative overflow-hidden p-0">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(155,92,246,0.1),transparent_34%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
      <div className="relative">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-5 md:p-6">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <span className="status-pill border-plasma/20 bg-plasma/10 text-orchid">
                <Sparkles size={13} />
                Autonomous route
              </span>
              <span className="status-pill border-mint/20 bg-mint/10 text-mint">
                <ShieldCheck size={13} />
                Policy guarded
              </span>
            </div>
            <p className="section-kicker">One-click Save/Earn</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight text-white md:text-[2.35rem]">
              Route idle USDC into automated Arc-native earning.
            </h2>
            <p className="muted-copy mt-4 max-w-2xl">
              The vault keeps deposits withdrawable while the router selects an approved strategy for your operator or agent wallet.
            </p>
          </div>
          <div className="border-t border-white/[0.08] bg-black/15 p-5 md:p-6 lg:border-l lg:border-t-0">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="surface p-4">
                <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-mint">
                  <Gauge size={14} />
                  Target APY
                </p>
                <p className="mt-3 text-4xl font-semibold text-white">4.2%</p>
              </div>
              <div className="surface p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Routing state</p>
                <p className="mt-3 text-xl font-semibold text-white">Policy approved</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t border-white/[0.08] lg:grid-cols-[1fr_0.8fr]">
          <div className="p-5 md:p-6">
            <label className="text-sm text-slate-300">
              USDC amount
              <div className="mt-2 flex overflow-hidden rounded-lg border border-white/[0.1] bg-black/25">
                <input value={amount} onChange={(event) => setAmount(event.target.value)} className="min-w-0 flex-1 bg-transparent px-4 py-4 text-2xl font-semibold text-white outline-none" />
                <span className="border-l border-white/[0.1] px-4 py-5 text-sm text-slate-400">USDC</span>
              </div>
            </label>
            <div className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
              Operator wallet: <span className="font-mono text-white">{address ? shortAddress(address) : "Connect wallet"}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button onClick={deposit} className="action-button min-h-12" disabled={!isConnected}>
                <ArrowDownToLine size={17} />
                Save
              </button>
              <button onClick={withdraw} className="danger-button min-h-12" disabled={!isConnected}>
                <ArrowUpFromLine size={17} />
                Withdraw
              </button>
            </div>
            {status ? <p className="mt-4 break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
          </div>

          <div className="grid gap-3 border-t border-white/[0.08] bg-black/10 p-5 md:p-6 lg:border-l lg:border-t-0">
            {[
              ["AI route", "Xylonet / Synthra"],
              ["Withdrawal fee", "1.00% default"],
              ["Custody", "Upgradeable vault proxy"],
              ["Risk mode", "Owner-governed strategies"]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.035] px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-slate-400">
                  {label === "AI route" ? <Sparkles size={15} className="text-orchid" /> : <ShieldCheck size={15} className="text-mint" />}
                  {label}
                </span>
                <b className="text-sm text-white">{value}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
