import type {AppSnapshot} from "@/lib/api";

export type MarketplaceService = AppSnapshot["services"][number];
export type MarketplaceCategoryKey =
  | "all"
  | "risk"
  | "payments"
  | "treasury"
  | "escrow"
  | "trading"
  | "yield"
  | "compliance"
  | "data"
  | "builder";
export type MarketplaceReadinessTone = "mint" | "amber" | "slate";

export const MARKETPLACE_CATEGORY_LABELS: Record<MarketplaceCategoryKey, string> = {
  all: "All",
  risk: "Risk",
  payments: "Payments",
  treasury: "Treasury",
  escrow: "Escrow",
  trading: "Trading",
  yield: "Yield",
  compliance: "Compliance",
  data: "Data",
  builder: "Builder"
};

export const MARKETPLACE_CATEGORY_DESCRIPTIONS: Record<MarketplaceCategoryKey, string> = {
  all: "Every paid agent service",
  risk: "Transaction, wallet, policy, and contract safety checks",
  payments: "Invoices, receipts, subscriptions, and payment operations",
  treasury: "Stablecoin routing, balances, payouts, and cash operations",
  escrow: "Milestones, evidence review, deadline reminders, and disputes",
  trading: "Quotes, route checks, market data, and execution preparation",
  yield: "Vault monitoring, APY checks, and rebalance recommendations",
  compliance: "Counterparty screening, sanctions risk, and audit exports",
  data: "Research, social, domain, and private data APIs",
  builder: "Developer tooling, SDK planning, launch checks, and API ops"
};

export function serviceInputLabel(service: {manifest: {inputSchema: Array<{label: string}>}}) {
  return service.manifest.inputSchema[0]?.label ?? "";
}

export function serviceInputPlaceholder(service: {manifest: {inputSchema: Array<{placeholder?: string}>}}) {
  return service.manifest.inputSchema[0]?.placeholder ?? "";
}

export function sampleInputForService(service: MarketplaceService) {
  const kind = service.manifest.kind;
  if (kind === "website_analyzer") return "https://nexorafi.app";
  if (kind === "github_repo_analyzer") return "circlefin/evm-cctp-contracts";
  if (kind === "x_account_analyzer") return "@circle";
  if (kind === "contract_safety_check") return "0x3600000000000000000000000000000000000000";
  if (kind === "wallet_activity_summary") return service.publisherAddress;
  if (kind === "landing_page_copy_reviewer") return "Nexora helps builders monetize agent-facing APIs with Arc settlement, receipts, and policy controls.";
  if (kind === "grant_application_reviewer") return "We are building an Arc-native agent payment control center for x402 services, policies, receipts, and automation.";
  if (kind === "meeting_brief") return "Discuss Arc x402 integration with an API publisher and define launch next steps.";
  if (kind === "arc_builder_research") return "Circle x402 developer building paid API services on Arc";
  if (kind === "domain_name_research") return "nexorafi.app";
  if (kind === "social_content_audit") return "gm architects. New Nexora updates: memos, receipts, policy engine V2, and Arc settlement.";
  if (kind === "stablecoin_route_report") return "USDC on Arc to EURC through Synthra with 1% slippage cap";
  if (kind === "policy_risk_review") return "Daily 50 USDC, transaction cap 5 USDC, allow x402 ledger only, cooldown 60 seconds.";
  if (kind === "launch_readiness_check") return "Launch Nexora marketplace with on-chain x402 settlement, receipts, Telegram/email alerts, and publisher revenue dashboard.";
  if (kind === "x402_integration_planner") return "Paid GitHub repository analyzer endpoint in a Next.js API route using Arc USDC.";
  if (kind === "wallet_risk_approval_scan") return service.publisherAddress;
  if (kind === "contract_interaction_risk_scan") return "0x3600000000000000000000000000000000000000 approve 25 USDC for x402 settlement";
  if (kind === "invoice_collection_agent") return "Client: Arc Studio. Amount: 250 USDC. Due: 2026-07-15. Payee: 0x0000000000000000000000000000000000000000. Deliverable: integration review.";
  if (kind === "escrow_milestone_monitor") return "Milestone 1: UI complete due 2026-07-10. Milestone 2: x402 settlement demo due 2026-07-17. Amount: 500 USDC. Evidence links required before release.";
  if (kind === "counterparty_compliance_screen") return `${service.publisherAddress} payment suitability screen for a 250 USDC vendor payout`;
  if (kind === "liquidation_risk_monitor") return "Protocol: Aave. Chain: Base. Collateral: 2 ETH. Debt: 4200 USDC. Health factor: 1.32.";
  if (kind === "vault_apy_monitor") return "Arc USDC vault. APY 8.4%. TVL 2500000 USDC. Weekly rebalance allowed. Withdrawal delay 24h.";
  if (kind === "subscription_payment_agent") return "Vendor: API provider. Amount: 49 USDC monthly. Payee: 0x0000000000000000000000000000000000000000. Approval required if price changes.";
  if (kind === "publisher_revenue_intelligence") return service.publisherAddress;
  if (kind === "dao_grant_payout_agent") return "3 recipients, total 1500 USDC. Milestone: demo shipped. Due 2026-07-20. Reviewer approval required before payout.";
  if (kind === "swap_route_quote_agent") return "Swap 100 USDC to EURC on Arc with 1% slippage cap using best available route.";
  return service.manifest.inputSchema[0]?.placeholder ?? "";
}

export function executionArgs(service: {manifest: {kind: string; inputSchema: Array<{name: string}>}}, value: string) {
  const field = service.manifest.inputSchema[0]?.name;
  if (field) return {[field]: value};
  if (service.manifest.kind === "x_account_analyzer") return {handle: value};
  if (service.manifest.kind === "website_analyzer") return {url: value};
  if (service.manifest.kind === "github_repo_analyzer") return {repo: value};
  return {};
}

export function formatKind(value: string) {
  return value.replaceAll("_", " ");
}

export function serviceCategory(service: MarketplaceService): MarketplaceCategoryKey {
  const marker = [
    service.name,
    service.endpointHash,
    service.manifest.kind,
    service.manifest.description,
    service.manifest.outputSchema.join(" ")
  ].join(" ").toLowerCase();

  if (/(invoice|receipt|subscription|payout|payroll|payment|collection|billing)/.test(marker)) return "payments";
  if (/(escrow|milestone|dispute|release|refund|agreement|deadline)/.test(marker)) return "escrow";
  if (/(sanction|kyc|aml|compliance|counterparty|screening|audit export|travel rule)/.test(marker)) return "compliance";
  if (/(treasury|stablecoin|route|balance|cash|fx|eurc|usdc|payout|liquidity)/.test(marker)) return "treasury";
  if (/(trade|swap|quote|price|market|order|slippage|liquidation|margin|perp)/.test(marker)) return "trading";
  if (/(yield|vault|apy|rebalance|earn|strategy|deposit)/.test(marker)) return "yield";
  if (/(contract|policy|risk|approval|wallet|simulation|allowlist|safety|revoke|drain)/.test(marker)) return "risk";
  if (/(research|social|domain|meeting|brief|content|phone|trend|x account|twitter|data)/.test(marker)) return "data";
  return "builder";
}

export function formatCategory(category: MarketplaceCategoryKey) {
  return MARKETPLACE_CATEGORY_LABELS[category] ?? "Builder";
}

export function serviceReadiness(service: MarketplaceService): {label: string; tone: MarketplaceReadinessTone} {
  if (!service.active) return {label: "Inactive", tone: "amber"};
  if (!service.chainServiceId) return {label: "Needs ledger", tone: "amber"};
  if (service.manifest.inputSchema.length === 0) return {label: "No input", tone: "slate"};
  return {label: "Online", tone: "mint"};
}
