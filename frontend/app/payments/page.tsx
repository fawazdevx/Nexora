import {useMemo, useState} from "react";
import {AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, Play, ReceiptText, ShieldCheck, XCircle} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {EmptyState} from "@/components/EmptyState";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {apiPost, type AppSnapshot} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {formatTimestamp} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Snapshot = AppSnapshot;
type PaymentIntent = Snapshot["paymentIntents"][number];
type Payment = Snapshot["payments"][number];

export default function PaymentsPage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const intents = useMemo(
    () => [...(snapshot.data?.paymentIntents ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [snapshot.data?.paymentIntents]
  );
  const payments = useMemo(
    () => [...(snapshot.data?.payments ?? [])].sort((a, b) => Date.parse(b.settledAt ?? b.createdAt) - Date.parse(a.settledAt ?? a.createdAt)),
    [snapshot.data?.payments]
  );
  const pending = intents.filter((intent) => intent.status === "pending_approval");
  const approved = intents.filter((intent) => intent.status === "approved" || intent.status === "executing");
  const failed = intents.filter((intent) => intent.status === "failed" || intent.status === "policy_blocked" || intent.status === "expired");

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="Payments"
        title="Approval and execution queue"
        description="Review policy decisions, risk flags, recipients, chains, Circle execution state, transaction hashes, and receipt links for governed agent payments."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={ShieldCheck} label="Pending approval" value={pending.length} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Play} label="Ready to execute" value={approved.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ReceiptText} label="Receipts" value={payments.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={AlertTriangle} label="Needs review" value={failed.length} loading={snapshot.isLoading} />
      </div>

      {!isConnected || !address ? (
        <EmptyState
          icon={<ShieldCheck size={26} />}
          title="Connect an operator wallet"
          copy="Connect the wallet that owns the agent policy to approve and execute payment intents."
        />
      ) : null}

      {isConnected && address ? (
        <section className="panel">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-kicker">Payment intents</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Governed actions waiting on an operator</h2>
            </div>
            <span className="status-pill">{intents.length} total</span>
          </div>

          {snapshot.isLoading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((item) => <div key={item} className="shimmer h-44 rounded-xl" />)}
            </div>
          ) : intents.length === 0 ? (
            <EmptyState
              icon={<ReceiptText size={26} />}
              title="No payment intents"
              copy="Use Circle Bridge to inspect a paid service and create a Nexora payment intent."
              className="border-0 bg-transparent p-0 py-8 shadow-none"
            />
          ) : (
            <div className="grid gap-3">
              {intents.map((intent) => <IntentCard key={intent.id} intent={intent} operatorAddress={address} onChanged={() => snapshot.refetch()} />)}
            </div>
          )}
        </section>
      ) : null}

      <section className="panel">
        <div className="mb-5">
          <p className="section-kicker">Receipts</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Execution audit trail</h2>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-white/[0.08] text-slate-400">
              <tr>
                <th className="py-3">Request</th>
                <th>Service</th>
                <th>Source</th>
                <th>Recipient</th>
                <th>Chain</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-white/[0.07] transition hover:bg-white/[0.025]">
                  <td className="py-4 font-mono text-slate-300">{payment.txHash ? shortAddress(payment.txHash) : shortAddress(payment.requestHash)}</td>
                  <td className="text-white">{payment.serviceName}</td>
                  <td>{payment.external?.provider === "circle_agent_marketplace" ? "Circle" : "Nexora x402"}</td>
                  <td className="font-mono text-xs text-slate-300">{shortAddress(payment.publisherAddress)}</td>
                  <td>{payment.external?.network ?? payment.external?.chain ?? "Arc"}</td>
                  <td>{usd(payment.amountUsdc)}</td>
                  <td><StatusPill status={payment.status} /></td>
                  <td><ReceiptActions receiptId={payment.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:hidden">
          {payments.map((payment) => <ReceiptCard key={payment.id} payment={payment} />)}
        </div>

        {!snapshot.isLoading && payments.length === 0 ? (
          <p className="py-5 text-sm text-slate-400">No settled, failed, or blocked payment receipts have been recorded yet.</p>
        ) : null}
      </section>
    </div>
  );
}

function IntentCard({intent, operatorAddress, onChanged}: {intent: PaymentIntent; operatorAddress: string; onChanged: () => Promise<unknown>}) {
  const [busy, setBusy] = useState<"approve" | "reject" | "execute" | null>(null);
  const canApprove = intent.status === "pending_approval" && intent.policy.allowed;
  const canReject = intent.status === "pending_approval";
  const canExecute = intent.status === "approved";
  const receiptId = intent.receiptId ?? intent.execution.paymentId ?? null;

  async function act(action: "approve" | "reject" | "execute") {
    setBusy(action);
    const toastId = toast.loading(action === "execute" ? "Executing Circle payment..." : action === "approve" ? "Approving payment..." : "Rejecting payment...");
    try {
      await apiPost(`/api/payment-intents/${encodeURIComponent(intent.id)}/${action}`, {
        operatorAddress,
        confirmed: action === "execute" ? true : undefined
      });
      await onChanged();
      toast.success(action === "execute" ? "Payment executed and receipt saved." : action === "approve" ? "Payment approved." : "Payment rejected.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payment action failed", {id: toastId});
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={intent.status} />
            <span className="status-pill">{intent.source.provider === "circle_agent_marketplace" ? "Circle" : intent.source.provider}</span>
            <span className="status-pill">{intent.normalized.chain}</span>
          </div>
          <h3 className="mt-3 text-lg font-semibold text-white">{intent.normalized.serviceName}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{intent.normalized.description}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-slate-500">Amount</p>
          <p className="mt-1 text-2xl font-semibold text-mint">{usd(intent.normalized.amountUsdc)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <IntentMetric label="Recipient" value={shortAddress(intent.normalized.payTo)} mono />
        <IntentMetric label="Agent wallet" value={intent.agentWallet ? shortAddress(intent.agentWallet) : "missing"} mono />
        <IntentMetric label="Policy" value={intent.policy.allowed ? "allowed" : intent.policy.reason ?? "blocked"} />
        <IntentMetric label="Execution" value={intent.execution.txHash ? shortAddress(intent.execution.txHash) : intent.execution.error ?? "not executed"} mono={Boolean(intent.execution.txHash)} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Policy decision</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {intent.policy.checks.map((check) => (
              <div key={`${check.label}-${check.detail}`} className="flex items-start gap-2 text-sm">
                {check.status === "pass" ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-mint" /> : <XCircle size={15} className="mt-0.5 shrink-0 text-magenta" />}
                <span>
                  <span className="block font-semibold text-white">{check.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-400">{check.detail}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Risk flags</p>
          <div className="mt-3 space-y-2">
            {intent.policy.riskFlags.length === 0 ? (
              <p className="text-sm text-slate-400">No elevated risk flags.</p>
            ) : (
              intent.policy.riskFlags.map((flag) => (
                <div key={`${flag.label}-${flag.detail}`} className="text-sm">
                  <p className={flag.severity === "critical" ? "font-semibold text-magenta" : "font-semibold text-amber"}>{flag.label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">{flag.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
        <div className="text-xs text-slate-500">
          <span className="font-mono">{shortAddress(intent.requestHash)}</span>
          <span className="mx-2">·</span>
          {formatTimestamp(intent.updatedAt)}
        </div>
        <div className="flex flex-wrap gap-2">
          {receiptId ? <ReceiptActions receiptId={receiptId} /> : null}
          <button type="button" className="secondary-button min-h-9 px-3 py-2 text-xs" disabled={!canReject || busy !== null} onClick={() => void act("reject")}>
            {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Reject
          </button>
          <button type="button" className="secondary-button min-h-9 px-3 py-2 text-xs" disabled={!canApprove || busy !== null} onClick={() => void act("approve")}>
            {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Approve
          </button>
          <button type="button" className="action-button min-h-9 px-3 py-2 text-xs" disabled={!canExecute || busy !== null} onClick={() => void act("execute")}>
            {busy === "execute" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Execute
          </button>
        </div>
      </div>
    </article>
  );
}

function ReceiptCard({payment}: {payment: Payment}) {
  return (
    <div className="surface p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-white">{payment.serviceName}</p>
          <p className="mt-1 font-mono text-xs text-slate-400">{payment.txHash ? shortAddress(payment.txHash) : shortAddress(payment.requestHash)}</p>
        </div>
        <ReceiptActions receiptId={payment.id} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-500">
        <span>{payment.external?.provider === "circle_agent_marketplace" ? "Circle" : "Nexora x402"} · {payment.external?.network ?? payment.external?.chain ?? "Arc"}</span>
        <span>Recipient {shortAddress(payment.publisherAddress)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <StatusPill status={payment.status} />
        <span className="font-semibold text-white">{usd(payment.amountUsdc)}</span>
      </div>
    </div>
  );
}

function IntentMetric({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold text-white ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function StatusPill({status}: {status: string}) {
  const tone = status === "settled" || status === "approved"
    ? "border-mint/25 bg-mint/10 text-mint"
    : status === "failed" || status === "policy_blocked" || status === "rejected" || status === "expired"
    ? "border-magenta/25 bg-magenta/10 text-magenta"
    : "border-amber/25 bg-amber/10 text-amber";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}>{status.replaceAll("_", " ")}</span>;
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

function usd(value?: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})}`;
}
