import {useState} from "react";
import {ArrowDownToLine, ArrowRightLeft, Check, Copy, ExternalLink, Loader2, Network, RefreshCw, ShieldAlert, WalletCards} from "lucide-react";
import {useQuery} from "@tanstack/react-query";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {apiGet, apiPost} from "@/lib/api";
import {arcTestnet, arbitrumSepoliaWagmiChain, baseSepoliaWagmiChain, shortAddress, supportedChains, switchToChain} from "@/lib/arc";
import {
  depositGatewayUsdc,
  gatewayMinterTestnetAddress,
  gatewayWalletTestnetAddress,
  isGatewayTestnetChain,
  readUsdcBalance,
  signGatewayBurnIntent,
  type GatewayBurnIntent
} from "@/lib/contracts";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type GatewayBalances = {
  token: string;
  totalBalanceUsdc: number;
  unifiedAvailableUsdc: number;
  balances: Array<{
    domain: number;
    chainId: number;
    chain: string;
    depositor: string;
    balanceUsdc: number;
    balance: string;
  }>;
  pendingDeposits: Array<{
    depositor?: string;
    domain?: number;
    transactionHash?: string;
    amount?: string;
    amountUsdc: number;
    status?: string;
    chainId: number | null;
    chain: string;
  }>;
  gateway: {
    environment: string;
    apiUrl: string;
  };
  updatedAt: string;
};

type GatewayEstimate = {
  burnIntent: GatewayBurnIntent;
  fees: unknown;
  source: {chainId: number; chain: string; domain: number};
  destination: {chainId: number; chain: string; domain: number};
  destinationRecipient: string;
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
  const [transferPending, setTransferPending] = useState(false);
  const [transferAmount, setTransferAmount] = useState("0");
  const [sourceChainId, setSourceChainId] = useState<number>(arcTestnet.id);
  const [destinationChainId, setDestinationChainId] = useState<number>(baseSepoliaWagmiChain.id);
  const [recipientMode, setRecipientMode] = useState<"operator" | "agent">("operator");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [copied, setCopied] = useState("");
  const snapshot = useAppSnapshot();
  const agents = (snapshot.data?.agents ?? []).filter((agent) => agent.walletKind !== "external_eoa");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const destinationAgentWallet = selectedAgent?.chainWallets?.find((wallet) => wallet.chainId === destinationChainId)?.address
    ?? (destinationChainId === arcTestnet.id ? selectedAgent?.address : null);
  const destinationRecipient = recipientMode === "agent" ? destinationAgentWallet : address;
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
  const sourceBalance = balances.data?.balances.find((item) => item.chainId === sourceChainId)?.balanceUsdc ?? 0;
  const transferDisabled = !address
    || transferPending
    || Number(transferAmount) <= 0
    || Number(transferAmount) > sourceBalance
    || sourceChainId === destinationChainId
    || !destinationRecipient;

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

  function selectSourceChain(chainId: number) {
    setSourceChainId(chainId);
    if (destinationChainId === chainId) {
      const nextDestination = gatewayChains.find((item) => item.id !== chainId);
      if (nextDestination) setDestinationChainId(nextDestination.id);
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

  async function submitTransfer() {
    if (!address || !destinationRecipient) {
      toast.error(recipientMode === "agent" ? "Select an agent wallet available on the destination chain." : "Connect your wallet first.");
      return;
    }
    if (Number(transferAmount) <= 0 || Number(transferAmount) > sourceBalance) {
      toast.error(`Enter an amount up to ${formatUsdc(sourceBalance)} from the selected source domain.`);
      return;
    }
    setTransferPending(true);
    const toastId = toast.loading("Estimating Gateway fee…");
    try {
      const estimate = await apiPost<GatewayEstimate>("/api/gateway/estimate", {
        operatorAddress: address,
        sourceChainId,
        destinationChainId,
        destinationRecipient,
        amountUsdc: Number(transferAmount),
        salt: randomBytes32()
      });
      toast.loading("Sign the Gateway burn intent…", {id: toastId});
      const signature = await signGatewayBurnIntent(estimate.burnIntent);
      toast.loading("Forwarding USDC to the destination chain…", {id: toastId});
      const result = await apiPost<Record<string, unknown>>("/api/gateway/transfer", {
        operatorAddress: address,
        burnIntent: estimate.burnIntent,
        signature
      });
      setTransferAmount("0");
      await balances.refetch();
      toast.success(`Gateway transfer submitted${gatewayTransferId(result) ? ` · ${gatewayTransferId(result)}` : ""}.`, {id: toastId});
    } catch (error) {
      toast.error(gatewayTransferError(error), {id: toastId});
    } finally {
      setTransferPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Circle Gateway"
        title="Unified USDC balance"
        description="Deposit once, view one unified balance, and move USDC from Arc to Base or Arbitrum for an operator or agent wallet."
        action={
          <button className="secondary-button" onClick={() => void balances.refetch()} disabled={!address || balances.isFetching}>
            {balances.isFetching ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {balances.isError ? (
          <>
            <UnavailableStat size="lg" label="Unified Gateway balance" />
            {gatewayChains.map((item) => (
              <UnavailableStat key={item.id} label={`${item.name} · domain ${gatewayDomainLabel(item.id)}`} />
            ))}
          </>
        ) : (
          <>
            <StatMetric variant="landing" size="lg" value={balances.data?.totalBalanceUsdc ?? 0} prefix="$" decimals={2} label="Unified Gateway balance" loading={balances.isLoading} accent />
            {gatewayChains.map((item) => (
              <StatMetric key={item.id} variant="landing" value={balances.data?.unifiedAvailableUsdc ?? 0} prefix="$" decimals={2} label={`Available to ${item.name}`} loading={balances.isLoading} />
            ))}
          </>
        )}
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
                  <div className="text-right">
                    <p className="text-lg font-semibold text-white">{formatUsdc(item.balanceUsdc)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">source deposit balance</p>
                  </div>
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-kicker">Cross-chain transfer</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Use the unified balance on another chain</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Sign a Gateway burn intent, then let Circle’s Forwarding Service deliver USDC to the destination. The recipient does not need destination gas.
            </p>
          </div>
          <span className="status-pill border-mint/20 bg-mint/10 text-mint">
            <ArrowRightLeft size={13} />
            Forwarder enabled
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-slate-300">
            Source deposits
            <select className="field mt-2 w-full" value={sourceChainId} onChange={(event) => selectSourceChain(Number(event.target.value))}>
              {gatewayChains.map((item) => {
                const available = balances.data?.balances.find((balance) => balance.chainId === item.id)?.balanceUsdc ?? 0;
                return <option key={item.id} value={item.id}>{item.name} · {formatUsdc(available)}</option>;
              })}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Destination
            <select className="field mt-2 w-full" value={destinationChainId} onChange={(event) => setDestinationChainId(Number(event.target.value))}>
              {gatewayChains.filter((item) => item.id !== sourceChainId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Recipient
            <select className="field mt-2 w-full" value={recipientMode} onChange={(event) => setRecipientMode(event.target.value as "operator" | "agent")}>
              <option value="operator">Connected operator</option>
              <option value="agent">Agent wallet</option>
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Amount
            <div className="field mt-2 flex items-center gap-2 p-0 pr-3">
              <input className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-white outline-none" inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} />
              <button type="button" className="text-xs font-bold text-mint" onClick={() => setTransferAmount(trimAmount(sourceBalance))}>MAX</button>
            </div>
          </label>
        </div>

        {recipientMode === "agent" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="text-sm text-slate-300">
              Destination agent
              <select className="field mt-2 w-full" value={selectedAgent?.id ?? ""} onChange={(event) => setSelectedAgentId(event.target.value)}>
                {agents.map((agent) => {
                  const wallet = agent.chainWallets?.find((item) => item.chainId === destinationChainId)?.address
                    ?? (destinationChainId === arcTestnet.id ? agent.address : null);
                  return <option key={agent.id} value={agent.id} disabled={!wallet}>{agent.arcName ?? shortAddress(agent.operatorAddress)} · {wallet ? shortAddress(wallet) : "wallet pending"}</option>;
                })}
              </select>
            </label>
            <p className="pb-3 font-mono text-xs text-slate-500">{destinationAgentWallet ? shortAddress(destinationAgentWallet) : "No ready agent wallet on this chain"}</p>
          </div>
        ) : null}

        <button type="button" onClick={() => void submitTransfer()} className="action-button mt-5" disabled={transferDisabled}>
          {transferPending ? <Loader2 size={17} className="animate-spin" /> : <ArrowRightLeft size={17} />}
          {transferPending ? "Submitting transfer…" : "Transfer unified USDC"}
        </button>
      </section>

      {(balances.data?.pendingDeposits?.length ?? 0) > 0 ? (
        <section className="panel">
          <p className="section-kicker">Pending deposits</p>
          <div className="mt-4 grid gap-2">
            {balances.data?.pendingDeposits.map((deposit, index) => (
              <div key={deposit.transactionHash ?? `${deposit.domain}-${index}`} className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{deposit.chain}</p>
                  <p className="mt-1 text-xs text-slate-500">{deposit.status ?? "pending"}{deposit.transactionHash ? ` · ${shortAddress(deposit.transactionHash)}` : ""}</p>
                </div>
                <p className="font-semibold text-amber">{formatUsdc(deposit.amountUsdc)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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

function gatewayTransferError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/Expected bytes32, got bytes20|invalid transfer estimate|burnIntent\.spec/i.test(message)) {
    return "Gateway could not prepare this transfer. Refresh the estimate and try again.";
  }
  if (/Gateway.*(failed|unavailable|error)/i.test(message)) return "Gateway could not complete this transfer right now. Please try again.";
  return message || "Gateway transfer failed";
}

function randomBytes32() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function gatewayTransferId(result: Record<string, unknown>) {
  const candidates = [
    result.transferId,
    result.id,
    Array.isArray(result.body) ? (result.body[0] as Record<string, unknown> | undefined)?.transferId : null
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

function gatewayDomainLabel(chainId: number) {
  if (chainId === arcTestnet.id) return 26;
  if (chainId === arbitrumSepoliaWagmiChain.id) return 3;
  if (chainId === baseSepoliaWagmiChain.id) return 6;
  return "—";
}

function UnavailableStat({label, size = "md"}: {label: string; size?: "md" | "lg"}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 backdrop-blur-sm">
      <p className={`${size === "lg" ? "text-3xl" : "text-2xl"} font-semibold text-slate-500`}>—</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
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
