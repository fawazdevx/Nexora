import type {ServiceManifest} from "../store.js";

export type CanonicalMarketplaceService = {
  name: string;
  endpointHash: string;
  pricePerUnitUsdc: number;
  manifestKind: ServiceManifest["kind"];
};

// Nexora-owned services are defined once and projected to every configured
// marketplace ledger. Endpoint hashes are the stable logical identifiers;
// chain-scoped service ids are only settlement routes.
export const CANONICAL_MARKETPLACE_SERVICES = [
  {
    name: "Website Growth Analyzer",
    endpointHash: "website-analyzer-v1",
    pricePerUnitUsdc: 0.025,
    manifestKind: "website_analyzer"
  },
  {
    name: "GitHub Repo Analyzer",
    endpointHash: "github-repo-analyzer-v1",
    pricePerUnitUsdc: 0.05,
    manifestKind: "github_repo_analyzer"
  },
  {
    name: "X Account Analyzer",
    endpointHash: "x-account-analyzer-v1",
    pricePerUnitUsdc: 0.035,
    manifestKind: "x_account_analyzer"
  },
  {
    name: "Contract Safety Check",
    endpointHash: "contract-safety-check-v1",
    pricePerUnitUsdc: 0.015,
    manifestKind: "contract_safety_check"
  },
  {
    name: "Landing Page Copy Reviewer",
    endpointHash: "landing-page-copy-reviewer-v1",
    pricePerUnitUsdc: 0.02,
    manifestKind: "landing_page_copy_reviewer"
  },
  {
    name: "Grant Application Reviewer",
    endpointHash: "grant-application-reviewer-v1",
    pricePerUnitUsdc: 0.03,
    manifestKind: "grant_application_reviewer"
  }
] as const satisfies readonly CanonicalMarketplaceService[];

export function canonicalMarketplaceService(endpointHash: string) {
  const normalized = endpointHash.trim().toLowerCase();
  return CANONICAL_MARKETPLACE_SERVICES.find((service) => service.endpointHash === normalized) ?? null;
}

