export type X402Version = 1 | 2;
export type X402Network =
  | "arc-testnet"
  | "arc"
  | "base-sepolia"
  | "base"
  | "arbitrum-sepolia"
  | "arbitrum"
  | "eip155:5042002"
  | "eip155:84532"
  | "eip155:8453"
  | "eip155:421614"
  | "eip155:42161"
  | "eip155:968"
  | "eip155:677"
  | "bot-chain-testnet"
  | "bot-chain";
export type X402Scheme = "exact";

// Networks whose payment token has no EIP-3009, so x402 settles via Permit2
// through Meridian's facilitator (BotChain). Distinguished from the Arc path,
// which uses EIP-3009 transferWithAuthorization.
export type MeridianPermit2Network = "bot-chain-testnet" | "bot-chain";

// Canonical Permit2 contracts (same address on every supported EVM chain).
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";
export const BOTCHAIN_TESTNET_USDT = "0x75edC9335175Fc0552D51D48439F229c10420fe3";
export const MERIDIAN_BOTCHAIN_TESTNET_FACILITATOR = "0x8e633dBf31adCc7D41BE3e95B7c8DD3526B5235A";
export const BOTCHAIN_MAINNET_USDT = "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C";
export const MERIDIAN_BOTCHAIN_MAINNET_FACILITATOR = "0x8E7769D440b3460b92159Dd9C6D17302b036e2d6";
export type NexoraServiceKind =
  | "website_analyzer"
  | "github_repo_analyzer"
  | "x_account_analyzer"
  | "contract_safety_check"
  | "wallet_activity_summary"
  | "landing_page_copy_reviewer"
  | "grant_application_reviewer"
  | "meeting_brief"
  | "arc_builder_research"
  | "domain_name_research"
  | "social_content_audit"
  | "stablecoin_route_report"
  | "policy_risk_review"
  | "launch_readiness_check"
  | "x402_integration_planner"
  | "wallet_risk_approval_scan"
  | "agent_transaction_preflight"
  | "contract_interaction_risk_scan"
  | "invoice_collection_agent"
  | "escrow_milestone_monitor"
  | "counterparty_compliance_screen"
  | "liquidation_risk_monitor"
  | "vault_apy_monitor"
  | "subscription_payment_agent"
  | "publisher_revenue_intelligence"
  | "dao_grant_payout_agent"
  | "swap_route_quote_agent"
  | "generic";

export type NexoraServiceManifestInput = {
  name: string;
  endpointHash: string;
  kind?: NexoraServiceKind;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  price?: string;
  category?: string;
  version?: string;
};

export type NexoraServiceManifest = {
  protocol: "nexora.service";
  version: string;
  name: string;
  endpointHash: string;
  kind: NexoraServiceKind;
  category: string;
  description: string;
  price?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  policyHints: NexoraPolicyHints;
};

export type NexoraPolicyHints = {
  suggestedTransactionCapUsdc: string;
  suggestedDailyLimitUsdc: string;
  requireOnchainPolicy: boolean;
  requiresHumanApproval: boolean;
  riskLevel: "low" | "medium" | "high";
  notes: string[];
};

export type PaymentRequirements = {
  scheme: X402Scheme;
  network: X402Network;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: {
    name?: string;
    version?: string;
    creditedRecipient?: string;
    serviceId?: string;
    x402Version?: X402Version;
  };
};

export type Eip3009PaymentPayload = {
  x402Version: X402Version;
  scheme?: X402Scheme;
  network?: X402Network;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepted?: Omit<PaymentRequirements, "maxAmountRequired" | "resource" | "description" | "mimeType"> & {
    amount: string;
  };
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
};

// The Permit2 payment payload a buyer produces on a non-EIP-3009 network
// (BotChain). Unlike X402PaymentPayload's EIP-3009 authorization, this carries a
// signed Permit2 witness transfer. Relayed to Meridian's settle API by Nexora.
export type MeridianPermit2Payload = {
  x402Version: 1;
  scheme: X402Scheme;
  network: MeridianPermit2Network;
  payload: {
    signature: string;
    owner: string;
    permit: {
      permitted: {token: string; amount: string};
      nonce: string;
      deadline: string;
    };
    witness: {
      to: string;
      validAfter: string;
    };
  };
};

export type X402PaymentPayload = Eip3009PaymentPayload | MeridianPermit2Payload;

export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  amount?: string;
  payTo?: string;
  network?: string;
  asset?: string;
};

export type SettleResponse = {
  success: boolean;
  transaction?: string;
  errorReason?: string;
  network?: string;
  payer?: string;
  payerAddress?: string;
  amount?: string;
  asset?: string;
  receiptId?: string;
  replay?: boolean;
  warning?: string | null;
  policy?: {
    checked: boolean;
    accountingStatus: "recorded" | "pending";
    accountingTxHashes: string[];
  };
};

export type MeridianPaymentRequirementsConfig = {
  facilitatorUrl: string;
  facilitator?: string;
  asset?: string;
  creditedRecipient?: string;
  price?: string;
  amountAtomic?: string;
  network?: MeridianPermit2Network;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  outputSchema?: unknown;
  extra?: PaymentRequirements["extra"];
};

export type CirclePaymentIntentRequest = {
  operatorAddress: string;
  agentId?: string | null;
  walletAddress: string;
  serviceUrl: string;
  chain?: string | null;
  data?: Record<string, unknown>;
};

export type CirclePaymentIntent = {
  id: string;
  status: "pending_approval" | "approved" | "rejected" | "executing" | "settled" | "failed" | "policy_blocked" | "expired";
  receiptId?: string | null;
  [key: string]: unknown;
};

export type CirclePaymentIntentAuthorization = {
  intentId: string;
  approved: boolean;
  status: CirclePaymentIntent["status"];
  expiresAt: string | null;
  payment: {
    serviceUrl: string;
    walletAddress: string | null;
    chain: string;
    amountUsdc: number;
    payTo: string;
    assetAddress?: string | null;
    data: Record<string, unknown>;
  };
};

export type CircleExternalReceiptInput = {
  operatorAddress: string;
  paymentResponse: unknown;
  result?: unknown;
};

export type NexoraX402ClientOptions = {
  authorizationToken?: string;
  fetch?: typeof globalThis.fetch;
};

export type PolicyRemediationCode =
  | "no_agent"
  | "policy_inactive"
  | "invalid_amount"
  | "transaction_cap_exceeded"
  | "onchain_policy_required"
  | "policy_expired"
  | "max_units_exceeded"
  | "service_not_allowlisted"
  | "recipient_not_allowlisted"
  | "contract_not_allowlisted"
  | "daily_limit_exceeded"
  | "weekly_limit_exceeded"
  | "monthly_limit_exceeded"
  | "cooldown_active";

// Machine-readable guidance returned when the Nexora agent policy blocks a
// purchase. Lets an agent resize or reschedule and retry without a human.
export type PolicyRemediation = {
  code: PolicyRemediationCode;
  limitingFactor: string;
  retryable: boolean;
  suggestedMaxAmountUsdc: number | null;
  suggestedMaxUnits: number | null;
  retryAfter: string | null;
};

// Body of a 402 response from POST /api/x402/authorize when policy blocks it.
export type PolicyBlockedResponse = {
  error: string;
  code: "policy_blocked";
  paymentId: string;
  remediation: PolicyRemediation | null;
};

export type SupportedResponse = {
  x402Version: number;
  supportedVersions?: X402Version[];
  kinds: Array<{
    scheme: X402Scheme;
    network: X402Network;
    asset: string;
    assetSymbol: string;
    settlement: string;
    facilitator: string;
  }>;
};

export type NexoraX402Config = {
  facilitatorUrl: string;
  payTo: string;
  asset: string;
  price?: string;
  amountAtomic?: string;
  network?: X402Network;
  x402Version?: X402Version;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  settle?: boolean;
  outputSchema?: unknown;
  extra?: PaymentRequirements["extra"];
  onReceipt?: NexoraReceiptCallback;
};

export type X402Context = {
  payment: X402PaymentPayload;
  paymentRequirements: PaymentRequirements;
  verification: VerifyResponse;
  settlement?: SettleResponse;
};

export type NexoraReceiptEvent = {
  paymentRequirements: PaymentRequirements;
  verification: VerifyResponse;
  settlement?: SettleResponse;
};

export type NexoraReceiptCallback = (event: NexoraReceiptEvent) => void | Promise<void>;
