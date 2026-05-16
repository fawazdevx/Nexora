import {useState} from "react";
import {useAccount} from "wagmi";
import {writeAgentPolicy} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";

export function PolicyForm() {
  const {address, isConnected} = useAccount();
  const [agentWallet, setAgentWallet] = useState("");
  const [dailyLimit, setDailyLimit] = useState("400");
  const [transactionCap, setTransactionCap] = useState("45");
  const [contractAllowlist, setContractAllowlist] = useState("");
  const [recipientAllowlist, setRecipientAllowlist] = useState("");
  const [status, setStatus] = useState("");

  const contractAllowlistItems = splitAddresses(contractAllowlist);
  const recipientAllowlistItems = splitAddresses(recipientAllowlist);

  async function savePolicy() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before saving an agent policy.");
      return;
    }
    if (!agentWallet.startsWith("0x")) {
      setStatus("Enter a valid agent wallet address before submitting.");
      return;
    }
    setStatus("Submitting policy...");
    try {
      const txHash = await writeAgentPolicy({
        agentWallet,
        dailyLimitUsdc: dailyLimit,
        transactionCapUsdc: transactionCap,
        contractAllowlist: contractAllowlistItems,
        recipientAllowlist: recipientAllowlistItems,
        active: true
      });

      await apiPost("/api/agents/local/policies", {
        operatorAddress: address,
        dailyLimitUsdc: Number(dailyLimit),
        transactionCapUsdc: Number(transactionCap),
        contractAllowlist: contractAllowlistItems,
        recipientAllowlist: recipientAllowlistItems,
        txHash
      });

      setStatus(`Policy submitted from ${shortAddress(address)}: ${txHash}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Policy update failed");
    }
  }

  return (
    <>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="surface md:col-span-2 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="text-slate-400">Policy owner</span>
          <span className="font-mono text-white">{address ? shortAddress(address) : "Connect wallet"}</span>
        </div>
        <label className="grid gap-2 text-sm text-slate-300 md:col-span-2">
          Agent wallet address
          <input className="field" value={agentWallet} onChange={(event) => setAgentWallet(event.target.value)} placeholder="0x..." />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Daily spending limit
          <input className="field" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Transaction cap
          <input className="field" value={transactionCap} onChange={(event) => setTransactionCap(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Contract allowlist
          <textarea className="field min-h-24" value={contractAllowlist} onChange={(event) => setContractAllowlist(event.target.value)} placeholder="0x... one per line or comma separated" />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Recipient allowlist
          <textarea className="field min-h-24" value={recipientAllowlist} onChange={(event) => setRecipientAllowlist(event.target.value)} placeholder="0x... one per line or comma separated" />
        </label>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={savePolicy} className="action-button" disabled={!isConnected}>Save policy on Arc</button>
        <button className="danger-button">Pause agent</button>
        {status ? <span className="max-w-full break-all rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-300">{status}</span> : null}
      </div>
    </>
  );
}

function splitAddresses(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("0x"));
}
