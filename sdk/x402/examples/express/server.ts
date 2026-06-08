import express from "express";
import {nexoraX402} from "../../src/index.js";

const app = express();

app.get(
  "/paid-report",
  nexoraX402({
    facilitatorUrl: process.env.NEXORA_FACILITATOR_URL ?? "http://localhost:4000",
    payTo: process.env.PUBLISHER_WALLET ?? "0x0000000000000000000000000000000000000000",
    asset: process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
    price: "0.05",
    network: "arc-testnet",
    description: "Example paid report"
  }),
  (req, res) => {
    res.json({
      report: "This response was unlocked by an x402 payment.",
      payer: req.x402?.verification.payer,
      tx: req.x402?.settlement?.transaction
    });
  }
);

app.listen(3000, () => {
  console.log("Example paid API listening on http://localhost:3000");
});
