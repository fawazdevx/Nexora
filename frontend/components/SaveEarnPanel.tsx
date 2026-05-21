import {useState} from "react";
import {ArrowDownToLine, ArrowUpFromLine, Gauge, ShieldCheck, Sparkles} from "lucide-react";
import {useAccount} from "wagmi";
import {useQuery} from "@tanstack/react-query";
import {depositSaveEarn, readSaveEarnPosition, withdrawSaveEarn} from "@/lib/contracts";
import {shortAddress} from "@/lib/arc";

export function SaveEarnPanel() {
  const {address, isConnected} = useAccount();
  const [amount, setAmount] = useState("0");
  const [status, setStatus] = useState("");
  const position = useQuery({
    queryKey: ["save-earn-position", address],
    queryFn: () => readSaveEarnPosition(address as string),
    enabled: Boolean(address),
    refetchInterval: 12_000
  });
  const positionData = position.data;
  const amountIsPositive = Number(amount) > 0;
  const metric = (value?: string, suffix = "") => {
    if (!address) return "Connect wallet";
    if (position.isLoading) return "Loading...";
    if (position.isError) return "Unavailable";
    return `${Number(value ?? 0).toFixed(2)}${suffix}`;
  };

  async function deposit() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before routing USDC into Save/Earn.");
      return;
    }
    if (!amountIsPositive) {
      setStatus("Enter the USDC amount you want to save.");
      return;
    }
    setStatus("Approving USDC and routing deposit...");
    try {
      const result = await depositSaveEarn(amount);
      await position.refetch();
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
    if (!amountIsPositive) {
      setStatus("Enter the USDC amount you want to withdraw.");
      return;
    }
    setStatus("Withdrawing from Save/Earn...");
    try {
      const hash = await withdrawSaveEarn(amount);
      await position.refetch();
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
            <p className="section-kicker">Nexora Save/Earn</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight text-white md:text-[2.35rem]">
              Save USDC on Nexora and let the router seek the best vault.
            </h2>
            <p className="muted-copy mt-4 max-w-2xl">
              Deposits go into the Nexora Save/Earn vault. The router can allocate funds to approved strategy adapters such as XyloNet once one is activated on-chain.
            </p>
          </div>
          <div className="border-t border-white/[0.08] bg-black/15 p-5 md:p-6 lg:border-l lg:border-t-0">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="surface p-4">
                <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-mint">
                  <Gauge size={14} />
                  Current value
                </p>
                <p className="mt-3 text-4xl font-semibold text-white">{metric(positionData?.currentAssets)}</p>
                <p className="mt-1 text-sm text-slate-400">USDC in vault</p>
              </div>
              <div className="surface p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Estimated earnings</p>
                <p className="mt-3 text-xl font-semibold text-white">{metric(positionData?.estimatedEarnings, " USDC")}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t border-white/[0.08] lg:grid-cols-[1fr_0.8fr]">
          <div className="p-5 md:p-6">
            <label className="text-sm text-slate-300">
              USDC amount
              <div className="mt-2 flex overflow-hidden rounded-lg border border-white/[0.1] bg-black/25">
                <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="min-w-0 flex-1 bg-transparent px-4 py-4 text-2xl font-semibold text-white outline-none" />
                <span className="border-l border-white/[0.1] px-4 py-5 text-sm text-slate-400">USDC</span>
              </div>
            </label>
            <div className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
              Operator wallet: <span className="font-mono text-white">{address ? shortAddress(address) : "Connect wallet"}</span>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
              <div className="surface px-3 py-2">Deposited <b className="text-white">{metric(positionData?.deposited, " USDC")}</b></div>
              <div className="surface px-3 py-2">Shares <b className="text-white">{metric(positionData?.shares)}</b></div>
              <div className="surface px-3 py-2">Withdrawable <b className="text-white">{metric(positionData?.withdrawableAssets, " USDC")}</b></div>
              <div className="surface px-3 py-2">Earned <b className="text-white">{metric(positionData?.estimatedEarnings, " USDC")}</b></div>
              <div className="surface px-3 py-2">Fee <b className="text-white">{metric(positionData?.withdrawalFee, " USDC")}</b></div>
            </div>
            {position.isError ? (
              <p className="mt-3 rounded-md border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">
                Save/Earn position could not be read from Arc. Refresh or check the connected wallet and RPC connection.
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button onClick={deposit} className="action-button min-h-12" disabled={!isConnected || !amountIsPositive}>
                <ArrowDownToLine size={17} />
                Save
              </button>
              <button onClick={withdraw} className="danger-button min-h-12" disabled={!isConnected || !amountIsPositive}>
                <ArrowUpFromLine size={17} />
                Withdraw selected USDC
              </button>
            </div>
            {status ? <p className="mt-4 break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
          </div>

          <div className="grid gap-3 border-t border-white/[0.08] bg-black/10 p-5 md:p-6 lg:border-l lg:border-t-0">
            {[
              ["User action", "Save USDC"],
              ["Asset", "USDC"],
              ["Routing", "Nexora router"],
              ["Current adapter", "Activate on-chain"]
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
