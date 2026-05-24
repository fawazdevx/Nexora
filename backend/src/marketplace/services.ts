import {readStore, updateStore, type ServiceManifest, type ServiceRecord} from "../store.js";
import {config} from "../config.js";

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
  return store.services;
}

export async function getService(serviceId: string) {
  const store = await readStore();
  return store.services.find((service) => service.id === serviceId || String(service.chainServiceId) === serviceId);
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
      createdAt: new Date().toISOString()
    };

    const existingIndex = store.services.findIndex(
      (item) => item.id === service.id || (service.chainServiceId !== null && item.chainServiceId === service.chainServiceId)
    );
    if (existingIndex >= 0) store.services[existingIndex] = service;
    else store.services.push(service);

    return service;
  });
}

export async function featureService(input: {serviceId: string; operatorAddress: string}) {
  return updateStore((store) => {
    const service = store.services.find((item) => item.id === input.serviceId || String(item.chainServiceId) === input.serviceId);
    if (!service) throw new Error("service not found");
    if (service.publisherAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) throw new Error("publisher wallet required");
    service.featured = true;
    return service;
  });
}

export async function platformPlans() {
  return [
    {
      id: "developer_analytics",
      name: "Developer analytics",
      amountUsdc: 29,
      interval: "month",
      benefit: "API usage analytics and hosted service manifests"
    },
    {
      id: "premium_agent_automation",
      name: "Premium agent automation",
      amountUsdc: 49,
      interval: "month",
      benefit: "Higher automation limits and yield route monitoring"
    },
    {
      id: "enterprise_policy",
      name: "Enterprise wallet policy",
      amountUsdc: 299,
      interval: "month",
      benefit: "Multi-agent policy management and compliance export"
    },
    {
      id: "verified_builder",
      name: "Verified builder badge",
      amountUsdc: 15,
      interval: "one_time",
      benefit: "Reputation badge review and marketplace trust signal"
    }
  ];
}

export async function subscribePlan(input: {operatorAddress: string; plan: string; amountUsdc: number}) {
  return updateStore((store) => {
    const subscription = {
      id: crypto.randomUUID(),
      ...input,
      status: "pending_payment" as const,
      createdAt: new Date().toISOString()
    };
    store.subscriptions.push(subscription);
    return subscription;
  });
}

export async function executeMarketplaceService(input: {
  serviceId: string;
  payer: string;
  authorizationId?: string | null;
  args?: Record<string, unknown>;
}) {
  const service = await getService(input.serviceId);
  if (!service) throw new Error("service not found");
  if (input.authorizationId) await assertSettledAuthorization(input.authorizationId, service.id, input.payer);

  const args = input.args ?? {};
  const kind = service.manifest.kind;

  if (kind === "x_account_analyzer") {
    const handle = requiredString(args.handle ?? args.username, "handle");
    return {
      serviceId: service.id,
      kind,
      input: {handle},
      result: await analyzeXAccount(handle)
    };
  }

  if (kind === "website_analyzer") {
    const url = requiredString(args.url, "url");
    return {
      serviceId: service.id,
      kind,
      input: {url},
      result: await analyzeWebsite(url)
    };
  }

  if (kind === "github_repo_analyzer") {
    const repo = requiredString(args.repo ?? args.url, "repo");
    return {
      serviceId: service.id,
      kind,
      input: {repo},
      result: await analyzeGitHubRepo(repo)
    };
  }

  return {
    serviceId: service.id,
    kind,
    input: args,
    result: {
      summary: "Service executed",
      note: "Define a backend execution handler for this endpointHash to return structured output."
    }
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
  const url = normalizeHttpUrl(inputUrl);
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
  const html = await response.text();
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
      message: "Set X_BEARER_TOKEN in the backend environment to fetch real X account data."
    };
  }

  const username = handle.replace(/^@/, "");
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

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

function normalizeHttpUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("url must use http or https");
  return parsed.toString();
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
