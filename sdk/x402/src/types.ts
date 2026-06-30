export type X402Network = "arc-testnet" | "arc";
export type X402Scheme = "exact";
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
    serviceId?: string;
  };
};

export type X402PaymentPayload = {
  x402Version: number;
  scheme: X402Scheme;
  network: X402Network;
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
};

export type SupportedResponse = {
  x402Version: number;
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
