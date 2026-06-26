interface ImportMetaEnv {
  readonly MODE?: string;
  readonly NEXT_PUBLIC_MAINTENANCE_MODE?: string;
  readonly VITE_ARC_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_ARC_RPC_URL?: string;
  readonly VITE_ARC_EXPLORER_URL?: string;
  readonly VITE_ARC_NAMES_REGISTRY_ADDRESS?: string;
  readonly VITE_NATIVE_CURRENCY_NAME?: string;
  readonly VITE_NATIVE_CURRENCY_SYMBOL?: string;
  readonly VITE_NATIVE_CURRENCY_DECIMALS?: string;
  readonly VITE_ENABLE_ARBITRUM_SEPOLIA?: string;
  readonly VITE_ENABLE_BASE_SEPOLIA?: string;
  readonly VITE_ENABLE_ARBITRUM_ONE?: string;
  readonly VITE_ARB_SEPOLIA_RPC_URL?: string;
  readonly VITE_ARBITRUM_SEPOLIA_RPC_URL?: string;
  readonly VITE_BASE_SEPOLIA_RPC_URL?: string;
  readonly VITE_ARB_ONE_RPC_URL?: string;
  readonly VITE_ARBITRUM_ONE_RPC_URL?: string;
  readonly VITE_NEXORA_API_URL?: string;
  readonly VITE_NEXORA_PUBLIC_URL?: string;
  readonly VITE_NEXORA_SITE_URL?: string;
  readonly VITE_NEXORA_WHATSAPP_ENABLED?: string;
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_POLICY_REGISTRY_ADDRESS?: string;
  readonly VITE_X402_LEDGER_ADDRESS?: string;
  readonly VITE_REPUTATION_ADDRESS?: string;
  readonly VITE_SAVE_EARN_VAULT_ADDRESS?: string;
  readonly VITE_SAVE_EARN_DEPLOY_BLOCK?: string;
  readonly VITE_SAVE_EARN_APR?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_NEXORA_ESCROW_ADDRESS?: string;
  readonly VITE_TREASURY_ADDRESS?: string;
  readonly VITE_ARB_SEPOLIA_USDC_ADDRESS?: string;
  readonly VITE_ARB_SEPOLIA_POLICY_REGISTRY_ADDRESS?: string;
  readonly VITE_ARB_SEPOLIA_X402_LEDGER_ADDRESS?: string;
  readonly VITE_ARB_SEPOLIA_REPUTATION_ADDRESS?: string;
  readonly VITE_ARB_SEPOLIA_SAVE_EARN_VAULT_ADDRESS?: string;
  readonly VITE_ARB_SEPOLIA_SAVE_EARN_DEPLOY_BLOCK?: string;
  readonly VITE_ARB_SEPOLIA_NEXORA_ESCROW_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_USDC_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_POLICY_REGISTRY_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_X402_LEDGER_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_REPUTATION_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_SAVE_EARN_VAULT_ADDRESS?: string;
  readonly VITE_BASE_SEPOLIA_SAVE_EARN_DEPLOY_BLOCK?: string;
  readonly VITE_BASE_SEPOLIA_NEXORA_ESCROW_ADDRESS?: string;
  readonly VITE_ARB_ONE_USDC_ADDRESS?: string;
  readonly VITE_ARB_ONE_POLICY_REGISTRY_ADDRESS?: string;
  readonly VITE_ARB_ONE_X402_LEDGER_ADDRESS?: string;
  readonly VITE_ARB_ONE_REPUTATION_ADDRESS?: string;
  readonly VITE_ARB_ONE_SAVE_EARN_VAULT_ADDRESS?: string;
  readonly VITE_ARB_ONE_SAVE_EARN_DEPLOY_BLOCK?: string;
  readonly VITE_ARB_ONE_NEXORA_ESCROW_ADDRESS?: string;
  readonly VITE_WC_PROJECT_ID?: string;
  readonly VITE_NEXORA_X_URL?: string;
  readonly VITE_NEXORA_GITHUB_URL?: string;
  readonly VITE_NEXORA_CONTACT_URL?: string;
  readonly VITE_SWAP_FEE_BPS?: string;
  readonly VITE_SWAP_FEE_RECIPIENT?: string;
  readonly VITE_EURC_USD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "vite" {
  export function defineConfig(config: unknown): unknown;
  export function loadEnv(mode: string, envDir: string, prefixes?: string | string[]): Record<string, string>;
}

declare module "@vitejs/plugin-react" {
  export default function react(options?: unknown): unknown;
}
