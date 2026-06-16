import {useState} from "react";
import {ArrowDownToLine, Check, Copy, ExternalLink, Loader2, Network, RefreshCw, ShieldAlert, WalletCards} from "lucide-react";
import {useQuery} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {apiGet} from "@/lib/api";
import {arcTestnet, arbitrumSepoliaWagmiChain, baseSepoliaWagmiChain, shortAddress, supportedChains, switchToChain} from "@/lib/arc";
import {
  depositGatewayUsdc,
  gatewayMinterTestnetAddress,
  gatewayWalletTestnetAddress,
  isGatewayTestnetChain,
  readUsdcBalance
} from "@/lib/contracts";

type GatewayBalances = {
  token: string;
  totalBalanceUsdc: number;
  balances: Array<{
    domain: number;
    chainId: number;
    chain: string;
    depositor: string;
    balanceUsdc: number;
    balance: string;
  }>;
  gateway: {
    environment: string;
    apiUrl: string;
  };
  updatedAt: string;
};

const gatewayChains = [arcTestnet, arbitrumSepoliaWagmiChain, baseSepoliaWagmiChain] as const;

function formatUsdc(value?: number | string) {
  const numberValue = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return "$0.00";
  return `$${numberValue.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6})}`;
}

function trimAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function txToast(title: string, hash: string, chainId?: number) {
  const chain = supportedChains.find((item) => item.id === chainId);
  const explorerUrl = chain?.blockExplorers.default.url ?? arcTestnet.explorerUrl;
  const href = `${explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
  return (
    <span>
      {title} ·{" "}
      <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-mint underline-offset-2 hover:underline">
        View tx
      </a>
    </span>
  );
}

export default function GatewayPage() {
  const {address, chain, isConnected} = useAccount();
  const [amount, setAmount] = useState("0");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState("");
  const gatewaySupported = isGatewayTestnetChain(chain?.id);

  const balances = useQuery({
    queryKey: ["gateway-balances", address],
    queryFn: () => apiGet<GatewayBalances>(`/api/gateway/balances?address=${encodeURIComponent(address as string)}`),
    enabled: Boolean(address),
    refetchInterval: 15_000
  });

  const walletBalance = useQuery({
    queryKey: ["gateway-wallet-usdc", address, chain?.id],
    queryFn: () => readUsdcBalance(address as string),
    enabled: Boolean(address) && gatewaySupported,
    refetchInterval: 15_000
  });

  const walletBalanceNumber = Number(walletBalance.data ?? 0);
  const depositDisabled = !isConnected || !gatewaySupported || pending || Number(amount) <= 0;

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1600);
  }

  async function selectChain(chainId: number) {
    const target = supportedChains.find((item) => item.id === chainId);
    if (!target) {
      toast.error("Enable this chain in the frontend env first.");
      return;
    }
    try {
      await switchToChain(target);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network switch failed");
    }
  }

  async function submitDeposit() {
    if (!address || !isConnected) {
      toast.error("Connect your wallet first.");
      return;
    }
    if (!gatewaySupported) {
      toast.error("Switch to Arc Testnet, Arbitrum Sepolia, or Base Sepolia.");
      return;
    }
    if (Number(amount) <= 0) {
      toast.error("Enter a USDC amount.");
      return;
    }

    setPending(true);
    const toastId = toast.loading("Approving USDC for Gateway…");
    try {
      const activeChainId = chain?.id;
      const result = await depositGatewayUsdc(amount);
      await Promise.all([balances.refetch(), walletBalance.refetch()]);
      setAmount("0");
      toast.success(txToast("Gateway deposit confirmed", result.depositHash, activeChainId), {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gateway deposit failed", {id: toastId});
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Circle Gateway"
        title="Unified USDC balance"
        description="View Gateway deposits across supported testnets and deposit USDC into Circle Gateway from Nexora. Deposits credit your unified balance; cross-chain burn and mint execution is intentionally not automated here yet."
        action={
          <button className="secondary-button" onClick={() => void balances.refetch()} disabled={!address || balances.isFetching}>
            {balances.isFetching ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatMetric variant="landing" size="lg" value={balances.data?.totalBalanceUsdc ?? 0} prefix="$" decimals={2} label="Unified Gateway balance" loading={balances.isLoading} accent />
        {(balances.data?.balances ?? gatewayChains.map((item) => ({chain: item.name, chainId: item.id, balanceUsdc: 0, domain: 0, depositor: "", balance: "0"}))).map((item) => (
          <StatMetric key={item.chainId} variant="landing" value={item.balanceUsdc} prefix="$" decimals={2} label={`${item.chain} · domain ${item.domain || gatewayDomainLabel(item.chainId)}`} loading={balances.isLoading} />
        ))}
      </section>

      {balances.isError ? (
        <p className="rounded-xl border border-magenta/30 bg-magenta/10 p-3 text-sm text-magenta">
          {balances.error instanceof Error ? balances.error.message : "Gateway balances are unavailable."}
        </p>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-kicker">Deposit</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Add USDC to Gateway</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
                This calls the Gateway Wallet deposit function after approval. Do not transfer USDC directly to the Gateway Wallet address.
              </p>
            </div>
            <span className="status-pill border-mint/20 bg-mint/10 text-mint">
              <Network size={13} />
              {chain?.name ?? "No network"}
            </span>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {gatewayChains.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void selectChain(item.id)}
                className={`surface px-3 py-3 text-left text-sm ${chain?.id === item.id ? "border-plasma/50 bg-plasma/10" : ""}`}
              >
                <span className="font-semibold text-white">{item.name}</span>
                <span className="mt-1 block text-xs text-slate-500">Domain {gatewayDomainLabel(item.id)}</span>
              </button>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="gateway-amount" className="text-sm font-medium text-slate-300">USDC amount</label>
              <button
                type="button"
                className="text-xs font-semibold text-mint hover:underline disabled:text-slate-600 disabled:no-underline"
                disabled={!gatewaySupported || walletBalanceNumber <= 0}
                onClick={() => setAmount(trimAmount(walletBalanceNumber))}
              >
                Wallet: {gatewaySupported ? formatUsdc(walletBalanceNumber) : "unsupported chain"}
              </button>
            </div>
            <div className="field flex items-center gap-2 p-0 pr-3">
              <input
                id="gateway-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-2xl font-semibold text-white outline-none"
              />
              <button
                type="button"
                className="shrink-0 rounded-lg border border-mint/30 bg-mint/10 px-2.5 py-1 text-xs font-bold text-mint transition hover:bg-mint/20 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!gatewaySupported || walletBalanceNumber <= 0}
                onClick={() => setAmount(trimAmount(walletBalanceNumber))}
              >
                MAX
              </button>
              <span className="shrink-0 text-sm font-medium text-slate-400">USDC</span>
            </div>
          </div>

          <button onClick={() => void submitDeposit()} className="action-button mt-4 w-full" disabled={depositDisabled}>
            {pending ? <Loader2 size={17} className="animate-spin" /> : <ArrowDownToLine size={17} />}
            {pending ? "Depositing…" : "Deposit to Gateway"}
          </button>

          {!gatewaySupported && isConnected ? (
            <p className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
              Switch to a supported Gateway testnet before depositing.
            </p>
          ) : null}
        </div>

        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-kicker">Balances</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Gateway domains</h2>
            </div>
            <span className="status-pill">{balances.data?.gateway.environment ?? "testnet"}</span>
          </div>

          {!address ? (
            <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-10 text-center">
              <WalletCards size={28} className="text-orchid" />
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">Connect your wallet to query your unified Gateway balance across Arc, Base Sepolia, and Arbitrum Sepolia.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-3">
              {(balances.data?.balances ?? []).map((item) => (
                <div key={item.chainId} className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-semibold text-white">{item.chain}</p>
                    <p className="mt-1 text-xs text-slate-500">Domain {item.domain} · {shortAddress(item.depositor)}</p>
                  </div>
                  <p className="text-lg font-semibold text-white">{formatUsdc(item.balanceUsdc)}</p>
                </div>
              ))}
              <p className="text-xs leading-5 text-slate-500">
                Last updated {balances.data ? new Date(balances.data.updatedAt).toLocaleTimeString() : "after connection"}. Current chain balance: {gatewaySupported ? formatUsdc(walletBalanceNumber) : "switch to a supported chain"}.
              </p>
            </div>
          )}

          <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <ShieldAlert size={16} />
              Deposit safety
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-50/80">
              Gateway credits unified balance only through the Gateway Wallet deposit function. A direct ERC-20 transfer to the Gateway Wallet can leave funds uncredited.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Contracts</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Gateway testnet addresses</h2>
          </div>
          <a className="secondary-button" href="https://developers.circle.com/gateway" target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Circle Gateway docs
          </a>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <AddressRow label="Gateway Wallet" value={gatewayWalletTestnetAddress} copied={copied === "wallet"} onCopy={() => void copy("wallet", gatewayWalletTestnetAddress)} />
          <AddressRow label="Gateway Minter" value={gatewayMinterTestnetAddress} copied={copied === "minter"} onCopy={() => void copy("minter", gatewayMinterTestnetAddress)} />
        </div>
      </section>
    </div>
  );
}

function gatewayDomainLabel(chainId: number) {
  if (chainId === arcTestnet.id) return 26;
  if (chainId === arbitrumSepoliaWagmiChain.id) return 3;
  if (chainId === baseSepoliaWagmiChain.id) return 6;
  return "—";
}

function AddressRow({label, value, copied, onCopy}: {label: string; value: string; copied: boolean; onCopy: () => void}) {
  return (
    <div className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-slate-400">{label}</p>
        <p className="mt-1 break-all font-mono text-sm text-white">{value}</p>
      </div>
      <button type="button" className="secondary-button min-h-10 px-3 py-2 text-xs" onClick={onCopy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
