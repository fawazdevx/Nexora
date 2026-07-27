const storagePrefix = "nexora.agent.preferred-chain";

// Circle Agent Wallets currently support these Nexora routes. BOT Chain stays
// separate: Meridian settles user-wallet Permit2 payments there, not Circle
// agent-wallet transactions.
export const circleAgentWalletChainIds = [5042002, 84532, 421614] as const;

type AgentLike = {
  id: string;
  operatorAddress: string;
  address: string | null;
  chainWallets?: Array<{chainId: number; address: string | null}>;
};

export function agentWalletChainIds(agent: AgentLike) {
  const chainIds = (agent.chainWallets ?? [])
    .filter((wallet) => Boolean(wallet.address) && circleAgentWalletChainIds.includes(wallet.chainId as typeof circleAgentWalletChainIds[number]))
    .map((wallet) => wallet.chainId);
  if (agent.address && !chainIds.includes(5042002)) chainIds.unshift(5042002);
  return [...new Set(chainIds)];
}

export function preferredAgentChainId(agent: AgentLike, fallback = 5042002) {
  if (typeof window === "undefined") return agentWalletChainIds(agent)[0] ?? fallback;
  const stored = Number(window.localStorage.getItem(preferenceKey(agent)));
  return agentWalletChainIds(agent).includes(stored) ? stored : agentWalletChainIds(agent)[0] ?? fallback;
}

export function savePreferredAgentChainId(agent: AgentLike, chainId: number) {
  if (typeof window === "undefined") return;
  if (!agentWalletChainIds(agent).includes(chainId)) return;
  window.localStorage.setItem(preferenceKey(agent), String(chainId));
}

function preferenceKey(agent: AgentLike) {
  return `${storagePrefix}.${agent.operatorAddress.toLowerCase()}.${agent.id}`;
}
