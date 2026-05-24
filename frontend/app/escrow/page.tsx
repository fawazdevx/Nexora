import {useState} from "react";
import {useAccount} from "wagmi";
import {PageHeader} from "@/components/PageHeader";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {createOnchainEscrow, fundOnchainEscrow, releaseOnchainEscrow, submitOnchainEscrow, verifyOnchainEscrow} from "@/lib/contracts";
import {useNotifications} from "@/components/Notifications";

export default function EscrowPage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const [counterparty, setCounterparty] = useState("");
  const [title, setTitle] = useState("Analyze my website and send a growth report");
  const [description, setDescription] = useState("Review https://nexora.finance, list the top conversion issues, summarize SEO problems, and deliver a short action plan in a shared document.");
  const [amount, setAmount] = useState("10");
  const [bond, setBond] = useState("1");
  const [status, setStatus] = useState("");
  const {notify} = useNotifications();
  const escrowConfigured = Boolean(import.meta.env.VITE_NEXORA_ESCROW_ADDRESS);

  async function createEscrow() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before creating an escrow.");
      return;
    }
    try {
      const chain = escrowConfigured
        ? await createOnchainEscrow({
            counterparty,
            amountUsdc: amount,
            performanceBondUsdc: bond,
            platformFeeBps: 100,
            title,
            description
          })
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
      notify({title: "Escrow created", detail: `${amount} USDC for ${title}`});
      setStatus(chain ? `Escrow created on Arc: ${chain.txHash}` : "Escrow created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Escrow creation failed");
    }
  }

  async function advance(id: string, action: "fund" | "submit" | "verify" | "release") {
    try {
      const escrow = snapshot.data?.escrows.find((item) => item.id === id);
      const chainEscrowId = escrow?.chainEscrowId ? String(escrow.chainEscrowId) : "";
      let txHash: string | null = null;
      if (escrowConfigured && escrow && chainEscrowId) {
        if (action === "fund") txHash = (await fundOnchainEscrow(chainEscrowId, escrow.amountUsdc, escrow.performanceBondUsdc)).fundHash;
        if (action === "submit") txHash = await submitOnchainEscrow(chainEscrowId, "https://example.com/deliverable");
        if (action === "verify") txHash = await verifyOnchainEscrow(chainEscrowId, "Verified by Nexora operator");
        if (action === "release") txHash = await releaseOnchainEscrow(chainEscrowId);
      }
      await apiPost(`/api/escrows/${id}/${action}`, action === "submit" ? {deliverableUrl: "https://example.com/deliverable", txHash} : {txHash});
      await snapshot.refetch();
      notify({title: `Escrow ${action}`, detail: escrow?.title ?? id});
      setStatus(txHash ? `Escrow ${action} submitted: ${txHash}` : `Escrow ${action} recorded.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Escrow update failed");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Agent escrow"
        title="USDC work agreements"
        description="Hold USDC for a task, let the worker submit proof, then release payment after review."
      />
      <section className="panel grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-300">
          Counterparty wallet
          <input className="field" value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="0x..." />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Title
          <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Analyze my website and send a growth report" />
        </label>
        <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
          Work details
          <textarea className="field min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Example: Review my website, list conversion issues, summarize SEO problems, and send a report link." />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Payment USDC
          <input className="field" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Performance bond USDC
          <input className="field" value={bond} onChange={(event) => setBond(event.target.value)} />
        </label>
        <button className="action-button md:col-span-2" onClick={createEscrow} disabled={!isConnected}>Create escrow</button>
        {status ? <p className="break-all text-sm text-slate-300 md:col-span-2">{status}</p> : null}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        {(snapshot.data?.escrows ?? []).map((escrow) => {
          const role = escrowRole(address, escrow.creatorAddress, escrow.counterpartyAddress);
          const canFund = role === "creator" && escrow.status === "draft";
          const canSubmit = role === "counterparty" && escrow.status === "funded";
          const canVerify = role === "creator" && escrow.status === "submitted";
          const canRelease = role === "creator" && escrow.status === "verified";
          return (
          <article key={escrow.id} className="panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">{escrow.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{shortAddress(escrow.creatorAddress)} to {shortAddress(escrow.counterpartyAddress)}</p>
              </div>
              <span className="status-pill">{escrow.status}</span>
            </div>
            {escrow.chainEscrowId ? <p className="mt-3 text-xs text-slate-500">Escrow #{escrow.chainEscrowId} on Arc</p> : null}
            <p className="mt-4 text-sm leading-6 text-slate-300">{escrow.description}</p>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <span className="surface px-3 py-2">Amount <b className="text-white">${escrow.amountUsdc}</b></span>
              <span className="surface px-3 py-2">Fee <b className="text-white">${escrow.platformFeeUsdc}</b></span>
              <span className="surface px-3 py-2">Net <b className="text-white">${escrow.counterpartyNetUsdc}</b></span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => void advance(escrow.id, "fund")} disabled={!canFund}>Fund</button>
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => void advance(escrow.id, "submit")} disabled={!canSubmit}>Submit</button>
              <button className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => void advance(escrow.id, "verify")} disabled={!canVerify}>Verify</button>
              <button className="action-button min-h-10 px-3 py-2 text-sm" onClick={() => void advance(escrow.id, "release")} disabled={!canRelease}>Release</button>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{escrowHint(role, escrow.status)}</p>
          </article>
        );})}
      </section>
    </div>
  );
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
  if (role === "counterparty") return "Only the creator can fund, verify, or release this escrow.";
  return "Connect the creator or counterparty wallet to take action.";
}
