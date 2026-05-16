import {useState} from "react";
import {useAccount} from "wagmi";
import {publishX402Service} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";

export function PublishServiceForm() {
  const {address, isConnected} = useAccount();
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
    setStatus("Publishing service...");
    try {
      const {txHash, chainServiceId} = await publishX402Service({endpointHash, pricePerUnitUsdc: price});
      await apiPost("/api/marketplace/services", {
        publisherAddress: address,
        name,
        endpointHash,
        pricePerUnitUsdc: Number(price),
        chainServiceId,
        txHash
      });
      setStatus(`Service #${chainServiceId} submitted from ${shortAddress(address)}: ${txHash}`);
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
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Endpoint hash / manifest URI
        <input className="field" value={endpointHash} onChange={(event) => setEndpointHash(event.target.value)} placeholder="ipfs://..." />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Price per unit in USDC
        <input className="field" value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <button type="button" onClick={publish} className="action-button" disabled={!isConnected}>Publish x402 service on Arc</button>
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
