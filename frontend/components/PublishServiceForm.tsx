import {useState} from "react";
import {useAccount} from "wagmi";
import {CheckCircle2, Loader2} from "lucide-react";
import {contractAddressesForChain, publishX402Service} from "@/lib/contracts";
import {apiPost} from "@/lib/api";
import {marketplaceSettlementChains, shortAddress, switchToChain} from "@/lib/arc";

const serviceTemplates = [
  {
    kind: "wallet_risk_approval_scan",
    name: "Wallet Risk + Approval Scan",
    endpointHash: "wallet-risk-approval-scan-v1",
    price: "0.05",
    description: "Scan full historical USDC Approval logs through configured RPCs, then check current allowance exposure before an agent pays or interacts."
  },
  {
    kind: "agent_transaction_preflight",
    name: "Agent Transaction Preflight",
    endpointHash: "agent-transaction-preflight-v1",
    price: "0.035",
    description: "Run a live Tenderly or RPC transaction preflight before an agent signs or submits a contract call."
  },
  {
    kind: "stablecoin_route_report",
    name: "Stablecoin Treasury Route",
    endpointHash: "stablecoin-treasury-route-v1",
    price: "0.04",
    description: "Compare USDC and EURC routing, balances, fees, and settlement readiness for treasury or agent payment operations."
  },
  {
    kind: "policy_risk_review",
    name: "Agent Policy Guard Review",
    endpointHash: "agent-policy-guard-review-v1",
    price: "0.035",
    description: "Review agent caps, allowlists, cooldowns, expiry, and automation rules before enabling autonomous spend."
  },
  {
    kind: "invoice_collection_agent",
    name: "Invoice Collection Agent",
    endpointHash: "invoice-collection-agent-v1",
    price: "0.05",
    description: "Create a USDC invoice workflow with payment reminders, receipt checks, settlement status, and follow-up actions."
  },
  {
    kind: "escrow_milestone_monitor",
    name: "Escrow Milestone Monitor",
    endpointHash: "escrow-milestone-monitor-v1",
    price: "0.06",
    description: "Monitor escrow deadlines, milestone evidence, dispute risk, and recommended release or refund actions for user approval."
  },
  {
    kind: "contract_interaction_risk_scan",
    name: "Contract Interaction Risk Scan",
    endpointHash: "contract-interaction-risk-scan-v1",
    price: "0.04",
    description: "Check a target contract before an agent signs, approves, swaps, pays, or adds it to policy allowlists."
  },
  {
    kind: "counterparty_compliance_screen",
    name: "Counterparty Compliance Screen",
    endpointHash: "counterparty-compliance-screen-v1",
    price: "0.08",
    description: "Screen a wallet or business counterparty with live chain telemetry, Nexora local activity, and explicit KYT readiness."
  },
  {
    kind: "liquidation_risk_monitor",
    name: "Liquidation Risk Monitor",
    endpointHash: "liquidation-risk-monitor-v1",
    price: "0.07",
    description: "Monitor DeFi positions and alert users when liquidation, margin, or collateral risk rises above a policy threshold."
  },
  {
    kind: "vault_apy_monitor",
    name: "Vault APY Monitor",
    endpointHash: "vault-apy-monitor-v1",
    price: "0.04",
    description: "Track USDC yield APY, TVL, and risk from live DeFiLlama market data before users enable Save/Earn automation."
  },
  {
    kind: "subscription_payment_agent",
    name: "Subscription Payment Agent",
    endpointHash: "subscription-payment-agent-v1",
    price: "0.05",
    description: "Create a policy-controlled recurring USDC payment plan with approval rules and receipt expectations."
  },
  {
    kind: "publisher_revenue_intelligence",
    name: "Publisher Revenue Intelligence",
    endpointHash: "publisher-revenue-intelligence-v1",
    price: "0.04",
    description: "Analyze publisher x402 revenue, failed payments, pricing signals, and service conversion opportunities."
  },
  {
    kind: "dao_grant_payout_agent",
    name: "DAO / Grant Payout Agent",
    endpointHash: "dao-grant-payout-agent-v1",
    price: "0.06",
    description: "Plan USDC milestone payouts with recipient allowlists, approval rules, and receipt tracking."
  },
  {
    kind: "swap_route_quote_agent",
    name: "Swap / Route Quote Agent",
    endpointHash: "swap-route-quote-agent-v1",
    price: "0.04",
    description: "Review swap routes for slippage, quote freshness, token decimals, and execution safety."
  },
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
  const {address, isConnected} = useAccount();
  const [name, setName] = useState("");
  const [endpointHash, setEndpointHash] = useState("");
  const [price, setPrice] = useState("0.025");
  const [manifestKind, setManifestKind] = useState("generic");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [selectedChainIds, setSelectedChainIds] = useState<number[]>(marketplaceSettlementChains.map((chain) => chain.id));
  const [publishedChainIds, setPublishedChainIds] = useState<number[]>([]);
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
    if (publishing) return;
    if (!isConnected || !address) {
      setStatus("Connect your wallet before publishing a service.");
      return;
    }
    if (!name.trim() || !endpointHash.trim()) {
      setStatus("Add a service name and endpoint hash before publishing.");
      return;
    }
    const targetChains = marketplaceSettlementChains.filter((chain) => selectedChainIds.includes(chain.id));
    if (targetChains.length === 0) {
      setStatus("Select at least one settlement network.");
      return;
    }
    const unconfigured = targetChains.filter((chain) => !contractAddressesForChain(chain.id).x402Ledger);
    if (unconfigured.length > 0) {
      setStatus(`Marketplace ledger configuration is missing for ${unconfigured.map((chain) => chain.name).join(", ")}.`);
      return;
    }

    setPublishing(true);
    setPublishedChainIds([]);
    const completed: number[] = [];
    try {
      for (const [index, target] of targetChains.entries()) {
        setStatus(`Route ${index + 1} of ${targetChains.length}: confirm the switch to ${target.name}, then publish the service.`);
        await switchToChain(target);
        const chainResult = await publishX402Service({
          endpointHash: endpointHash.trim(),
          pricePerUnitUsdc: price,
          chainId: target.id
        });
        await apiPost("/api/marketplace/services", {
          publisherAddress: address,
          name: name.trim(),
          endpointHash: endpointHash.trim(),
          pricePerUnitUsdc: Number(price),
          chainServiceId: chainResult.chainServiceId,
          settlementChainId: target.id,
          txHash: chainResult.txHash,
          manifestKind,
          description,
          platformFeeBps,
          webhookUrl: webhookUrl || null
        });
        completed.push(target.id);
        setPublishedChainIds([...completed]);
      }
      setStatus(`Published ${name.trim()} from ${shortAddress(address)} on ${targetChains.map((chain) => chain.name).join(", ")}.`);
    } catch (error) {
      const prefix = completed.length > 0
        ? `${completed.length} of ${targetChains.length} routes were published and saved. `
        : "";
      setStatus(`${prefix}${error instanceof Error ? error.message : "Marketplace publishing failed."}`);
    } finally {
      setPublishing(false);
    }
  }

  function toggleSettlementChain(chainId: number) {
    if (publishing) return;
    setSelectedChainIds((current) => (
      current.includes(chainId)
        ? current.filter((value) => value !== chainId)
        : [...current, chainId]
    ));
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
        <span className="text-xs leading-5 text-slate-500">Strong mainnet examples: Wallet Risk Scan, Invoice Collection Agent, Escrow Milestone Monitor, Treasury Route, Compliance Screen.</span>
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        Endpoint hash / manifest URI
        <input className="field" value={endpointHash} onChange={(event) => setEndpointHash(event.target.value)} placeholder="website-analyzer-v1" />
        <span className="text-xs leading-5 text-slate-500">Use a stable endpoint hash or manifest URI. Built-in hashes execute in Nexora; custom hashes should point to your SDK-protected API.</span>
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
          <option value="wallet_risk_approval_scan">Wallet Risk + Approval Scan</option>
          <option value="agent_transaction_preflight">Agent Transaction Preflight</option>
          <option value="contract_interaction_risk_scan">Contract Interaction Risk Scan</option>
          <option value="invoice_collection_agent">Invoice Collection Agent</option>
          <option value="escrow_milestone_monitor">Escrow Milestone Monitor</option>
          <option value="counterparty_compliance_screen">Counterparty Compliance Screen</option>
          <option value="liquidation_risk_monitor">Liquidation Risk Monitor</option>
          <option value="vault_apy_monitor">Vault APY Monitor</option>
          <option value="subscription_payment_agent">Subscription Payment Agent</option>
          <option value="publisher_revenue_intelligence">Publisher Revenue Intelligence</option>
          <option value="dao_grant_payout_agent">DAO / Grant Payout Agent</option>
          <option value="swap_route_quote_agent">Swap / Route Quote Agent</option>
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
      <fieldset className="grid gap-3">
        <legend className="text-sm text-slate-300">USDC settlement networks</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {marketplaceSettlementChains.map((target) => {
            const selected = selectedChainIds.includes(target.id);
            const published = publishedChainIds.includes(target.id);
            return (
              <button
                key={target.id}
                type="button"
                onClick={() => toggleSettlementChain(target.id)}
                disabled={publishing}
                aria-pressed={selected}
                className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  selected
                    ? "border-mint/35 bg-mint/10 text-white"
                    : "border-white/[0.1] bg-white/[0.04] text-slate-400 hover:border-mint/25"
                }`}
              >
                <span>
                  <span className="block font-semibold">{target.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">USDC · Ledger route</span>
                </span>
                {published || selected ? <CheckCircle2 size={16} className={published ? "text-mint" : "text-slate-400"} /> : null}
              </button>
            );
          })}
        </div>
        <span className="text-xs leading-5 text-slate-500">Each selected network creates its own on-chain service ID. Your wallet will request one network switch and publication transaction per route.</span>
      </fieldset>
      <button type="button" onClick={publish} className="action-button" disabled={!isConnected || publishing || selectedChainIds.length === 0}>
        {publishing ? <Loader2 size={16} className="animate-spin" /> : null}
        {publishing ? "Publishing routes…" : `Publish on ${selectedChainIds.length} network${selectedChainIds.length === 1 ? "" : "s"}`}
      </button>
      {status ? <p className="break-all rounded-md border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-slate-300">{status}</p> : null}
    </form>
  );
}
