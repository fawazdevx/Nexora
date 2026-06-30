import {createNexoraServiceManifest} from "../src/index.js";

const manifest = createNexoraServiceManifest({
  name: "Wallet Risk + Approval Scan",
  endpointHash: "wallet-risk-approval-scan-v1",
  kind: "wallet_risk_approval_scan",
  price: "0.05",
  outputSchema: ["wallet", "riskLevel", "checks", "recommendedPolicy"]
});

console.log(JSON.stringify(manifest, null, 2));
