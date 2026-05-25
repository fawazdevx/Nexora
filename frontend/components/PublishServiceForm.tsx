import {useState} from "react";
import {useAccount} from "wagmi";
import {chainLabel, contractAddressesForChain, publishX402Service} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";

export function PublishServiceForm() {
  const {address, chain, isConnected} = useAccount();
  const x402LedgerConfigured = Boolean(contractAddressesForChain(chain?.id).x402Ledger);
  const [name, setName] = useState("");
  const [endpointHash, setEndpointHash] = useState("");
  const [price, setPrice] = useState("0.025");
  const [manifestKind, setManifestKind] = useState("generic");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState("");
  const platformFeeBps = 200;

  async function publish() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before publishing a service.");
      return;
    }
    if (!name.trim() || !endpointHash.trim()) {
      setStatus("Add a service name and endpoint hash before publishing.");
      return;
    }
    setStatus(x402LedgerConfigured ? `Publishing service on ${chainLabel(chain?.id)}...` : "Publishing service to Nexora registry...");
    try {
      const chainResult = x402LedgerConfigured ? await publishX402Service({endpointHash, pricePerUnitUsdc: price}) : null;
      await apiPost("/api/marketplace/services", {
        publisherAddress: address,
        name,
        endpointHash,
        pricePerUnitUsdc: Number(price),
        chainServiceId: chainResult?.chainServiceId ?? null,
        txHash: chainResult?.txHash ?? null,
        manifestKind,
        description,
        platformFeeBps,
        webhookUrl: webhookUrl || null
      });
      setStatus(
        chainResult
          ? `Service #${chainResult.chainServiceId} submitted from ${shortAddress(address)}: ${chainResult.txHash}`
          : `Service published from ${shortAddress(address)}. It can be tested off-chain until the x402 ledger is configured.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Publish failed");
    }
  }

  return (
    <form className="mt-6 grid gap-4">
      <label className="grid gap-2 text-sm text-slate-300">
        Publisher wallet
        <input className="field" value={address ? shortAddress(address) : "Connect wallet"} readOnly />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Service name
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Website Analyzer" />
        <span className="text-xs leading-5 text-slate-500">Examples: Website Analyzer, GitHub Repo Analyzer, X Account Analyzer, Contract Safety Check.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Endpoint hash / manifest URI
        <input className="field" value={endpointHash} onChange={(event) => setEndpointHash(event.target.value)} placeholder="website-analyzer-v1" />
        <span className="text-xs leading-5 text-slate-500">Use website-analyzer-v1, github-repo-analyzer-v1, or x-account-analyzer-v1 for built-in Nexora execution.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Manifest type
        <select className="field bg-slate-950 text-white" value={manifestKind} onChange={(event) => setManifestKind(event.target.value)}>
          <option value="generic">Generic API</option>
          <option value="website_analyzer">Website Analyzer</option>
          <option value="github_repo_analyzer">GitHub Repo Analyzer</option>
          <option value="x_account_analyzer">X Account Analyzer</option>
        </select>
        <span className="text-xs leading-5 text-slate-500">Choose the kind of API you are publishing. Nexora uses this to show the right input and result layout.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Description
        <textarea className="field min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short public description of the API." />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface px-4 py-3">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Platform fee</p>
          <p className="mt-2 text-sm text-white">{(platformFeeBps / 100).toFixed(2)}% to Nexora treasury</p>
        </div>
        <label className="grid gap-2 text-sm text-slate-300">
          Webhook URL
          <input className="field" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://api.example.com/webhook" />
        </label>
      </div>
      <label className="grid gap-2 text-sm text-slate-300">
        Price per unit in USDC
        <input className="field" value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <button type="button" onClick={publish} className="action-button" disabled={!isConnected}>
        {x402LedgerConfigured ? `Publish x402 service on ${chainLabel(chain?.id)}` : "Publish service"}
      </button>
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
