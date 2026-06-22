import {useState} from "react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {Copy, ExternalLink} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {settleX402Request, type NexoraStructuredMemo} from "@/lib/contracts";

export default function PaymentsPage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();

  async function runDemoPayment() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before authorizing an x402 payment.");
      return;
    }

    setStatus("Preparing x402 demo payment...");
    try {
      const requestHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
      const firstService = snapshot.data?.services[0];
      if (!firstService) {
        setStatus("Publish an x402 service before authorizing a payment.");
        return;
      }
      const result = await apiPost<{authorizationId: string; status: string; settlement: {amountUsdc: number; memo?: NexoraStructuredMemo | null}}>("/api/x402/authorize", {
        serviceId: firstService.id,
        payer: address,
        requestHash,
        units: 1,
        privacyScope: "selective"
      });
      let txHash: string | null = null;
      if (firstService.chainServiceId) {
        setStatus(`Settling ${firstService.name} on Arc...`);
        const tx = await settleX402Request({
          chainServiceId: firstService.chainServiceId,
          requestHash: requestHash as `0x${string}`,
          payer: address,
          units: 1,
          amountUsdc: String(result.settlement.amountUsdc),
          memo: result.settlement.memo ?? null
        });
        txHash = tx.settleHash;
        await apiPost("/api/x402/settle", {
          authorizationId: result.authorizationId,
          txHash,
          memo: tx.memo,
          targetContract: tx.targetContract,
          callDataHash: tx.callDataHash,
          memoIndex: tx.memoIndex
        });
      } else {
        await apiPost("/api/x402/settle", {authorizationId: result.authorizationId, txHash, memo: result.settlement.memo ?? null});
      }
      await snapshot.refetch();
      setStatus(
        txHash
          ? `x402 payment settled for ${shortAddress(address)}: ${txHash}`
          : `Demo payment recorded for ${firstService.name}. Publish the service on-chain to enable wallet settlement.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "x402 payment failed");
    }
  }

  return (
    <div className="panel">
      <div className="mb-5">
        <PageHeader
          kicker="Facilitator receipts"
          title="x402 USDC payment activity"
          description="Track authorizations, settlements, and policy-blocked requests."
          action={<button onClick={runDemoPayment} className="action-button" disabled={!isConnected}>Run demo payment</button>}
        />
      </div>
      <p className="mb-5 rounded-md border border-white/[0.08] bg-white/[0.035] p-3 text-sm leading-6 text-slate-300">
        Payments are created when a buyer pays for a marketplace API. Publish an API first, then use Marketplace purchase or this demo button to create a receipt.
      </p>
      {status ? <p className="mb-5 break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-white/[0.08] text-slate-400">
            <tr>
              <th className="py-3">Request</th>
              <th>Service</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {(snapshot.data?.payments ?? []).map((payment) => (
              <tr key={payment.id} className="border-b border-white/[0.07] transition hover:bg-white/[0.025]">
                <td className="py-4 font-mono text-slate-300">{payment.txHash ? shortAddress(payment.txHash) : shortAddress(payment.requestHash)}</td>
                <td className="text-white">{payment.serviceName}</td>
                <td>${payment.amountUsdc}</td>
                <td className={payment.status === "failed" || payment.status === "policy_blocked" ? "text-magenta" : "text-mint"}>{payment.status}</td>
                <td><ReceiptActions receiptId={payment.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!snapshot.isLoading && (snapshot.data?.payments.length ?? 0) === 0 ? (
          <p className="py-5 text-sm text-slate-400">No x402 authorizations or settlements have been recorded yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function ReceiptActions({receiptId}: {receiptId: string}) {
  const href = `/receipts/${encodeURIComponent(receiptId)}`;
  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}${href}`);
    toast.success("Receipt link copied");
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="secondary-button min-h-9 px-2.5 py-1.5 text-xs" onClick={() => void copy()} aria-label="Copy receipt link">
        <Copy size={13} />
      </button>
      <a className="secondary-button min-h-9 px-2.5 py-1.5 text-xs" href={href} aria-label="Open receipt">
        <ExternalLink size={13} />
      </a>
    </span>
  );
}
