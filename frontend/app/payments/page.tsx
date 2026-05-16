import {useState} from "react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

export default function PaymentsPage() {
  const {address, isConnected} = useAccount();
  const [status, setStatus] = useState("");
  const snapshot = useAppSnapshot();

  async function authorizePayment() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before authorizing an x402 payment.");
      return;
    }

    setStatus("Requesting x402 authorization...");
    try {
      const requestHash = `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`;
      const firstService = snapshot.data?.services[0];
      if (!firstService) {
        setStatus("Publish an x402 service before authorizing a payment.");
        return;
      }
      const result = await apiPost<{authorizationId: string; status: string}>("/api/x402/authorize", {
        serviceId: firstService.id,
        payer: address,
        requestHash,
        units: 1
      });
      await snapshot.refetch();
      setStatus(`x402 authorization ${result.authorizationId} ${result.status} for ${shortAddress(address)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "x402 authorization failed");
    }
  }

  return (
    <div className="panel">
      <div className="mb-5">
        <PageHeader
          kicker="Facilitator receipts"
          title="x402 USDC payment activity"
          description="Track authorizations, settlements, and policy-blocked requests."
          action={<button onClick={authorizePayment} className="action-button" disabled={!isConnected}>Authorize demo payment</button>}
        />
      </div>
      {status ? <p className="mb-5 break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-white/[0.08] text-slate-400">
            <tr>
              <th className="py-3">Request</th>
              <th>Service</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(snapshot.data?.payments ?? []).map((payment) => (
              <tr key={payment.id} className="border-b border-white/[0.07] transition hover:bg-white/[0.025]">
                <td className="py-4 font-mono text-slate-300">{payment.txHash ? shortAddress(payment.txHash) : shortAddress(payment.requestHash)}</td>
                <td className="text-white">{payment.serviceName}</td>
                <td>${payment.amountUsdc}</td>
                <td className={payment.status === "failed" || payment.status === "policy_blocked" ? "text-magenta" : "text-mint"}>{payment.status}</td>
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
