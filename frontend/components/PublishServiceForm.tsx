import {useState} from "react";
import {useAccount} from "wagmi";
import {chainLabel, contractAddressesForChain, publishX402Service} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";

const serviceTemplates = [
  {
    kind: "website_analyzer",
    name: "Website Growth Analyzer",
    endpointHash: "website-analyzer-v1",
    price: "0.025",
    description: "Analyze a website and return conversion, metadata, headings, and growth recommendations."
  },
  {
    kind: "github_repo_analyzer",
    name: "GitHub Repo Analyzer",
    endpointHash: "github-repo-analyzer-v1",
    price: "0.025",
    description: "Review a public GitHub repo for traction, maintenance signal, license, README quality, and activity."
  },
  {
    kind: "contract_safety_check",
    name: "Contract Safety Check",
    endpointHash: "contract-safety-check-v1",
    price: "0.015",
    description: "Check a contract address and return a policy-focused safety checklist before agents interact with it."
  },
  {
    kind: "wallet_activity_summary",
    name: "Wallet Activity Summary",
    endpointHash: "wallet-activity-summary-v1",
    price: "0.015",
    description: "Summarize wallet recipient risk notes and recommended spend policy for agent payments."
  },
  {
    kind: "landing_page_copy_reviewer",
    name: "Landing Page Copy Reviewer",
    endpointHash: "landing-page-copy-reviewer-v1",
    price: "0.02",
    description: "Review page copy or a URL for clarity, conversion issues, and better CTA structure."
  },
  {
    kind: "grant_application_reviewer",
    name: "Grant Application Reviewer",
    endpointHash: "grant-application-reviewer-v1",
    price: "0.03",
    description: "Review a grant summary for infrastructure clarity, revenue proof, and ecosystem fit."
  },
  {
    kind: "meeting_brief",
    name: "Meeting Brief Agent",
    endpointHash: "meeting-brief-v1",
    price: "0.02",
    description: "Turn a meeting goal into agenda points, questions, and follow-up actions."
  },
  {
    kind: "arc_builder_research",
    name: "Arc Builder Research",
    endpointHash: "arc-builder-research-v1",
    price: "0.025",
    description: "Research an Arc builder, project, or integration idea and return collaboration angles."
  },
  {
    kind: "domain_name_research",
    name: "Domain Name Research",
    endpointHash: "domain-name-research-v1",
    price: "0.015",
    description: "Review a domain or product name for trust, positioning, and launch readiness."
  },
  {
    kind: "social_content_audit",
    name: "Social Content Audit",
    endpointHash: "social-content-audit-v1",
    price: "0.02",
    description: "Review an announcement, post, or thread draft for clarity, proof, and CTA quality."
  },
  {
    kind: "stablecoin_route_report",
    name: "Stablecoin Route Report",
    endpointHash: "stablecoin-route-report-v1",
    price: "0.02",
    description: "Analyze a stablecoin swap, bridge, or Save/Earn route for risk and integration readiness."
  },
  {
    kind: "policy_risk_review",
    name: "Agent Policy Risk Review",
    endpointHash: "policy-risk-review-v1",
    price: "0.025",
    description: "Review agent policy settings and return suggested caps, allowlist notes, and risk level."
  },
  {
    kind: "launch_readiness_check",
    name: "Launch Readiness Check",
    endpointHash: "launch-readiness-check-v1",
    price: "0.03",
    description: "Check a launch plan for docs, demo, contract proof, receipts, and security notes."
  },
  {
    kind: "x402_integration_planner",
    name: "x402 Integration Planner",
    endpointHash: "x402-integration-planner-v1",
    price: "0.025",
    description: "Create a practical x402 integration checklist for a paid API endpoint."
  }
] as const;

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

  function applyTemplate(index: string) {
    const template = serviceTemplates[Number(index)];
    if (!template) return;
    setName(template.name);
    setEndpointHash(template.endpointHash);
    setPrice(template.price);
    setManifestKind(template.kind);
    setDescription(template.description);
  }

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
          : `Service published from ${shortAddress(address)}. It is saved as a draft until on-chain publishing is available.`
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
        Quick template
        <select className="field bg-slate-950 text-white" defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
          <option value="">Choose a starter API</option>
          {serviceTemplates.map((template, index) => <option key={template.endpointHash} value={index}>{template.name}</option>)}
        </select>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Service name
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Website Analyzer" />
        <span className="text-xs leading-5 text-slate-500">Examples: Website Analyzer, GitHub Repo Analyzer, Meeting Brief Agent, x402 Integration Planner.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Endpoint hash / manifest URI
        <input className="field" value={endpointHash} onChange={(event) => setEndpointHash(event.target.value)} placeholder="website-analyzer-v1" />
        <span className="text-xs leading-5 text-slate-500">Use a built-in endpoint hash like website-analyzer-v1, meeting-brief-v1, or x402-integration-planner-v1 for Nexora execution.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Manifest type
        <select className="field bg-slate-950 text-white" value={manifestKind} onChange={(event) => setManifestKind(event.target.value)}>
          <option value="generic">Generic API</option>
          <option value="website_analyzer">Website Analyzer</option>
          <option value="github_repo_analyzer">GitHub Repo Analyzer</option>
          <option value="x_account_analyzer">X Account Analyzer</option>
          <option value="contract_safety_check">Contract Safety Check</option>
          <option value="wallet_activity_summary">Wallet Activity Summary</option>
          <option value="landing_page_copy_reviewer">Landing Page Copy Reviewer</option>
          <option value="grant_application_reviewer">Grant Application Reviewer</option>
          <option value="meeting_brief">Meeting Brief Agent</option>
          <option value="arc_builder_research">Arc Builder Research</option>
          <option value="domain_name_research">Domain Name Research</option>
          <option value="social_content_audit">Social Content Audit</option>
          <option value="stablecoin_route_report">Stablecoin Route Report</option>
          <option value="policy_risk_review">Agent Policy Risk Review</option>
          <option value="launch_readiness_check">Launch Readiness Check</option>
          <option value="x402_integration_planner">x402 Integration Planner</option>
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
