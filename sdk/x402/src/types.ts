export type X402Network = "arc-testnet" | "arc";
export type X402Scheme = "exact";

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
};

export type X402Context = {
  payment: X402PaymentPayload;
  paymentRequirements: PaymentRequirements;
  verification: VerifyResponse;
  settlement?: SettleResponse;
};
