import {createWebhookExecutor, withNexoraX402} from "../../src/index.js";

const paidExecution = createWebhookExecutor(async ({args}) => {
  return {
    status: "ok",
    summary: "Webhook-backed service executed after settlement.",
    args
  };
});

export const POST = withNexoraX402(
  {
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL ?? "http://localhost:4000",
    payTo: process.env.PUBLISHER_WALLET ?? "0x0000000000000000000000000000000000000000",
    asset: process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    description: "Webhook-backed Nexora service",
    onReceipt: async ({settlement}) => {
      console.log("settled", settlement?.transaction);
    }
  },
  (request, context) => paidExecution(request, context)
);
