import {useEffect, useState} from "react";
import {CheckCircle2, Copy, ExternalLink, ReceiptText, ShieldCheck} from "lucide-react";
import toast from "react-hot-toast";
import {EmptyState} from "@/components/EmptyState";
import {PageHeader} from "@/components/PageHeader";
import {apiGet} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {formatTimestamp} from "@/lib/time";

type PublicReceipt = {
  id: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  amountUsdc?: number;
  feeUsdc?: number;
  netUsdc?: number;
  units?: number;
  payer?: string;
  publisherAddress?: string;
  creatorAddress?: string;
  counterpartyAddress?: string;
  operatorAddress?: string;
  actor?: string | null;
  counterparty?: string | null;
  agentWallet?: string | null;
  serviceId?: string;
  requestHash?: string;
  chainEscrowId?: number | null;
  plan?: string;
  interval?: string;
  txHash?: string | null;
  chainId?: number;
  network?: string;
  explorerUrl?: string | null;
  createdAt: string;
  settledAt?: string | null;
  releasedAt?: string | null;
  activatedAt?: string | null;
  fundedAt?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  event?: string;
  contract?: string;
  blockNumber?: number;
  logIndex?: number;
  memoBacked?: boolean;
  memo?: {
    memoId: string;
    memoData: {
      budgetBucket?: string;
      intent?: string;
      privacy?: {scope?: string};
      policy?: {mode?: string};
    };
    arc: {
      memoContract: string;
      targetContract?: string | null;
      callDataHash?: string | null;
      memoIndex?: number | null;
    };
  } | null;
  publicNote?: string | null;
};

export default function ReceiptPage({receiptId}: {receiptId: string}) {
  const [receipt, setReceipt] = useState<PublicReceipt | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void apiGet<{receipt: PublicReceipt}>(`/api/public/receipts/${encodeURIComponent(receiptId)}`)
      .then((data) => {
        setReceipt(data.receipt);
        setError("");
      })
      .catch((requestError) => {
        setReceipt(null);
        setError(requestError instanceof Error ? requestError.message : "Receipt unavailable");
      })
      .finally(() => setLoading(false));
  }, [receiptId]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Receipt link copied");
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="panel space-y-4">
          <div className="shimmer h-5 w-40 rounded" />
          <div className="shimmer h-9 w-3/5 rounded" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((item) => <div key={item} className="shimmer h-20 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!receipt) {
    return (
      <EmptyState
        icon={<ReceiptText size={26} />}
        title="Receipt not found"
        copy={error || "This public receipt link does not match a payment, escrow, plan, or indexed on-chain event."}
      />
    );
  }

  const primaryDate = receipt.settledAt ?? receipt.releasedAt ?? receipt.activatedAt ?? receipt.createdAt;
  const parties = receiptParties(receipt);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        kicker="Public receipt"
        title={receipt.title}
        description={receipt.description}
        action={
          <button type="button" className="secondary-button" onClick={() => void copyLink()}>
            <Copy size={15} /> Copy link
          </button>
        }
      />

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(receipt.status)}`}>
              <CheckCircle2 size={13} />
              {receipt.status.replaceAll("_", " ")}
            </span>
            <p className="mt-4 text-sm text-slate-500">Receipt ID</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-300">{receipt.id}</p>
          </div>
          <div className="rounded-xl border border-mint/25 bg-mint/10 px-5 py-4 text-right">
            <p className="text-xs uppercase tracking-wider text-slate-500">Amount</p>
            <p className="mt-1 text-3xl font-semibold text-mint">{usd(receipt.amountUsdc)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <ReceiptMetric label="Platform fee" value={usd(receipt.feeUsdc)} />
          <ReceiptMetric label="Net amount" value={usd(receipt.netUsdc)} />
          <ReceiptMetric label="Network" value={receipt.network ?? `Chain ${receipt.chainId ?? "-"}`} />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {parties.map((party) => (
            <div key={party.label} className="surface p-4">
              <p className="text-xs uppercase tracking-wider text-slate-500">{party.label}</p>
              <p className="mt-2 break-all font-mono text-sm text-white">{party.address}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
          <ReceiptRow label="Kind" value={receipt.kind.replaceAll("_", " ")} />
          <ReceiptRow label="Recorded" value={formatTimestamp(primaryDate)} />
          {receipt.units ? <ReceiptRow label="Units" value={String(receipt.units)} /> : null}
          {receipt.chainEscrowId ? <ReceiptRow label="Escrow ID" value={`#${receipt.chainEscrowId}`} /> : null}
          {receipt.plan ? <ReceiptRow label="Plan" value={receipt.plan.replaceAll("_", " ")} /> : null}
          {receipt.event ? <ReceiptRow label="On-chain event" value={receipt.event} /> : null}
          {receipt.blockNumber ? <ReceiptRow label="Block" value={String(receipt.blockNumber)} /> : null}
          {receipt.requestHash ? <ReceiptRow label="Request hash" value={shortAddress(receipt.requestHash)} mono /> : null}
          {receipt.txHash ? <ReceiptRow label="Transaction" value={shortAddress(receipt.txHash)} mono /> : null}
        </div>

        {receipt.memo ? (
          <div className="mt-5 rounded-xl border border-plasma/20 bg-plasma/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-plasma">Structured memo</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{receipt.memo.memoData.intent ?? "Agent payment context"}</h2>
              </div>
              <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-semibold text-mint">
                {receipt.memoBacked ? "memo backed" : "memo planned"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ReceiptRow label="Memo ID" value={shortAddress(receipt.memo.memoId)} mono />
              <ReceiptRow label="Budget bucket" value={receipt.memo.memoData.budgetBucket ?? "general"} />
              <ReceiptRow label="Policy mode" value={receipt.memo.memoData.policy?.mode ?? "auto"} />
              <ReceiptRow label="Privacy scope" value={receipt.memo.memoData.privacy?.scope ?? "public"} />
              <ReceiptRow label="Memo contract" value={shortAddress(receipt.memo.arc.memoContract)} mono />
              {receipt.memo.arc.callDataHash ? <ReceiptRow label="Call data hash" value={shortAddress(receipt.memo.arc.callDataHash)} mono /> : null}
              {receipt.memo.arc.memoIndex !== null && receipt.memo.arc.memoIndex !== undefined ? <ReceiptRow label="Memo index" value={String(receipt.memo.arc.memoIndex)} /> : null}
            </div>
          </div>
        ) : null}

        {receipt.publicNote ? (
          <p className="mt-5 rounded-xl border border-amber/25 bg-amber/10 p-4 text-sm leading-6 text-amber">{receipt.publicNote}</p>
        ) : null}

        {receipt.explorerUrl ? (
          <a href={receipt.explorerUrl} target="_blank" rel="noreferrer" className="action-button mt-5 inline-flex">
            View on explorer <ExternalLink size={15} />
          </a>
        ) : null}
      </section>

      <section className="surface flex items-start gap-3 p-4 text-sm leading-6 text-slate-400">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-mint" />
        This is a public receipt view. It shows payment metadata only and does not expose private escrow deliverables or API execution output.
      </section>
    </div>
  );
}

function ReceiptMetric({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-4 py-3">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );
}

function ReceiptRow({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right capitalize text-white ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function receiptParties(receipt: PublicReceipt) {
  const items = [
    ["Payer", receipt.payer],
    ["Publisher", receipt.publisherAddress],
    ["Creator", receipt.creatorAddress],
    ["Counterparty", receipt.counterpartyAddress],
    ["Operator", receipt.operatorAddress],
    ["Actor", receipt.actor],
    ["Recipient", receipt.counterparty],
    ["Agent wallet", receipt.agentWallet]
  ] as const;

  return items
    .filter(([, address]) => Boolean(address))
    .map(([label, address]) => ({label, address: address as string}))
    .slice(0, 4);
}

function statusClass(status: string) {
  if (["settled", "released", "active", "indexed"].includes(status)) return "border-mint/25 bg-mint/10 text-mint";
  if (["failed", "policy_blocked", "cancelled", "disputed"].includes(status)) return "border-magenta/25 bg-magenta/10 text-magenta";
  return "border-white/[0.12] bg-white/[0.04] text-slate-300";
}

function usd(value?: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})}`;
}
