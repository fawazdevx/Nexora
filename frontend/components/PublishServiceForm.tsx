import {useState} from "react";
import {useAccount} from "wagmi";
import {publishX402Service} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";

export function PublishServiceForm() {
  const {address, isConnected} = useAccount();
  const x402LedgerConfigured = Boolean(import.meta.env.VITE_X402_LEDGER_ADDRESS);
  const [name, setName] = useState("");
  const [endpointHash, setEndpointHash] = useState("");
  const [price, setPrice] = useState("0.025");
  const [status, setStatus] = useState("");

  async function publish() {
    if (!isConnected || !address) {
      setStatus("Connect your wallet before publishing a service.");
      return;
    }
    if (!name.trim() || !endpointHash.trim()) {
      setStatus("Add a service name and endpoint hash before publishing.");
      return;
    }
    setStatus(x402LedgerConfigured ? "Publishing service on Arc..." : "Publishing service to Nexora registry...");
    try {
      const chainResult = x402LedgerConfigured ? await publishX402Service({endpointHash, pricePerUnitUsdc: price}) : null;
      await apiPost("/api/marketplace/services", {
        publisherAddress: address,
        name,
        endpointHash,
        pricePerUnitUsdc: Number(price),
        chainServiceId: chainResult?.chainServiceId ?? null,
        txHash: chainResult?.txHash ?? null
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
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Stablecoin Risk Oracle" />
        <span className="text-xs leading-5 text-slate-500">Examples: risk score API, AI summarizer API, token price feed, compliance check endpoint, transaction simulation endpoint.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Endpoint hash / manifest URI
        <input className="field" value={endpointHash} onChange={(event) => setEndpointHash(event.target.value)} placeholder="ipfs://..." />
        <span className="text-xs leading-5 text-slate-500">Publish a manifest URI or endpoint hash that describes where buyers can call your API after x402 payment authorization.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Price per unit in USDC
        <input className="field" value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <button type="button" onClick={publish} className="action-button" disabled={!isConnected}>
        {x402LedgerConfigured ? "Publish x402 service on Arc" : "Publish service"}
      </button>
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
