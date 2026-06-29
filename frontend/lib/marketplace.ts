import type {AppSnapshot} from "@/lib/api";

export type MarketplaceService = AppSnapshot["services"][number];
export type MarketplaceCategoryKey = "all" | "builder" | "security" | "wallet" | "content" | "stablecoin";
export type MarketplaceReadinessTone = "mint" | "amber" | "slate";

export const MARKETPLACE_CATEGORY_LABELS: Record<MarketplaceCategoryKey, string> = {
  all: "All",
  builder: "Builder",
  security: "Security",
  wallet: "Wallet",
  content: "Content",
  stablecoin: "Stablecoin"
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
  const kind = service.manifest.kind;
  if (kind.includes("contract") || kind.includes("policy") || kind.includes("risk")) return "security";
  if (kind.includes("wallet")) return "wallet";
  if (kind.includes("social") || kind.includes("copy") || kind.includes("domain") || kind.includes("meeting")) return "content";
  if (kind.includes("stablecoin") || kind.includes("route")) return "stablecoin";
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
