import {useEffect, useMemo, useState} from "react";
import {useAccount} from "wagmi";
import {writeAgentPolicy} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

const contractOptions = [
  {
    label: "x402 payments",
    address: import.meta.env.VITE_X402_LEDGER_ADDRESS,
    description: "Marketplace API payments and settlement"
  },
  {
    label: "Reputation",
    address: import.meta.env.VITE_REPUTATION_ADDRESS,
    description: "Operator reputation updates"
  },
  {
    label: "Policy registry",
    address: import.meta.env.VITE_POLICY_REGISTRY_ADDRESS,
    description: "Agent spending rule management"
  }
].filter((item): item is {label: string; address: string; description: string} => Boolean(item.address?.startsWith("0x")));

export function PolicyForm() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = useMemo(() => snapshot.data?.agents ?? [], [snapshot.data?.agents]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [dailyLimit, setDailyLimit] = useState("400");
  const [transactionCap, setTransactionCap] = useState("45");
  const [contractAllowlist, setContractAllowlist] = useState("");
  const [recipientAllowlist, setRecipientAllowlist] = useState("");
  const [status, setStatus] = useState("");

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const contractAllowlistItems = splitAddresses(contractAllowlist);
  const recipientAllowlistItems = splitAddresses(recipientAllowlist);
  const selectedContracts = new Set(contractAllowlistItems.map((item) => item.toLowerCase()));

  useEffect(() => {
    if (!selectedAgentId && agents[0]) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgent) return;
    setDailyLimit(String(selectedAgent.policy.dailyLimitUsdc));
    setTransactionCap(String(selectedAgent.policy.transactionCapUsdc));
    setContractAllowlist(selectedAgent.policy.contractAllowlist.join("\n"));
    setRecipientAllowlist(selectedAgent.policy.recipientAllowlist.join("\n"));
  }, [selectedAgent]);

  async function savePolicy() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before saving an agent policy.");
      return;
    }
    if (!selectedAgent) {
      setStatus("Create or select an agent wallet before saving a policy.");
      return;
    }

    setStatus(selectedAgent.address ? "Submitting policy on Arc..." : "Saving policy while Circle wallet is pending...");
    try {
      const txHash = selectedAgent.address
        ? await writeAgentPolicy({
            agentWallet: selectedAgent.address,
            operatorAddress: selectedAgent.operatorAddress,
            arcName: selectedAgent.arcName,
            dailyLimitUsdc: dailyLimit,
            transactionCapUsdc: transactionCap,
            contractAllowlist: contractAllowlistItems,
            recipientAllowlist: recipientAllowlistItems,
            active: true
          })
        : null;

      await apiPost(`/api/agents/${selectedAgent.id}/policies`, {
        operatorAddress: address,
        dailyLimitUsdc: Number(dailyLimit),
        transactionCapUsdc: Number(transactionCap),
        contractAllowlist: contractAllowlistItems,
        recipientAllowlist: recipientAllowlistItems,
        txHash
      });

      await snapshot.refetch();
      setStatus(
        txHash
          ? `Policy submitted from ${shortAddress(address)}: ${txHash}`
          : "Policy saved. It will be ready for on-chain submission when Circle returns the agent wallet address."
      );
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
          Agent
          <select className="field" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
            <option value="">Select an agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.arcName ?? shortAddress(agent.operatorAddress)} - {agent.address ? shortAddress(agent.address) : "Circle pending"}
              </option>
            ))}
          </select>
          {agents.length === 0 ? (
            <span className="text-xs leading-5 text-slate-500">No agent is available yet. Create an agent wallet first; once Circle returns or starts creating the wallet, it will appear here.</span>
          ) : null}
        </label>
        <div className="surface md:col-span-2 flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span className="text-slate-400">Agent wallet</span>
          <span className="font-mono text-white">{selectedAgent?.address ? shortAddress(selectedAgent.address) : selectedAgent ? "Circle pending" : "No agent selected"}</span>
        </div>
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
          <div className="grid gap-2">
            {contractOptions.map((contract) => {
              const checked = selectedContracts.has(contract.address.toLowerCase());
              return (
                <label key={contract.address} className="surface flex cursor-pointer items-center justify-between gap-3 px-3 py-3">
                  <span>
                    <span className="block text-sm font-medium text-white">{contract.label}</span>
                    <span className="mt-1 block text-xs text-slate-500">{contract.description} · {shortAddress(contract.address)}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setContractAllowlist(toggleAddress(contractAllowlistItems, contract.address, event.target.checked).join("\n"))}
                  />
                </label>
              );
            })}
          </div>
          <textarea className="field min-h-20" value={contractAllowlist} onChange={(event) => setContractAllowlist(event.target.value)} placeholder="0x... optional custom contract" />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Recipient allowlist
          <textarea className="field min-h-24" value={recipientAllowlist} onChange={(event) => setRecipientAllowlist(event.target.value)} placeholder="0x... one per line or comma separated" />
        </label>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button onClick={savePolicy} className="action-button" disabled={!isConnected || !selectedAgent}>
          {selectedAgent?.address ? "Save policy on Arc" : "Save pending policy"}
        </button>
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

function toggleAddress(addresses: string[], address: string, checked: boolean) {
  const normalized = address.toLowerCase();
  const withoutAddress = addresses.filter((item) => item.toLowerCase() !== normalized);
  return checked ? [...withoutAddress, address] : withoutAddress;
}
