import type {NexoraPolicyHints, NexoraServiceKind, NexoraServiceManifest, NexoraServiceManifestInput} from "./types.js";

const KIND_CATEGORY: Record<NexoraServiceKind, string> = {
  website_analyzer: "data",
  github_repo_analyzer: "builder",
  x_account_analyzer: "data",
  contract_safety_check: "risk",
  wallet_activity_summary: "risk",
  landing_page_copy_reviewer: "data",
  grant_application_reviewer: "builder",
  meeting_brief: "data",
  arc_builder_research: "builder",
  domain_name_research: "data",
  social_content_audit: "data",
  stablecoin_route_report: "treasury",
  policy_risk_review: "risk",
  launch_readiness_check: "builder",
  x402_integration_planner: "builder",
  wallet_risk_approval_scan: "risk",
  agent_transaction_preflight: "risk",
  contract_interaction_risk_scan: "risk",
  invoice_collection_agent: "payments",
  escrow_milestone_monitor: "escrow",
  counterparty_compliance_screen: "compliance",
  liquidation_risk_monitor: "trading",
  vault_apy_monitor: "yield",
  subscription_payment_agent: "payments",
  publisher_revenue_intelligence: "builder",
  dao_grant_payout_agent: "payments",
  swap_route_quote_agent: "trading",
  generic: "builder"
};

const DEFAULT_DESCRIPTIONS: Record<NexoraServiceKind, string> = {
  website_analyzer: "Analyze a website and return metadata, structure, and growth recommendations.",
  github_repo_analyzer: "Review a public GitHub repository for maintenance and integration signals.",
  x_account_analyzer: "Review a public X account for social signal.",
  contract_safety_check: "Check a contract address before adding it to policy allowlists.",
  wallet_activity_summary: "Summarize wallet risk notes for agent payments.",
  landing_page_copy_reviewer: "Review page copy or a URL for clarity and conversion.",
  grant_application_reviewer: "Review a grant application for clarity and ecosystem fit.",
  meeting_brief: "Turn a meeting goal into agenda, questions, and follow-up actions.",
  arc_builder_research: "Research an Arc builder or project for collaboration angles.",
  domain_name_research: "Review a domain or product name for launch readiness.",
  social_content_audit: "Audit a post or thread draft for clarity and CTA quality.",
  stablecoin_route_report: "Analyze a stablecoin route for cost, risk, and readiness.",
  policy_risk_review: "Review agent policy settings and suggest safer caps.",
  launch_readiness_check: "Check a launch plan for docs, demo, proof, and security notes.",
  x402_integration_planner: "Create an x402 integration checklist for a paid API.",
  wallet_risk_approval_scan: "Scan full historical USDC Approval logs and current allowance exposure before agent payments.",
  agent_transaction_preflight: "Run a live transaction preflight before an agent signs or submits a contract call.",
  contract_interaction_risk_scan: "Review a contract interaction before an agent signs.",
  invoice_collection_agent: "Prepare a USDC invoice collection workflow.",
  escrow_milestone_monitor: "Monitor escrow milestones, evidence, and deadline risk.",
  counterparty_compliance_screen: "Screen counterparty wallets with live telemetry and explicit KYT readiness.",
  liquidation_risk_monitor: "Monitor DeFi liquidation risk thresholds and alerts.",
  vault_apy_monitor: "Monitor USDC yield APY, TVL, and risk from live market data.",
  subscription_payment_agent: "Prepare recurring USDC payment policy and approvals.",
  publisher_revenue_intelligence: "Analyze x402 publisher revenue and pricing signals.",
  dao_grant_payout_agent: "Prepare DAO or grant payout workflow with approvals.",
  swap_route_quote_agent: "Review a swap route quote for slippage and execution risk.",
  generic: "Hosted x402 API service."
};

export function createNexoraServiceManifest(input: NexoraServiceManifestInput): NexoraServiceManifest {
  const kind = input.kind ?? inferServiceKind(input.name, input.endpointHash);
  return {
    protocol: "nexora.service",
    version: input.version ?? "1.0.0",
    name: requiredText(input.name, "name", 120),
    endpointHash: stableId(input.endpointHash, "endpointHash"),
    kind,
    category: input.category ?? KIND_CATEGORY[kind],
    description: input.description?.trim() || DEFAULT_DESCRIPTIONS[kind],
    price: input.price,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    policyHints: policyHintsForKind(kind, input.price)
  };
}

export function policyHintsForKind(kind: NexoraServiceKind, price = "0.05"): NexoraPolicyHints {
  const numericPrice = safePrice(price);
  const highRisk = new Set<NexoraServiceKind>([
    "counterparty_compliance_screen",
    "liquidation_risk_monitor",
    "vault_apy_monitor",
    "subscription_payment_agent",
    "dao_grant_payout_agent",
    "swap_route_quote_agent",
    "agent_transaction_preflight",
    "contract_interaction_risk_scan"
  ]);
  const mediumRisk = new Set<NexoraServiceKind>([
    "wallet_risk_approval_scan",
    "contract_safety_check",
    "wallet_activity_summary",
    "stablecoin_route_report",
    "policy_risk_review",
    "escrow_milestone_monitor",
    "invoice_collection_agent"
  ]);
  const riskLevel: NexoraPolicyHints["riskLevel"] = highRisk.has(kind) ? "high" : mediumRisk.has(kind) ? "medium" : "low";
  const suggestedCap = Math.max(numericPrice * 2, riskLevel === "high" ? 5 : riskLevel === "medium" ? 10 : 25);
  return {
    suggestedTransactionCapUsdc: formatUsdc(suggestedCap),
    suggestedDailyLimitUsdc: formatUsdc(suggestedCap * (riskLevel === "high" ? 3 : 10)),
    requireOnchainPolicy: riskLevel !== "low",
    requiresHumanApproval: riskLevel === "high",
    riskLevel,
    notes: [
      "Keep first production executions low value.",
      riskLevel === "high" ? "Require user approval before money movement." : "Use service allowlists for agent execution.",
      "Send a receipt or webhook event after settlement."
    ]
  };
}

export function inferServiceKind(name: string, endpointHash = ""): NexoraServiceKind {
  const marker = `${name} ${endpointHash}`.toLowerCase();
  if (marker.includes("wallet risk") || marker.includes("approval scan")) return "wallet_risk_approval_scan";
  if (marker.includes("transaction preflight") || marker.includes("agent preflight") || marker.includes("preflight simulation")) return "agent_transaction_preflight";
  if (marker.includes("contract interaction")) return "contract_interaction_risk_scan";
  if (marker.includes("invoice")) return "invoice_collection_agent";
  if (marker.includes("escrow")) return "escrow_milestone_monitor";
  if (marker.includes("compliance") || marker.includes("counterparty")) return "counterparty_compliance_screen";
  if (marker.includes("liquidation")) return "liquidation_risk_monitor";
  if (marker.includes("vault") || marker.includes("apy")) return "vault_apy_monitor";
  if (marker.includes("subscription")) return "subscription_payment_agent";
  if (marker.includes("revenue")) return "publisher_revenue_intelligence";
  if (marker.includes("dao") || marker.includes("grant payout")) return "dao_grant_payout_agent";
  if (marker.includes("swap") || marker.includes("quote")) return "swap_route_quote_agent";
  if (marker.includes("stablecoin") || marker.includes("route")) return "stablecoin_route_report";
  if (marker.includes("policy")) return "policy_risk_review";
  if (marker.includes("x402")) return "x402_integration_planner";
  if (marker.includes("github")) return "github_repo_analyzer";
  if (marker.includes("website")) return "website_analyzer";
  return "generic";
}

function stableId(value: string, label: string) {
  const text = requiredText(value, label, 160);
  if (!/^[a-zA-Z0-9._:/-]+$/.test(text)) throw new Error(`${label} must be a stable id or URI`);
  return text;
}

function requiredText(value: string, label: string, max: number) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} is too long`);
  return text;
}

function safePrice(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.05;
}

function formatUsdc(value: number) {
  return value.toFixed(6).replace(/\.?0+$/, "");
}
