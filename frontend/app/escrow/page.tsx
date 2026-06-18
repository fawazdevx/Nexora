import {Fragment, useState} from "react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {ArrowRight, Check, Circle, Copy, ExternalLink, FileText, Landmark, Loader2, ShieldCheck, Trash2, Wallet} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {EmptyState} from "@/components/EmptyState";
import {AgentAvatar} from "@/components/AgentAvatar";
import {apiDelete, apiPost} from "@/lib/api";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {createOnchainEscrow, fundOnchainEscrow, readOnchainEscrow, releaseOnchainEscrow, submitOnchainEscrow, verifyOnchainEscrow} from "@/lib/contracts";

type Escrow = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["escrows"][number];
type EscrowAction = "fund" | "submit" | "verify" | "release";

const escrowTemplates = [
  {title: "Analyze my website and send a growth report", description: "Review https://nexora.finance, list the top conversion issues, summarize SEO problems, and deliver a short action plan in a shared document.", amount: "10", bond: "1"},
  {title: "Review my GitHub repo for grant readiness", description: "Review https://github.com/fawazdev/nexora, summarize architecture clarity, missing docs, deployment risk, and what to improve before a grant demo.", amount: "12", bond: "1"},
  {title: "Check a contract before agent allowlisting", description: "Review contract 0x0000000000000000000000000000000000000000, list owner/admin risks, proxy concerns, and whether an agent should interact with it.", amount: "8", bond: "1"},
  {title: "Write an API integration checklist", description: "Create a deliverable checklist for integrating a paid x402 API, including input schema, payment settlement, result format, and policy requirements.", amount: "7", bond: "1"}
];

const STAGES: Array<[string, string]> = [
  ["draft", "Draft"],
  ["funded", "Funded"],
  ["submitted", "Submitted"],
  ["verified", "Verified"],
  ["released", "Released"]
];

const ACTION_LABEL: Record<EscrowAction, string> = {
  fund: "Fund escrow",
  submit: "Run agent & submit",
  verify: "Verify deliverable",
  release: "Release payment"
};

function txToast(title: string, hash: string) {
  const href = `${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
  return (
    <span>
      {title} ·{" "}
      <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-mint underline-offset-2 hover:underline">View tx</a>
    </span>
  );
}

export default function EscrowPage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const escrows = snapshot.data?.escrows ?? [];
  const [counterparty, setCounterparty] = useState("");
  const [title, setTitle] = useState(escrowTemplates[0].title);
  const [description, setDescription] = useState(escrowTemplates[0].description);
  const [amount, setAmount] = useState("10");
  const [bond, setBond] = useState("1");
  const [creating, setCreating] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const escrowConfigured = Boolean(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS);

  const inEscrow = escrows.filter((e) => ["funded", "submitted", "verified"].includes(e.status)).reduce((t, e) => t + Number(e.amountUsdc || 0), 0);
  const released = escrows.filter((e) => e.status === "released").reduce((t, e) => t + Number(e.amountUsdc || 0), 0);

  function applyTemplate(index: number) {
    const template = escrowTemplates[index];
    if (!template) return;
    setTitle(template.title);
    setDescription(template.description);
    setAmount(template.amount);
    setBond(template.bond);
  }

  async function createEscrow() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before creating an escrow.");
      return;
    }
    setCreating(true);
    const toastId = toast.loading("Creating escrow…");
    try {
      const chain = escrowConfigured
        ? await createOnchainEscrow({counterparty, amountUsdc: amount, performanceBondUsdc: bond, platformFeeBps: 100, title, description})
        : null;
      await apiPost("/api/escrows", {
        creatorAddress: address,
        counterpartyAddress: counterparty,
        title,
        description,
        amountUsdc: Number(amount),
        performanceBondUsdc: Number(bond),
        platformFeeBps: 100,
        chainEscrowId: chain?.chainEscrowId ?? null,
        txHash: chain?.txHash ?? null
      });
      await snapshot.refetch();
      toast.success(chain?.txHash ? txToast("Escrow created", chain.txHash) : "Escrow created.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Escrow creation failed", {id: toastId});
    } finally {
      setCreating(false);
    }
  }

  async function advance(id: string, action: EscrowAction) {
    const escrow = escrows.find((item) => item.id === id);
    if (!escrow) {
      toast.error("Escrow record was not found. Refresh and try again.");
      return;
    }
    setBusyAction(`${id}:${action}`);
    const toastId = toast.loading(`${ACTION_LABEL[action]}…`);
    try {
      const chainEscrowId = escrow.chainEscrowId ? String(escrow.chainEscrowId) : "";
      let txHash: string | null = null;
      if (escrowConfigured && chainEscrowId) {
        if (action === "fund") {
          txHash = (await fundOnchainEscrow(chainEscrowId, escrow.amountUsdc, escrow.performanceBondUsdc)).fundHash;
        }
        if (action === "submit") {
          await assertCanSubmitOnchain(chainEscrowId, address);
          toast.loading("Submitting deliverable on-chain…", {id: toastId});
          txHash = await submitOnchainEscrow(chainEscrowId, escrowDeliverableReference(escrow.id, escrow.description));
          toast.loading("Running Nexora agent…", {id: toastId});
        }
        if (action === "verify") {
          txHash = await verifyOnchainEscrow(chainEscrowId, "Verified by Nexora operator");
        }
        if (action === "release") {
          txHash = await releaseOnchainEscrow(chainEscrowId);
        }
      }
      await apiPost(
        `/api/escrows/${id}/${action}`,
        action === "submit"
          ? {operatorAddress: address, deliverableUrl: escrowDeliverableReference(escrow.id, escrow.description), autoExecute: true, txHash}
          : {operatorAddress: address, txHash}
      );
      await snapshot.refetch();
      toast.success(txHash ? txToast(`Escrow ${action} submitted`, txHash) : `Escrow ${action} recorded.`, {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Escrow update failed", {id: toastId});
    } finally {
      setBusyAction("");
    }
  }

  async function removeEscrow(id: string) {
    if (!address) {
      toast.error("Connect your wallet before removing an escrow.");
      return;
    }
    const escrow = escrows.find((item) => item.id === id);
    setBusyAction(`${id}:remove`);
    const toastId = toast.loading("Removing escrow…");
    try {
      await apiDelete(`/api/escrows/${id}`, {operatorAddress: address});
      await snapshot.refetch();
      toast.success(`Removed ${escrow?.title ?? "escrow"} from your workspace.`, {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Escrow removal failed", {id: toastId});
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Agent escrow"
        title="USDC work agreements"
        description="Hold USDC for a task, let the worker submit proof, then release payment after review."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatMetric variant="panel" icon={FileText} label="Agreements" value={escrows.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Wallet} label="Funds in escrow" value={inEscrow} prefix="$" decimals={2} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Landmark} label="Released" value={released} prefix="$" decimals={2} loading={snapshot.isLoading} />
      </div>

      <section className="panel">
        <p className="section-kicker">New agreement</p>
        <h2 className="page-title">Create a USDC work escrow</h2>

        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-slate-300">Start from a template</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {escrowTemplates.map((template, index) => {
              const active = template.title === title;
              return (
                <button
                  key={template.title}
                  type="button"
                  onClick={() => applyTemplate(index)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${active ? "border-plasma/40 bg-plasma/[0.1] text-white" : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:border-white/[0.16]"}`}
                >
                  <span className="min-w-0 truncate font-medium">{template.title}</span>
                  <span className="shrink-0 rounded-md border border-mint/25 bg-mint/10 px-2 py-0.5 text-xs font-bold text-mint">${template.amount}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-slate-300">
            Counterparty wallet
            <input className="field" value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="0x…" />
          </label>
          <label className="grid gap-2 text-sm text-slate-300">
            Title
            <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Analyze my website and send a growth report" />
          </label>
          <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
            Work details
            <textarea className="field min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the deliverable, links, and acceptance criteria." />
          </label>
          <label className="grid gap-2 text-sm text-slate-300">
            Payment USDC
            <MoneyInput value={amount} onChange={setAmount} />
          </label>
          <label className="grid gap-2 text-sm text-slate-300">
            Performance bond USDC
            <MoneyInput value={bond} onChange={setBond} />
          </label>
        </div>

        <button className="action-button mt-5" onClick={createEscrow} disabled={!isConnected || creating}>
          {creating ? <Loader2 size={16} className="animate-spin" /> : null}
          {creating ? "Creating…" : "Create escrow"}
        </button>
      </section>

      {snapshot.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((index) => (
            <div key={index} className="panel space-y-4">
              <div className="shimmer h-5 w-48 rounded" />
              <div className="shimmer h-2 w-full rounded" />
              <div className="shimmer h-16 w-full rounded-xl" />
              <div className="shimmer h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : escrows.length === 0 ? (
        isConnected ? (
          <EmptyState icon={<ShieldCheck size={26} />} title="No escrows yet" copy="Create a USDC work agreement above — fund it, let the worker submit, then release on approval." />
        ) : (
          <EmptyState icon={<Wallet size={26} />} title="Connect your wallet" copy="Connect a wallet to create and manage USDC work escrows." />
        )
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {escrows.map((escrow) => (
            <EscrowCard key={escrow.id} escrow={escrow} address={address} busyAction={busyAction} onAdvance={advance} onRemove={removeEscrow} />
          ))}
        </section>
      )}
    </div>
  );
}

function MoneyInput({value, onChange}: {value: string; onChange: (value: string) => void}) {
  return (
    <div className="field flex items-center gap-1 p-0 pl-3 pr-3">
      <span className="text-slate-500">$</span>
      <input className="min-w-0 flex-1 bg-transparent py-3 text-white outline-none" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function EscrowCard({escrow, address, busyAction, onAdvance, onRemove}: {escrow: Escrow; address?: string; busyAction: string; onAdvance: (id: string, action: EscrowAction) => void; onRemove: (id: string) => void}) {
  const role = escrowRole(address, escrow.creatorAddress, escrow.counterpartyAddress);
  const next = nextEscrowAction(role, escrow.status);
  const canRemove = (role === "creator" || role === "counterparty") && ["draft", "released", "cancelled"].includes(escrow.status);
  const visual = statusVisual(escrow.status);
  const otherParty = role === "counterparty" ? escrow.creatorAddress : escrow.counterpartyAddress;
  const relationship = role === "creator" ? "You → worker" : role === "counterparty" ? "Creator → you" : "Creator → worker";
  const busyNext = next ? busyAction === `${escrow.id}:${next.action}` : false;
  const removing = busyAction === `${escrow.id}:remove`;

  return (
    <article className="panel relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar seed={otherParty} label={null} size={40} />
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-white">{escrow.title}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{relationship} · {shortAddress(escrow.creatorAddress)} → {shortAddress(escrow.counterpartyAddress)}</p>
          </div>
        </div>
        <div className="shrink-0 rounded-xl border border-mint/25 bg-mint/10 px-3 py-1.5 text-right">
          <p className="text-lg font-bold text-mint">${escrow.amountUsdc}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">payment</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <StatusPill status={escrow.status} visual={visual} />
        {escrow.chainEscrowId ? (
          escrow.txHash ? (
            <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${escrow.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-orchid">
              #{escrow.chainEscrowId} on Arc <ExternalLink size={11} />
            </a>
          ) : (
            <span className="text-xs text-slate-500">#{escrow.chainEscrowId} on Arc</span>
          )
        ) : null}
        <ReceiptActions receiptId={escrow.id} />
      </div>

      {["cancelled", "disputed"].includes(escrow.status) ? (
        <p className="mt-4 rounded-xl border border-magenta/25 bg-magenta/10 px-4 py-2.5 text-sm font-medium text-magenta">This agreement was {escrow.status}.</p>
      ) : (
        <div className="mt-4"><Stepper status={escrow.status} /></div>
      )}

      <p className="mt-4 text-sm leading-6 text-slate-300">{escrow.description}</p>
      <DeliverableChecklist description={escrow.description} status={escrow.status} />
      <EscrowAgentResult result={escrow.deliverableResult} />

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <span className="surface px-3 py-2 text-slate-400">Amount <b className="text-white">${escrow.amountUsdc}</b></span>
        <span className="surface px-3 py-2 text-slate-400">Fee <b className="text-white">${escrow.platformFeeUsdc}</b></span>
        <span className="surface px-3 py-2 text-slate-400">Net <b className="text-white">${escrow.counterpartyNetUsdc}</b></span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {next ? (
          <button className="action-button flex-1" onClick={() => onAdvance(escrow.id, next.action)} disabled={busyNext}>
            {busyNext ? <Loader2 size={16} className="animate-spin" /> : null}
            {busyNext ? "Working…" : next.label}
            {!busyNext ? <ArrowRight size={15} /> : null}
          </button>
        ) : (
          <p className="flex-1 text-xs leading-5 text-slate-500">{escrowHint(role, escrow.status)}</p>
        )}
        {canRemove ? (
          <button className="secondary-button px-3" onClick={() => onRemove(escrow.id)} disabled={removing} aria-label="Remove escrow">
            {removing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ReceiptActions({receiptId}: {receiptId: string}) {
  const href = `/receipts/${encodeURIComponent(receiptId)}`;
  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}${href}`);
    toast.success("Receipt link copied");
  }

  return (
    <span className="ml-auto inline-flex items-center gap-1.5">
      <button type="button" className="secondary-button min-h-8 px-2 py-1 text-xs" onClick={() => void copy()} aria-label="Copy receipt link">
        <Copy size={12} />
      </button>
      <a className="secondary-button min-h-8 px-2 py-1 text-xs" href={href} aria-label="Open receipt">
        <ExternalLink size={12} />
      </a>
    </span>
  );
}

function Stepper({status}: {status: string}) {
  const activeIndex = STAGES.findIndex(([key]) => key === status);
  const last = STAGES.length - 1;
  return (
    <div className="flex">
      {STAGES.map(([key, label], index) => {
        const done = activeIndex >= 0 && index <= activeIndex;
        const current = index === activeIndex;
        return (
          <Fragment key={key}>
            <div className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span className={`h-px flex-1 ${index === 0 ? "opacity-0" : index <= activeIndex ? "bg-mint/50" : "bg-white/10"}`} />
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full transition ${current ? "bg-mint shadow-[0_0_10px_rgba(110,231,183,0.6)]" : done ? "bg-mint/70" : "bg-white/15"}`} />
                <span className={`h-px flex-1 ${index === last ? "opacity-0" : index < activeIndex ? "bg-mint/50" : "bg-white/10"}`} />
              </div>
              <span className={`mt-1.5 text-[10px] ${current ? "font-semibold text-white" : done ? "text-slate-400" : "text-slate-600"}`}>{label}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function StatusPill({status, visual}: {status: string; visual: ReturnType<typeof statusVisual>}) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${visual.pill}`}>
      <span className="relative flex h-2 w-2">
        {visual.ping ? <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${visual.dot} opacity-75`} /> : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${visual.dot}`} />
      </span>
      {status}
    </span>
  );
}

function statusVisual(status: string) {
  const s = status.toLowerCase();
  if (s === "released") return {pill: "border-mint/25 bg-mint/10 text-mint", dot: "bg-mint", ping: true};
  if (s === "verified") return {pill: "border-mint/25 bg-mint/10 text-mint", dot: "bg-mint", ping: false};
  if (s === "submitted") return {pill: "border-orchid/25 bg-orchid/10 text-orchid", dot: "bg-orchid", ping: false};
  if (s === "funded") return {pill: "border-cyan/25 bg-cyan/10 text-cyan", dot: "bg-cyan", ping: false};
  if (s === "cancelled" || s === "disputed") return {pill: "border-magenta/25 bg-magenta/10 text-magenta", dot: "bg-magenta", ping: false};
  return {pill: "border-white/[0.12] bg-white/[0.04] text-slate-300", dot: "bg-slate-500", ping: false};
}

function nextEscrowAction(role: string, status: string): {action: EscrowAction; label: string} | null {
  if (role === "creator" && status === "draft") return {action: "fund", label: ACTION_LABEL.fund};
  if (role === "counterparty" && status === "funded") return {action: "submit", label: ACTION_LABEL.submit};
  if (role === "creator" && status === "submitted") return {action: "verify", label: ACTION_LABEL.verify};
  if (role === "creator" && status === "verified") return {action: "release", label: ACTION_LABEL.release};
  return null;
}

function escrowDeliverableReference(escrowId: string, description: string) {
  const url = description.match(/https?:\/\/[^\s)]+/i)?.[0]?.replace(/[.,;:!?]+$/g, "");
  return url ?? `nexora://escrows/${escrowId}/deliverable`;
}

function DeliverableChecklist({description, status}: {description: string; status: string}) {
  const url = description.match(/https?:\/\/[^\s)]+/i)?.[0]?.replace(/[.,;:!?]+$/g, "");
  const items = [
    ["Scope defined", description.trim().length > 20],
    ["Reference link", Boolean(url)],
    ["Worker submitted", ["submitted", "verified", "released"].includes(status)],
    ["Creator verified", ["verified", "released"].includes(status)],
    ["Payment released", status === "released"]
  ] as const;
  return (
    <div className="surface mt-4 p-4">
      <p className="text-sm font-medium text-white">Deliverable checklist</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map(([label, done]) => (
          <div key={label} className="flex items-center gap-2 text-sm">
            {done ? <Check size={15} className="shrink-0 text-mint" /> : <Circle size={15} className="shrink-0 text-slate-600" />}
            <span className={done ? "text-slate-200" : "text-slate-500"}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

async function assertCanSubmitOnchain(chainEscrowId: string, address: string | undefined) {
  if (!address) throw new Error("Connect the counterparty wallet before submitting.");
  const escrow = await readOnchainEscrow(chainEscrowId);
  if (escrow.counterparty.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`Only the counterparty wallet can submit this escrow. Connected: ${shortAddress(address)}, counterparty: ${shortAddress(escrow.counterparty)}`);
  }
  if (Number(escrow.status) !== 1) {
    throw new Error(`This escrow is not funded on-chain yet. Current on-chain status: ${escrowStatusLabel(Number(escrow.status))}.`);
  }
}

function escrowStatusLabel(status: number) {
  return ["draft", "funded", "submitted", "verified", "released", "disputed", "cancelled"][status] ?? `unknown ${status}`;
}

function EscrowAgentResult({result}: {result: unknown}) {
  if (!result || typeof result !== "object") return null;
  const record = result as {kind?: string; input?: unknown; output?: unknown};
  const output = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : {};
  const status = typeof output.status === "string" ? output.status : "ok";
  const summary = typeof output.summary === "string"
    ? output.summary
    : typeof output.description === "string"
      ? output.description
      : typeof output.signal === "string"
        ? output.signal
        : "Agent execution completed.";

  return (
    <div className="mt-4 rounded-xl border border-mint/20 bg-mint/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">Agent deliverable</p>
        <span className="status-pill border-mint/20 bg-mint/10 text-mint">{String(record.kind ?? status).replaceAll("_", " ")}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-200">{summary}</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {numberMetric("Words", output.wordCount)}
        {numberMetric("Stars", output.stars)}
        {numberMetric("Score", output.score)}
      </div>
      {typeof output.title === "string" ? <p className="mt-3 text-sm text-slate-300">Title: <b className="text-white">{output.title}</b></p> : null}
      {typeof output.repo === "string" ? <p className="mt-3 text-sm text-slate-300">Repo: <b className="text-white">{output.repo}</b></p> : null}
    </div>
  );
}

function numberMetric(label: string, value: unknown) {
  if (typeof value !== "number") return null;
  return <span className="surface px-3 py-2">{label} <b className="text-white">{value}</b></span>;
}

function escrowRole(address: string | undefined, creator: string, counterparty: string) {
  const current = address?.toLowerCase();
  if (!current) return "viewer";
  if (current === creator.toLowerCase()) return "creator";
  if (current === counterparty.toLowerCase()) return "counterparty";
  return "viewer";
}

function escrowHint(role: string, status: string) {
  if (role === "creator" && status === "draft") return "You created this escrow. Fund it to lock USDC for the task.";
  if (role === "counterparty" && status === "funded") return "You are the worker. Submit the deliverable after finishing the task.";
  if (role === "creator" && status === "submitted") return "Review the submitted work. Verify it if it meets the agreement.";
  if (role === "creator" && status === "verified") return "Release the escrow to pay the worker and close the task.";
  if (role === "counterparty") return "Waiting on the creator to fund, verify, or release this escrow.";
  return "Connect the creator or counterparty wallet to take action.";
}
