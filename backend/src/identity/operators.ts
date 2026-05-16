import {appSnapshot} from "../store.js";

export async function operatorProfile(address: string) {
  const snapshot = await appSnapshot(address);

  return {
    address,
    arcName: null,
    verifiedBuilder: snapshot.reputation.verifiedBuilder,
    reputation: snapshot.reputation,
    badges: ["Arc operator", "USDC ready", ...(snapshot.reputation.verifiedBuilder ? ["Verified builder"] : [])]
  };
}
