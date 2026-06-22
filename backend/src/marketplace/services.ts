import {readStore, updateStore, visibleServicesForStore, type ServiceManifest, type ServiceRecord} from "../store.js";
import {pushNotification} from "../store.js";
import {config} from "../config.js";
import {dispatchNotification} from "../notifications.js";
import {safeHttpUrl} from "../security.js";

export type PlatformPlan = {
  id: "developer_analytics" | "premium_agent_automation" | "enterprise_policy" | "verified_builder";
  name: string;
  amountUsdc: number;
  interval: "month" | "one_time";
  benefit: string;
  features: string[];
};

const PLATFORM_PLANS = [
  {
    id: "developer_analytics",
    name: "Developer analytics",
    amountUsdc: 29,
    interval: "month",
    benefit: "API usage analytics and hosted service manifests",
    features: [
      "Per-service execution, gross, fee, and net revenue analytics",
      "Recent paid API execution receipts and x402 settlement links",
      "Builder revenue dashboard for published API services"
    ]
  },
  {
    id: "premium_agent_automation",
    name: "Premium agent automation",
    amountUsdc: 49,
    interval: "month",
    benefit: "Advanced controls for policy-driven agent payments",
    features: [
      "Weekly and monthly agent spending budgets",
      "Service allowlists, cooldowns, expiry, and max API unit limits",
      "On-chain policy enforcement requirement for agent payments"
    ]
  },
  {
    id: "enterprise_policy",
    name: "Enterprise wallet policy",
    amountUsdc: 299,
    interval: "month",
    benefit: "Multi-agent policy management and compliance export",
    features: ["Multi-agent policy management", "Compliance export", "Team review workflow"]
  },
  {
    id: "verified_builder",
    name: "Verified builder badge",
    amountUsdc: 15,
    interval: "one_time",
    benefit: "Reputation badge review and marketplace trust signal",
    features: ["Marketplace trust signal", "Builder profile review", "Public directory highlighting"]
  }
] satisfies PlatformPlan[];

type ServiceInput = {
  publisherAddress: string;
  name: string;
  endpointHash: string;
  pricePerUnitUsdc: number;
  chainServiceId?: number | null;
  txHash?: string | null;
  featured?: boolean;
  manifestKind?: ServiceManifest["kind"];
  description?: string | null;
  webhookUrl?: string | null;
  platformFeeBps?: number | null;
};

export async function listServices() {
  const store = await readStore();
  return visibleServicesForStore(store.services);
}

export async function getService(serviceId: string) {
  const store = await readStore();
  return visibleServicesForStore(store.services).find((service) => service.id === serviceId || String(service.chainServiceId) === serviceId);
}

export async function publishService(input: ServiceInput) {
  return updateStore((store) => {
    const manifest = buildServiceManifest(input);
    const service = {
      id: input.chainServiceId ? String(input.chainServiceId) : crypto.randomUUID(),
      chainServiceId: input.chainServiceId ?? null,
      publisherAddress: input.publisherAddress,
      name: input.name,
      endpointHash: input.endpointHash,
      pricePerUnitUsdc: input.pricePerUnitUsdc,
      manifest,
      active: true,
      featured: Boolean(input.featured),
      txHash: input.txHash ?? null,
      createdAt: new Date().toISOString(),
      archivedAt: null,
      archiveReason: null
    };

    const existingIndex = store.services.findIndex(
      (item) => item.id === service.id || (service.chainServiceId !== null && item.chainServiceId === service.chainServiceId)
    );
    if (existingIndex >= 0) store.services[existingIndex] = service;
    else store.services.push(service);
    pushNotification(store, {
      operatorAddress: service.publisherAddress,
      title: "API published",
      detail: `${service.name} · ${service.pricePerUnitUsdc} USDC per call`,
      kind: "system"
    });

    return service;
  });
}

export async function featureService(input: {serviceId: string; operatorAddress: string}) {
  return updateStore((store) => {
    const service = visibleServicesForStore(store.services).find((item) => item.id === input.serviceId || String(item.chainServiceId) === input.serviceId);
    if (!service) throw new Error("service not found");
    if (service.publisherAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) throw new Error("publisher wallet required");
    service.featured = true;
    return service;
  });
}

export async function platformPlans() {
  return PLATFORM_PLANS;
}

export async function subscribePlan(input: {operatorAddress: string; plan: string}) {
  const plan = requirePlatformPlan(input.plan);
  return updateStore((store) => {
    const subscription = {
      id: crypto.randomUUID(),
      operatorAddress: input.operatorAddress,
      plan: plan.id,
      planName: plan.name,
      amountUsdc: plan.amountUsdc,
      interval: plan.interval,
      status: "pending_payment" as const,
      txHash: null,
      chainId: null,
      activatedAt: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      createdAt: new Date().toISOString()
    };
    store.subscriptions.push(subscription);
    return subscription;
  });
}

export async function activatePlan(input: {operatorAddress: string; plan: string; txHash: string; chainId?: number | null}) {
  const plan = requirePlatformPlan(input.plan);
  return updateStore((store) => {
    if (store.subscriptions.some((subscription) => subscription.txHash?.toLowerCase() === input.txHash.toLowerCase())) {
      throw new Error("subscription payment transaction already recorded");
    }

    const now = new Date();
    const periodEnd = new Date(now);
    if (plan.interval === "month") periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    const subscription = {
      id: crypto.randomUUID(),
      operatorAddress: input.operatorAddress,
      plan: plan.id,
      planName: plan.name,
      amountUsdc: plan.amountUsdc,
      interval: plan.interval,
      status: "active" as const,
      txHash: input.txHash,
      chainId: input.chainId ?? null,
      activatedAt: now.toISOString(),
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: plan.interval === "month" ? periodEnd.toISOString() : null,
      createdAt: now.toISOString()
    };
    store.subscriptions.push(subscription);
    pushNotification(store, {
      operatorAddress: input.operatorAddress,
      title: "Plan activated",
      detail: `${plan.name} · ${plan.amountUsdc} USDC/${plan.interval === "month" ? "month" : "one-time"}`,
      kind: "system",
      txHash: input.txHash
    });
    return subscription;
  });
}

export async function activePlanFor(operatorAddress: string, planId: string) {
  const now = Date.now();
  const store = await readStore();
  return store.subscriptions
    .filter((subscription) => subscription.operatorAddress.toLowerCase() === operatorAddress.toLowerCase())
    .filter((subscription) => subscription.plan === planId && subscription.status === "active")
    .filter((subscription) => !subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > now)
    .sort((a, b) => Date.parse(b.activatedAt ?? b.createdAt) - Date.parse(a.activatedAt ?? a.createdAt))[0] ?? null;
}

export function requirePlatformPlan(planId: string) {
  const match = PLATFORM_PLANS.find((item) => item.id === planId);
  if (!match) throw new Error("plan not found");
  return match;
}

export async function executeMarketplaceService(input: {
  serviceId: string;
  payer: string;
  authorizationId?: string | null;
  args?: Record<string, unknown>;
}) {
  const service = await getService(input.serviceId);
  if (!service) throw new Error("service not found");
  if (!input.authorizationId) throw new Error("settled payment authorization is required before execution");
  await assertSettledAuthorization(input.authorizationId, service.id, input.payer);

  const args = input.args ?? {};
  const kind = service.manifest.kind;
  const execution = {
    serviceId: service.id,
    kind,
    input: args,
    result: await executeBuiltInService(kind, args)
  };
  const notification = await updateStore((store) => pushNotification(store, {
    operatorAddress: input.payer,
    title: "Agent action completed",
    detail: `${service.name} executed after verified x402 settlement`,
    kind: "agent",
    receiptId: input.authorizationId,
    actionHref: `/receipts/${encodeURIComponent(input.authorizationId ?? "")}`
  }));
  await dispatchNotification({notification, event: "agentActions", receiptId: input.authorizationId}).catch(() => undefined);
  return execution;
}

export async function executeBuiltInService(kind: ServiceManifest["kind"], args: Record<string, unknown>) {
  if (kind === "x_account_analyzer") {
    const handle = requiredString(args.handle ?? args.username, "handle");
    return analyzeXAccount(handle);
  }

  if (kind === "website_analyzer") {
    const url = requiredString(args.url, "url");
    return analyzeWebsite(url);
  }

  if (kind === "github_repo_analyzer") {
    const repo = requiredString(args.repo ?? args.url, "repo");
    return analyzeGitHubRepo(repo);
  }

  if (kind === "contract_safety_check") {
    return analyzeContractSafety(requiredString(args.contract ?? args.address, "contract"));
  }

  if (kind === "wallet_activity_summary") {
    return analyzeWalletActivity(requiredString(args.wallet ?? args.address, "wallet"));
  }

  if (kind === "landing_page_copy_reviewer") {
    return reviewLandingPageCopy(requiredString(args.url ?? args.copy, "url or copy"));
  }

  if (kind === "grant_application_reviewer") {
    return reviewGrantApplication(requiredString(args.application ?? args.summary, "application"));
  }

  if (kind === "meeting_brief") {
    return createMeetingBrief(requiredString(args.brief ?? args.goal ?? args.topic, "brief"));
  }

  if (kind === "arc_builder_research") {
    return researchArcBuilder(requiredString(args.target ?? args.project ?? args.builder, "target"));
  }

  if (kind === "domain_name_research") {
    return reviewDomainName(requiredString(args.domain ?? args.name, "domain"));
  }

  if (kind === "social_content_audit") {
    return auditSocialContent(requiredString(args.content ?? args.post, "content"));
  }

  if (kind === "stablecoin_route_report") {
    return analyzeStablecoinRoute(requiredString(args.route ?? args.flow, "route"));
  }

  if (kind === "policy_risk_review") {
    return reviewPolicyRisk(requiredString(args.policy ?? args.details, "policy"));
  }

  if (kind === "launch_readiness_check") {
    return reviewLaunchReadiness(requiredString(args.launch ?? args.plan, "launch"));
  }

  if (kind === "x402_integration_planner") {
    return planX402Integration(requiredString(args.api ?? args.endpoint, "api"));
  }

  return {
    summary: "Service executed",
    note: "Define a backend execution handler for this endpointHash to return structured output."
  };
}

export function buildServiceManifest(input: {
  name: string;
  endpointHash: string;
  manifestKind?: ServiceManifest["kind"];
  description?: string | null;
  webhookUrl?: string | null;
  platformFeeBps?: number | null;
}): ServiceManifest {
  const kind = input.manifestKind ?? inferServiceKind(input);
  const platformFeeBps = clampFeeBps(input.platformFeeBps ?? 200);
  const base = manifestTemplate(kind);
  return {
    ...base,
    description: input.description?.trim() || base.description,
    platformFeeBps,
    webhookUrl: input.webhookUrl?.trim() || null
  };
}

export function inferServiceKind(service: Pick<ServiceRecord, "name" | "endpointHash"> | {name: string; endpointHash: string}) {
  const marker = `${service?.name ?? ""} ${service?.endpointHash ?? ""}`.toLowerCase();
  if (marker.includes("x account") || marker.includes("x-account") || marker.includes("twitter")) return "x_account_analyzer";
  if (marker.includes("website") || marker.includes("url analyzer") || marker.includes("site analyzer")) return "website_analyzer";
  if (marker.includes("github") || marker.includes("repo analyzer") || marker.includes("repository")) return "github_repo_analyzer";
  if (marker.includes("contract safety") || marker.includes("contract audit") || marker.includes("contract check")) return "contract_safety_check";
  if (marker.includes("wallet activity") || marker.includes("wallet summary") || marker.includes("wallet risk")) return "wallet_activity_summary";
  if (marker.includes("landing page") || marker.includes("copy reviewer") || marker.includes("conversion copy")) return "landing_page_copy_reviewer";
  if (marker.includes("grant") || marker.includes("application reviewer")) return "grant_application_reviewer";
  if (marker.includes("meeting") || marker.includes("brief")) return "meeting_brief";
  if (marker.includes("arc builder") || marker.includes("builder research")) return "arc_builder_research";
  if (marker.includes("domain") || marker.includes("name research")) return "domain_name_research";
  if (marker.includes("social") || marker.includes("content audit")) return "social_content_audit";
  if (marker.includes("stablecoin route") || marker.includes("route report")) return "stablecoin_route_report";
  if (marker.includes("policy risk") || marker.includes("agent policy review")) return "policy_risk_review";
  if (marker.includes("launch readiness") || marker.includes("launch check")) return "launch_readiness_check";
  if (marker.includes("x402 integration") || marker.includes("integration planner")) return "x402_integration_planner";
  return "generic";
}

function manifestTemplate(kind: ServiceManifest["kind"]): ServiceManifest {
  if (kind === "website_analyzer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a website URL and returns page title, metadata, links, headings, and a short readable summary.",
      inputSchema: [{name: "url", label: "Website URL", type: "url", required: true, placeholder: "https://example.com"}],
      outputSchema: ["title", "description", "summary", "headings", "links", "wordCount"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "github_repo_analyzer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a public GitHub repository and returns activity, language, license, popularity, and README signal.",
      inputSchema: [{name: "repo", label: "GitHub repository", type: "text", required: true, placeholder: "owner/repo or GitHub URL"}],
      outputSchema: ["repo", "description", "stars", "forks", "openIssues", "license", "signal"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "x_account_analyzer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a public X account when API credits are available and returns metrics, account signal, and score.",
      inputSchema: [{name: "handle", label: "X account", type: "text", required: true, placeholder: "@username"}],
      outputSchema: ["account", "metrics", "score", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "contract_safety_check") {
    return {
      kind,
      version: "1.0.0",
      description: "Checks a contract address format, highlights review areas, and returns a human-readable safety checklist.",
      inputSchema: [{name: "contract", label: "Contract address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["contract", "riskLevel", "checks", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "wallet_activity_summary") {
    return {
      kind,
      version: "1.0.0",
      description: "Summarizes a wallet address, expected activity review steps, and risk notes for agent payments.",
      inputSchema: [{name: "wallet", label: "Wallet address", type: "text", required: true, placeholder: "0x..."}],
      outputSchema: ["wallet", "riskLevel", "summary", "recommendedPolicy"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "landing_page_copy_reviewer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews landing page copy or a URL and returns conversion, clarity, and CTA recommendations.",
      inputSchema: [{name: "url", label: "URL or page copy", type: "text", required: true, placeholder: "https://example.com or paste copy"}],
      outputSchema: ["score", "issues", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "grant_application_reviewer") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a grant application summary for infrastructure clarity, revenue proof, and ecosystem fit.",
      inputSchema: [{name: "application", label: "Application summary", type: "text", required: true, placeholder: "Paste your grant application summary"}],
      outputSchema: ["score", "strengths", "gaps", "recommendations"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "meeting_brief") {
    return {
      kind,
      version: "1.0.0",
      description: "Turns a meeting goal into a concise prep brief with agenda, context, questions, and follow-up actions.",
      inputSchema: [{name: "brief", label: "Meeting goal", type: "text", required: true, placeholder: "Discuss Arc x402 integration with a wallet team"}],
      outputSchema: ["summary", "agenda", "questions", "followUps"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "arc_builder_research") {
    return {
      kind,
      version: "1.0.0",
      description: "Researches an Arc builder, project, or integration idea and returns fit, proof points, and collaboration angles.",
      inputSchema: [{name: "target", label: "Builder or project", type: "text", required: true, placeholder: "Project name, URL, or wallet"}],
      outputSchema: ["summary", "arcFit", "questions", "integrationIdeas"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "domain_name_research") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a domain or product name for positioning, trust, and launch-readiness signals.",
      inputSchema: [{name: "domain", label: "Domain or name", type: "text", required: true, placeholder: "nexora.finance"}],
      outputSchema: ["domain", "score", "risks", "suggestions", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "social_content_audit") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews a post, thread draft, or announcement and returns clarity, audience fit, and CTA improvements.",
      inputSchema: [{name: "content", label: "Post or thread draft", type: "text", required: true, placeholder: "Paste post copy or announcement"}],
      outputSchema: ["score", "issues", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "stablecoin_route_report") {
    return {
      kind,
      version: "1.0.0",
      description: "Summarizes a stablecoin route, swap, bridge, or Save/Earn flow for cost, risk, and integration readiness.",
      inputSchema: [{name: "route", label: "Route or flow", type: "text", required: true, placeholder: "USDC on Arc to EURC using Synthra"}],
      outputSchema: ["route", "riskLevel", "checks", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "policy_risk_review") {
    return {
      kind,
      version: "1.0.0",
      description: "Reviews agent policy settings and returns risk notes, suggested caps, and approval recommendations.",
      inputSchema: [{name: "policy", label: "Policy details", type: "text", required: true, placeholder: "Daily 100 USDC, tx cap 20, allow x402 ledger"}],
      outputSchema: ["riskLevel", "checks", "recommendedPolicy", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "launch_readiness_check") {
    return {
      kind,
      version: "1.0.0",
      description: "Checks a product launch plan for docs, demo, contracts, receipts, security notes, and community-readiness.",
      inputSchema: [{name: "launch", label: "Launch plan", type: "text", required: true, placeholder: "Paste launch plan, website, or demo checklist"}],
      outputSchema: ["score", "strengths", "gaps", "recommendations", "summary"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  if (kind === "x402_integration_planner") {
    return {
      kind,
      version: "1.0.0",
      description: "Creates a practical x402 integration checklist for a paid API, including requirements, SDK wiring, and settlement flow.",
      inputSchema: [{name: "api", label: "API description", type: "text", required: true, placeholder: "Paid repo analyzer endpoint in Next.js"}],
      outputSchema: ["summary", "steps", "requirements", "securityNotes"],
      revenueMode: "per_execution",
      platformFeeBps: 200
    };
  }
  return {
    kind,
    version: "1.0.0",
    description: "Hosted x402 API service. Add a backend executor or webhook to return structured results.",
    inputSchema: [],
    outputSchema: ["summary", "note"],
    revenueMode: "per_execution",
    platformFeeBps: 200
  };
}

function analyzeContractSafety(contract: string) {
  const valid = /^0x[a-fA-F0-9]{40}$/.test(contract);
  return {
    status: valid ? "ok" : "warning",
    contract,
    riskLevel: valid ? "medium" : "high",
    checks: [
      valid ? "Address format is valid." : "Address format is invalid or incomplete.",
      "Verify source code and proxy implementation before allowlisting.",
      "Check ownership, upgrade roles, pausing permissions, and token approvals.",
      "Start with low transaction caps until the contract has live usage history."
    ],
    summary: valid
      ? "The address format is valid. Nexora recommends source verification and role review before adding it to an agent policy."
      : "The input does not look like a valid EVM contract address. Do not allowlist until corrected."
  };
}

function analyzeWalletActivity(wallet: string) {
  const valid = /^0x[a-fA-F0-9]{40}$/.test(wallet);
  return {
    status: valid ? "ok" : "warning",
    wallet,
    riskLevel: valid ? "medium" : "high",
    summary: valid
      ? "Wallet format is valid. Use this as a starting point for recipient policy review and combine it with explorer history before high-value transfers."
      : "Wallet format is invalid or incomplete.",
    recommendedPolicy: {
      transactionCapUsdc: valid ? 25 : 0,
      dailyLimitUsdc: valid ? 100 : 0,
      recipientAllowlist: valid ? [wallet] : []
    }
  };
}

function reviewLandingPageCopy(input: string) {
  const isUrl = /^https?:\/\//i.test(input) || /^[\w.-]+\.[a-z]{2,}/i.test(input);
  return {
    status: "ok",
    target: input,
    score: isUrl ? 78 : 72,
    issues: [
      "Make the primary user action visible in the first viewport.",
      "State the problem solved before listing infrastructure components.",
      "Move proof points near pricing or transaction actions."
    ],
    recommendations: [
      "Use one concrete CTA for the next step.",
      "Show a live receipt, policy, or fee proof as product evidence.",
      "Trim broad claims and anchor the copy around a specific workflow."
    ],
    summary: "The page can convert better by making the value proposition, proof, and next action easier to scan."
  };
}

function reviewGrantApplication(application: string) {
  const lengthScore = Math.min(30, Math.floor(application.length / 80));
  const infraScore = /policy|x402|escrow|wallet|usdc|settlement|treasury/i.test(application) ? 35 : 15;
  const revenueScore = /revenue|fee|treasury|marketplace|earn/i.test(application) ? 25 : 10;
  const score = Math.min(100, lengthScore + infraScore + revenueScore);
  return {
    status: "ok",
    score,
    strengths: [
      "Clearer if it ties agent wallets, on-chain policy, x402 payments, and treasury fees into one system.",
      "Strong when it includes live contract addresses and transaction receipts."
    ],
    gaps: [
      "Add exact user workflows instead of only protocol descriptions.",
      "Show how the project creates recurring ecosystem usage and revenue."
    ],
    recommendations: [
      "Include a short architecture diagram or flow.",
      "Add metrics: published APIs, payments settled, fees routed, and chains deployed.",
      "Explain why Arc-native USDC settlement improves the agent commerce workflow."
    ],
    summary: `Grant readiness score: ${score}/100. Improve by adding proof, revenue routing, and ecosystem-specific traction.`
  };
}

function createMeetingBrief(brief: string) {
  return {
    status: "ok",
    summary: `Brief prepared for: ${clip(brief, 120)}.`,
    agenda: [
      "Clarify the exact integration or business outcome.",
      "Review current payment, wallet, or API flow.",
      "Agree on the smallest test transaction or demo path.",
      "Define follow-up owner, timeline, and success metric."
    ],
    questions: [
      "Which wallet or backend owns the payment authorization?",
      "What USDC amount should the first test use?",
      "Which contract, endpoint, or SDK path should be integrated first?",
      "What proof should be shared after the meeting?"
    ],
    followUps: [
      "Send a short technical summary with links.",
      "Share one receipt or transaction hash when available.",
      "Create a narrow integration checklist before the next call."
    ]
  };
}

function researchArcBuilder(target: string) {
  const hasUrl = /^https?:\/\//i.test(target);
  return {
    status: "ok",
    target,
    arcFit: /payment|usdc|agent|x402|defi|vault|swap|escrow/i.test(target) ? "high" : "medium",
    summary: hasUrl
      ? "Review the project website, docs, and transaction proof before outreach. Prioritize a concrete Arc-native USDC workflow."
      : "Use this as a starting point for builder research. Look for live product proof, Arc-specific value, and a narrow integration ask.",
    questions: [
      "What Arc-specific user flow can both teams demo quickly?",
      "Does the project need payments, escrow, agent policies, Save/Earn, or x402 monetization?",
      "Which testnet contract or API endpoint is ready for integration?"
    ],
    integrationIdeas: [
      "x402-paid endpoint protected by Nexora middleware.",
      "Policy-controlled agent wallet for recurring API usage.",
      "Public receipt link for each successful paid action.",
      "Escrow workflow for service delivery or contributor tasks."
    ]
  };
}

function reviewDomainName(domain: string) {
  const normalized = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  const score = Math.max(45, Math.min(92, 70 + (normalized.includes(".") ? 8 : -5) + (normalized.length <= 18 ? 8 : -6) + (/finance|pay|agent|api|arc|vault/.test(normalized) ? 6 : 0)));
  return {
    status: "ok",
    domain: normalized,
    score,
    risks: [
      normalized.length > 22 ? "Long names are harder to remember and type." : "Name length is acceptable.",
      normalized.includes("-") ? "Hyphens can reduce trust for finance products." : "No obvious hyphen trust issue.",
      "Check trademark conflicts before using the name publicly."
    ],
    suggestions: [
      "Keep the first landing-page headline literal and product-specific.",
      "Reserve matching social handles before public launch.",
      "Use clear security and testnet disclaimers for finance flows."
    ],
    summary: `Name readiness score: ${score}/100. The domain is usable if trust, handle availability, and brand clarity check out.`
  };
}

function auditSocialContent(content: string) {
  const score = Math.min(92, Math.max(40, 55 + (content.length > 180 ? 10 : 0) + (/built|demo|live|sdk|arc|usdc/i.test(content) ? 15 : 0) + (/\?/.test(content) ? 5 : 0)));
  return {
    status: "ok",
    score,
    issues: [
      content.length > 1200 ? "The post may be too long for users to finish." : "Length is reasonable.",
      /soon|revolutionary|game.?changer/i.test(content) ? "Replace hype terms with proof or a concrete workflow." : "Tone is mostly practical.",
      /https?:\/\//i.test(content) ? "Link is present. Make sure it points to a working product or docs page." : "Add one clear link if the post is a launch announcement."
    ],
    recommendations: [
      "Lead with what users can do today.",
      "Mention the exact chain, asset, or SDK only where it helps action.",
      "End with one specific question to drive replies."
    ],
    summary: `Content audit score: ${score}/100. Improve by adding proof, a tighter CTA, and concrete product flow.`
  };
}

function analyzeStablecoinRoute(route: string) {
  return {
    status: "ok",
    route,
    riskLevel: /mainnet|large|production/i.test(route) ? "medium" : "low",
    checks: [
      "Confirm token decimals before quoting or approving.",
      "Use a fresh quote immediately before transaction submission.",
      "Set slippage bounds and display the minimum output.",
      "For Arc, remember native gas is USDC but ERC-20 USDC still uses 6 decimals.",
      "For Save/Earn, disclose strategy source, fee, and withdrawal assumptions."
    ],
    recommendations: [
      "Start with a small test amount.",
      "Show route provider, expected output, fee, and transaction receipt.",
      "Keep fallback routes visible if a pool has no live quote."
    ],
    summary: "The route can be tested safely if quote freshness, decimals, slippage, and receipt proof are handled in the UI."
  };
}

function reviewPolicyRisk(policy: string) {
  const daily = numericHint(policy, /daily[^0-9]*(\d+(\.\d+)?)/i);
  const txCap = numericHint(policy, /(tx|transaction)[^0-9]*(\d+(\.\d+)?)/i);
  const riskLevel = daily > 500 || txCap > 100 || /no allow|empty allow|any contract/i.test(policy) ? "high" : daily > 100 || txCap > 25 ? "medium" : "low";
  return {
    status: "ok",
    riskLevel,
    checks: [
      daily > 0 ? `Daily limit detected: ${daily} USDC.` : "No clear daily limit detected.",
      txCap > 0 ? `Transaction cap detected: ${txCap} USDC.` : "No clear transaction cap detected.",
      /allow/i.test(policy) ? "Allowlist language detected." : "No allowlist language detected.",
      /cooldown|expiry|expire|weekly|monthly/i.test(policy) ? "Advanced V2 control language detected." : "Consider adding cooldown, expiry, weekly, or monthly controls."
    ],
    recommendedPolicy: {
      dailyLimitUsdc: daily > 0 ? Math.min(daily, 100) : 50,
      transactionCapUsdc: txCap > 0 ? Math.min(txCap, 25) : 10,
      requireOnchainPolicy: true
    },
    summary: `Policy risk is ${riskLevel}. Keep early agent wallets conservative until the service has a clean payment history.`
  };
}

function reviewLaunchReadiness(launch: string) {
  const score = Math.min(100, 35 + (/docs|readme/i.test(launch) ? 12 : 0) + (/demo|video/i.test(launch) ? 12 : 0) + (/contract|address|tx|receipt/i.test(launch) ? 15 : 0) + (/security|audit|risk/i.test(launch) ? 10 : 0) + (/revenue|fee|analytics/i.test(launch) ? 8 : 0));
  return {
    status: "ok",
    score,
    strengths: [
      /demo|video/i.test(launch) ? "Demo proof is included." : "Add a short demo video.",
      /contract|address|tx|receipt/i.test(launch) ? "On-chain proof is referenced." : "Add contract addresses or receipt links.",
      /docs|readme/i.test(launch) ? "Documentation is referenced." : "Add docs or README links."
    ],
    gaps: [
      /security|audit|risk/i.test(launch) ? "Security notes are present." : "Add security status and known limitations.",
      /revenue|fee|analytics/i.test(launch) ? "Revenue/analytics proof is present." : "Add how the product earns or measures usage."
    ],
    recommendations: [
      "Keep the launch post focused on what users can do today.",
      "Include one quickstart path and one transaction or receipt proof.",
      "List testnet limitations clearly."
    ],
    summary: `Launch readiness score: ${score}/100. Ship when demo, docs, proof, security notes, and feedback questions are all clear.`
  };
}

function planX402Integration(api: string) {
  return {
    status: "ok",
    summary: `Integration plan prepared for: ${clip(api, 120)}.`,
    steps: [
      "Install @nexorafi/x402 in the API project.",
      "Wrap the paid route with Nexora x402 middleware or the Next.js helper.",
      "Set payTo, asset, network, price, resource, and facilitator URL.",
      "Return structured JSON only after verify and settlement succeed.",
      "Log the receipt id or transaction hash for support."
    ],
    requirements: [
      "Publisher wallet address.",
      "Arc USDC asset address.",
      "Backend URL for the Nexora facilitator.",
      "Input schema and expected output shape.",
      "A small test amount for first settlement."
    ],
    securityNotes: [
      "Do not expose private keys in frontend code.",
      "Reject replayed nonces and stale authorization windows.",
      "Set conservative pricing and rate limits while testing."
    ]
  };
}

async function assertSettledAuthorization(authorizationId: string, serviceId: string, payer: string) {
  const store = await readStore();
  const payment = store.payments.find((item) => item.authorizationId === authorizationId || item.id === authorizationId);
  if (!payment) throw new Error("payment authorization not found");
  if (payment.serviceId !== serviceId) throw new Error("payment authorization does not match service");
  if (payment.payer.toLowerCase() !== payer.toLowerCase()) throw new Error("payment authorization does not match payer");
  if (payment.status !== "settled") throw new Error("payment must be settled before execution");
}

function clampFeeBps(value: number) {
  if (!Number.isFinite(value)) return 200;
  return Math.max(0, Math.min(1000, Math.round(value)));
}

async function analyzeWebsite(inputUrl: string) {
  const url = safeHttpUrl(inputUrl, "url");
  const response = await fetch(url, {
    headers: {
      "user-agent": "NexoraWebsiteAnalyzer/1.0"
    },
    signal: AbortSignal.timeout(12_000)
  });

  if (!response.ok) {
    return {
      status: "error",
      message: `Website returned ${response.status}`,
      url
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) {
    throw new Error("website response is too large");
  }
  const html = await response.text();
  if (html.length > 1_000_000) throw new Error("website response is too large");
  const title = extractTagContent(html, "title");
  const description = extractMeta(html, "description") ?? extractMeta(html, "og:description");
  const ogTitle = extractMeta(html, "og:title");
  const canonical = extractCanonical(html);
  const headings = extractHeadings(html).slice(0, 8);
  const links = extractLinks(html, url).slice(0, 12);
  const text = stripHtml(html).replace(/\s+/g, " ").trim();

  return {
    status: "ok",
    url,
    contentType,
    title: ogTitle ?? title ?? "Untitled",
    description: description ?? "",
    canonical,
    headings,
    links,
    wordCount: text ? text.split(/\s+/).length : 0,
    summary: summarizeText(text)
  };
}

async function analyzeGitHubRepo(input: string) {
  const repo = parseGitHubRepo(input);
  const headers = {
    "accept": "application/vnd.github+json",
    "user-agent": "NexoraGitHubRepoAnalyzer/1.0"
  };
  const repoResponse = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}`, {
    headers,
    signal: AbortSignal.timeout(12_000)
  });

  if (!repoResponse.ok) {
    return {
      status: "error",
      message: `GitHub returned ${repoResponse.status}`,
      repo
    };
  }

  const data = await repoResponse.json() as {
    full_name?: string;
    description?: string | null;
    html_url?: string;
    stargazers_count?: number;
    forks_count?: number;
    open_issues_count?: number;
    language?: string | null;
    default_branch?: string;
    pushed_at?: string;
    updated_at?: string;
    license?: {spdx_id?: string} | null;
  };
  const readme = await fetchGitHubReadme(repo.owner, repo.name, headers);

  return {
    status: "ok",
    repo: data.full_name ?? `${repo.owner}/${repo.name}`,
    url: data.html_url,
    description: data.description ?? "",
    language: data.language ?? "Unknown",
    stars: data.stargazers_count ?? 0,
    forks: data.forks_count ?? 0,
    openIssues: data.open_issues_count ?? 0,
    defaultBranch: data.default_branch,
    pushedAt: data.pushed_at,
    updatedAt: data.updated_at,
    license: data.license?.spdx_id ?? "Unspecified",
    readmeSummary: readme ? summarizeText(readme) : "No README found.",
    signal: repoSignal(data.stargazers_count ?? 0, data.forks_count ?? 0, data.pushed_at)
  };
}

async function fetchGitHubReadme(owner: string, repo: string, headers: Record<string, string>) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
    headers,
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) return "";

  const data = await response.json() as {content?: string; encoding?: string};
  if (!data.content || data.encoding !== "base64") return "";
  return Buffer.from(data.content, "base64").toString("utf8").replace(/[#*_`>\[\]()]/g, " ");
}

async function analyzeXAccount(handle: string) {
  if (!config.integrations.xBearerToken) {
    return {
      status: "not_configured",
      message: "Live X account analysis is not available yet. Try another service or check back later."
    };
  }

  const username = handle.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) throw new Error("handle is invalid");
  const response = await fetch(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,verified,created_at,description`,
    {
      headers: {
        authorization: `Bearer ${config.integrations.xBearerToken}`
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return {
      status: "error",
      message: `X API returned ${response.status}`,
      detail: body.slice(0, 240)
    };
  }

  const data = await response.json() as {
    data?: {
      id?: string;
      name?: string;
      username?: string;
      created_at?: string;
      verified?: boolean;
      description?: string;
      public_metrics?: {
        followers_count?: number;
        following_count?: number;
        tweet_count?: number;
        listed_count?: number;
      };
    };
  };

  const user = data.data;
  if (!user) {
    return {status: "empty", message: "No X account data returned."};
  }

  const followers = user.public_metrics?.followers_count ?? 0;
  const following = user.public_metrics?.following_count ?? 0;
  const tweets = user.public_metrics?.tweet_count ?? 0;
  const listed = user.public_metrics?.listed_count ?? 0;
  const score = Math.min(100, Math.round(followers / 1000 + tweets / 100 + listed * 2 + (user.verified ? 15 : 0) - following / 1000));

  return {
    status: "ok",
    account: {
      id: user.id,
      name: user.name,
      username: user.username,
      verified: Boolean(user.verified),
      createdAt: user.created_at
    },
    metrics: {
      followers,
      following,
      tweets,
      listed
    },
    score,
    summary: score >= 70 ? "Strong account signal" : score >= 40 ? "Moderate account signal" : "Low account signal"
  };
}

function requiredString(value: unknown, label: string, max = 4_000) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} is too long`);
  return trimmed;
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function numericHint(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  const numeric = Number(match?.[1] ?? match?.[2] ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function extractTagContent(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? decodeHtml(match[1].trim()) : null;
}

function extractMeta(html: string, name: string) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapeRegExp(name)}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].trim());
  }
  return null;
}

function extractCanonical(html: string) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ? decodeHtml(match[1].trim()) : null;
}

function extractHeadings(html: string) {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  return matches.map((match) => stripHtml(match[1] ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function extractLinks(html: string, baseUrl: string) {
  const matches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return matches.map((match) => {
    const href = resolveUrl(match[1] ?? "", baseUrl);
    const label = stripHtml(match[2] ?? "").replace(/\s+/g, " ").trim();
    return {label: label.slice(0, 80), href};
  }).filter((link) => link.href && link.label);
}

function resolveUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function stripHtml(html: string) {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function summarizeText(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "No readable text found.";
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 40);
  return (sentences.slice(0, 3).join(" ") || cleaned.slice(0, 360)).slice(0, 700);
}

function parseGitHubRepo(input: string) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  const owner = urlMatch?.[1] ?? slashMatch?.[1];
  const name = (urlMatch?.[2] ?? slashMatch?.[2])?.replace(/\.git$/, "");
  if (!owner || !name) throw new Error("repo must be a GitHub URL or owner/repo");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) {
    throw new Error("repo contains invalid characters");
  }
  return {owner, name};
}

function repoSignal(stars: number, forks: number, pushedAt?: string) {
  const daysSincePush = pushedAt ? Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86_400_000) : null;
  if (daysSincePush !== null && daysSincePush <= 30 && stars >= 100) return "Active and established";
  if (daysSincePush !== null && daysSincePush <= 90) return "Recently active";
  if (stars >= 1000 || forks >= 200) return "Established but activity should be reviewed";
  return "Early or low-signal repository";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
