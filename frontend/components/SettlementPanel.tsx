"use client";

// Task 7 — Nexora-owned x402 settlement (frontend UI). Runs the fee-collecting
// settlement flow through NexoraX402Settlement: pick a network that has the
// contract deployed, sign an EIP-3009 receiveWithAuthorization to the contract,
// and submit settle() from your own wallet. Nexora pays no gas; the contract
// splits its fee to the treasury and forwards the rest to the seller.

import {useMemo, useState} from "react";
import {CheckCircle2, PenLine, RefreshCw, ShieldCheck, XCircle} from "lucide-react";
import toast from "react-hot-toast";
import {isAddress, type Address, type Hex} from "viem";
import {useAccount} from "wagmi";
import {JsonViewer, type JsonStatus} from "@/components/JsonViewer";
import {apiPost} from "@/lib/api";
import {supportedChains, switchToChain} from "@/lib/arc";
import {enabledX402SignNetworks} from "@/lib/x402-networks";
import {paySettlementContract, randomSalt, settlementAmountBaseUnits, waitForSettlement, type SettlementRequirements} from "@/lib/settlement";
import {userFacingPaymentError} from "@/lib/user-errors";

type FlowStep = "idle" | "switching" | "signing" | "confirming" | "verifying";

export function SettlementPanel() {
  const {address, chain, isConnected} = useAccount();
  // Only networks that actually have a settlement contract deployed.
  const networks = useMemo(() => enabledX402SignNetworks().filter((n) => Boolean(n.settlementContract)), []);
  const [networkId, setNetworkId] = useState(networks[0]?.id ?? "");
  const [seller, setSeller] = useState("");
  const [amount, setAmount] = useState("0.05");
  const [step, setStep] = useState<FlowStep>("idle");
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState<JsonStatus | undefined>(undefined);

  const busy = step !== "idle";

  async function pay() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first.");
      return;
    }
    const net = networks.find((n) => n.id === networkId);
    if (!net) {
      toast.error("Select a network with a Nexora settlement contract.");
      return;
    }
    const sellerAddr = seller.trim();
    if (!isAddress(sellerAddr)) {
      toast.error("Enter a valid seller address.");
      return;
    }
    setResult(null);
    setStatus(undefined);
    const toastId = toast.loading("Preparing settlement…");
    try {
      if (chain?.id !== net.chainId) {
        setStep("switching");
        toast.loading(`Switch to ${net.label}…`, {id: toastId});
        const target = supportedChains.find((item) => item.id === net.chainId);
        if (!target) {
          toast.error(`${net.label} isn't enabled in this build.`, {id: toastId});
          setStep("idle");
          return;
        }
        await switchToChain(target);
      }

      setStep("signing");
      toast.loading("Confirming current settlement terms…", {id: toastId});
      const salt = randomSalt();
      const requirements = await apiPost<SettlementRequirements>("/api/x402/settlement/requirements", {
        network: net.id,
        amountBaseUnits: settlementAmountBaseUnits(amount).toString(),
        resource: "nexora://x402/playground/settlement",
        seller: sellerAddr,
        salt
      });

      toast.loading("Sign the payment authorization…", {id: toastId});
      const settlement = await paySettlementContract({
        networkId: net.id,
        seller: sellerAddr as Address,
        amountUsdc: amount,
        requirements
      });

      setStep("confirming");
      toast.loading("Waiting for on-chain confirmation…", {id: toastId});
      const receiptStatus = await waitForSettlement(net.id, settlement.txHash as Hex);
      if (receiptStatus !== "success") {
        setResult(settlement);
        setStatus({label: "Reverted", tone: "error"});
        toast.error("Settlement transaction reverted.", {id: toastId});
        setStep("idle");
        return;
      }

      // Backend records the settlement by reading the on-chain event — it trusts
      // the chain, not the client.
      setStep("verifying");
      toast.loading("Recording settlement…", {id: toastId});
      const verified = await apiPost<Record<string, unknown>>("/api/x402/settlement/verify", {
        network: net.id,
        txHash: settlement.txHash,
        nonce: settlement.nonce,
        seller: settlement.seller
      });
      const ok = verified?.verified === true;
      setResult({settlement, verification: verified});
      setStatus({label: ok ? "Settled" : "Unverified", tone: ok ? "ok" : "error"});
      toast[ok ? "success" : "error"](ok ? "Settlement complete — fee split on-chain." : "Could not verify settlement.", {id: toastId});
    } catch (error) {
      const message = userFacingPaymentError(error, "The settlement could not be completed.");
      setResult({error: message});
      setStatus({label: "Error", tone: "error"});
      toast.error(message, {id: toastId});
    } finally {
      setStep("idle");
    }
  }

  // Hidden entirely until at least one chain has a settlement contract deployed.
  if (networks.length === 0) return null;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-kicker">Nexora settlement · fee-collecting</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Settle x402 through Nexora's contract</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Sign a USDC authorization to Nexora's on-chain settlement contract and submit it from your own
            wallet. The contract forwards the net to the seller and splits Nexora's fee to the treasury —
            Nexora never custodies funds and pays no gas.
          </p>
        </div>
        <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-semibold text-mint">Self-owned</span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1.4fr_1fr_auto]">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Network</span>
          <select value={networkId} onChange={(event) => setNetworkId(event.target.value)} className="field mt-2 w-full">
            {networks.map((net) => <option key={net.id} value={net.id}>{net.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Seller</span>
          <input
            value={seller}
            onChange={(event) => setSeller(event.target.value)}
            placeholder="0xSellerWallet"
            className="field mt-2 w-full font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Amount (USDC)</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="field mt-2 w-full" />
        </label>
        <div className="flex items-end">
          <button type="button" className="action-button min-h-12 w-full whitespace-nowrap" onClick={() => void pay()} disabled={!isConnected || busy}>
            {busy ? <RefreshCw size={16} className="animate-spin" /> : <PenLine size={16} />}
            {stepLabel(step)}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck size={14} className="text-mint" />
        <span>Seller and fee ceiling are bound into the signed nonce, so a relayer can't redirect funds or overcharge.</span>
      </div>

      {status ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {status.tone === "ok" ? <CheckCircle2 size={16} className="text-mint" /> : <XCircle size={16} className="text-magenta" />}
            <span className={status.tone === "ok" ? "text-mint" : "text-magenta"}>{status.label}</span>
          </div>
          <JsonViewer title="POST /api/x402/settlement/verify" code={JSON.stringify(result ?? {}, null, 2)} status={status} />
        </div>
      ) : null}
    </section>
  );
}

function stepLabel(step: FlowStep): string {
  switch (step) {
    case "switching": return "Switching chain…";
    case "signing": return "Signing…";
    case "confirming": return "Confirming…";
    case "verifying": return "Recording…";
    default: return "Settle via Nexora";
  }
}
