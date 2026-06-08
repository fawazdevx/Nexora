import {withNexoraX402} from "../../src/index.js";

export const GET = withNexoraX402(
  {
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL ?? "http://localhost:4000",
    payTo: process.env.PUBLISHER_WALLET ?? "0x0000000000000000000000000000000000000000",
    asset: process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    description: "Example Next.js paid route"
  },
  async (_request, context) => {
    return Response.json({
      message: "This route was unlocked by an x402 payment.",
      payer: context.verification.payer,
      tx: context.settlement?.transaction
    });
  }
);
