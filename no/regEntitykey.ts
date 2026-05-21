import "dotenv/config";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

async function main() {
  const response = await registerEntitySecretCiphertext({
    apiKey: process.env.CIRCLE_API_KEY ?? "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET ?? "",
    recoveryFileDownloadPath: "./recoveryn",
  });

  console.log(response.data?.recoveryFile);
}

main().catch(console.error);