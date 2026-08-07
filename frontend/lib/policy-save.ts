export type PolicyRegistrationResult = {
  status: "already_registered" | "registered" | "pending";
  registered: boolean;
  transactionId: string | null;
  txHash: string | null;
};

export type PolicySaveStage =
  | "registering"
  | "waiting_registration"
  | "writing_policy"
  | "persisting";

export async function completePolicySave<TTxHash extends string>(input: {
  register: () => Promise<PolicyRegistrationResult | null>;
  waitForRegistration: (registration: PolicyRegistrationResult) => Promise<void>;
  writeOnchain: (options: {skipBasicPolicy: boolean}) => Promise<TTxHash | null>;
  persist: (txHash: TTxHash | null) => Promise<void>;
  onStage?: (stage: PolicySaveStage) => void;
}) {
  input.onStage?.("registering");
  const registration = await input.register();
  let skipBasicPolicy = registration?.registered === true;

  if (registration?.status === "pending") {
    input.onStage?.("waiting_registration");
    await input.waitForRegistration(registration);
    skipBasicPolicy = true;
  }

  input.onStage?.("writing_policy");
  const txHash = await input.writeOnchain({skipBasicPolicy});

  input.onStage?.("persisting");
  await input.persist(txHash);
  return txHash;
}
