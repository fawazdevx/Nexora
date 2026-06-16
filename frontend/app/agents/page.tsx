import {useState} from "react";
import {Bot, Check, Copy, ExternalLink, Gauge, Loader2, Plus, RefreshCw, Settings, ShieldCheck, Wallet} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {apiPost} from "@/lib/api";
import {useArcName} from "@/hooks/useArcName";
import {PageHeader} from "@/components/PageHeader";
import {StatMetric} from "@/components/StatMetric";
import {AgentAvatar} from "@/components/AgentAvatar";
import {EmptyState} from "@/components/EmptyState";
import {arcTestnet, shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {navigateTo} from "@/lib/router";
import {PlanSubscriptionCard} from "@/components/PlanSubscriptionCard";

type Agent = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["agents"][number];

function statusVisual(status: string, hasAddress: boolean) {
  const s = status.toLowerCase();
  if (s === "ready" || hasAddress) {
    return {kind: "good" as const, label: "Ready", dot: "bg-mint", text: "text-mint", bar: "from-mint/60 to-mint/0"};
  }
  if (s.includes("error") || s.includes("failed") || s.includes("rejected")) {
    return {kind: "bad" as const, label: "Error", dot: "bg-magenta", text: "text-magenta", bar: "from-magenta/60 to-magenta/0"};
  }
  return {kind: "warn" as const, label: "Pending", dot: "bg-amber", text: "text-amber", bar: "from-amber/60 to-amber/0"};
}

function statusCopy(status: string) {
  if (status === "ready") return "Circle wallet ready";
  if (status === "circle_wallet_pending_address") return "Circle accepted the request; address pending";
  return status;
}

export default function AgentsPage() {
  const {address, isConnected} = useAccount();
  const walletReady = Boolean(address);
  const {arcName} = useArcName(address);
  const [creating, setCreating] = useState(false);
  const snapshot = useAppSnapshot();
  const agents = snapshot.data?.agents ?? [];
  const existingReadyWallet = agents.find((agent) => agent.operatorAddress.toLowerCase() === address?.toLowerCase() && agent.address);

  const readyCount = agents.filter((agent) => Boolean(agent.address) || agent.circleWalletStatus === "ready").length;
  const pendingCount = agents.length - readyCount;
  const combinedDailyLimit = agents.reduce((total, agent) => total + Number(agent.policy.dailyLimitUsdc || 0), 0);

  async function createAgentWallet() {
    if (!walletReady || !address) {
      toast.error("Connect your wallet before creating an agent wallet.");
      return;
    }
    setCreating(true);
    const toastId = toast.loading("Creating Circle agent wallet…");
    try {
      const result = await apiPost<{id: string; circleWalletStatus: string}>("/api/agents", {
        operatorAddress: address,
        arcName,
        dailyLimitUsdc: 400,
        transactionCapUsdc: 45
      });
      await snapshot.refetch();
      toast.success(`Agent wallet created for ${arcName ?? shortAddress(address)} · ${result.circleWalletStatus}`, {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Agent wallet creation failed", {id: toastId});
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Circle Agent Wallets"
        title="Agent wallet infrastructure"
        description="Provision agent wallets, enforce spend rules, and monitor autonomous payment readiness."
        action={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void snapshot.refetch()} className="secondary-button"><RefreshCw size={16} className={snapshot.isFetching ? "animate-spin" : ""} /> Refresh</button>
            <button onClick={createAgentWallet} className="action-button" disabled={!walletReady || creating || Boolean(existingReadyWallet)}>
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {creating ? "Creating…" : existingReadyWallet ? "Wallet already active" : walletReady ? "Create agent wallet" : "Connect wallet first"}
            </button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatMetric variant="panel" icon={Bot} label="Agent wallets" value={agents.length} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={ShieldCheck} label="Ready" value={readyCount} loading={snapshot.isLoading} accent />
        <StatMetric variant="panel" icon={Loader2} label="Pending" value={pendingCount} loading={snapshot.isLoading} />
        <StatMetric variant="panel" icon={Gauge} label="Combined daily limit" value={combinedDailyLimit} prefix="$" decimals={0} loading={snapshot.isLoading} />
      </div>

      <div className="surface flex items-start gap-3 px-4 py-3 text-sm leading-6 text-slate-300">
        <Loader2 size={16} className="mt-0.5 shrink-0 text-orchid" />
        <span>Agent wallets may take a short moment to become ready. Nexora keeps checking for the wallet address automatically.</span>
      </div>

      <PlanSubscriptionCard
        planId="premium_agent_automation"
        subscriptions={snapshot.data?.subscriptions ?? []}
        onActivated={async () => {
          await snapshot.refetch();
        }}
      />

      {snapshot.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="panel space-y-4">
              <div className="flex items-center gap-3">
                <div className="shimmer h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <div className="shimmer h-4 w-32 rounded" />
                  <div className="shimmer h-3 w-20 rounded" />
                </div>
              </div>
              <div className="shimmer h-9 w-full rounded-lg" />
              <div className="shimmer h-9 w-full rounded-lg" />
              <div className="shimmer h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : agents.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : !isConnected ? (
        <EmptyState
          icon={<Wallet size={26} />}
          title="Connect your wallet"
          copy="Connect a wallet to provision policy-controlled agent wallets and monitor their readiness."
        />
      ) : (
        <EmptyState
          icon={<Bot size={26} />}
          title="No agent wallets yet"
          copy="Create your first agent wallet to start policy-controlled autonomous spending."
          action={
            <button onClick={createAgentWallet} className="action-button" disabled={creating}>
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Create agent wallet
            </button>
          }
        />
      )}
    </div>
  );
}

function AgentCard({agent}: {agent: Agent}) {
  const hasAddress = Boolean(agent.address);
  const visual = statusVisual(agent.circleWalletStatus, hasAddress);
  const name = agent.arcName ?? agent.address ?? shortAddress(agent.operatorAddress);
  const contracts = agent.policy.contractAllowlist;
  const recipients = agent.policy.recipientAllowlist;

  return (
    <article className="panel relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${visual.bar}`} />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar seed={agent.address ?? agent.id} label={agent.arcName ?? agent.address} />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-white">{name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {agent.policy.active ? "Active" : "Inactive"}
              {agent.createdAt ? <span> · created {timeAgo(agent.createdAt)}</span> : null}
            </p>
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-xs font-semibold ${visual.text}`}>
          <span className="relative flex h-2 w-2">
            {visual.kind === "good" ? <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${visual.dot} opacity-75`} /> : null}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${visual.dot}`} />
          </span>
          {visual.label}
        </span>
      </div>

      <p className="mb-4 text-sm text-slate-400">{statusCopy(agent.circleWalletStatus)}</p>

      <div className="grid gap-2 text-sm text-slate-300">
        <div className="surface flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-slate-400">Wallet</span>
          <span className="flex items-center gap-1.5">
            <b className="text-white">{agent.address ? shortAddress(agent.address) : "Circle pending"}</b>
            {agent.address ? (
              <>
                <CopyButton value={agent.address} label="wallet address" />
                <a href={`${arcTestnet.explorerUrl.replace(/\/$/, "")}/address/${agent.address}`} target="_blank" rel="noreferrer" className="text-slate-500 transition hover:text-orchid" aria-label="View on explorer">
                  <ExternalLink size={13} />
                </a>
              </>
            ) : null}
          </span>
        </div>
        <div className="surface flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-slate-400">Circle ID</span>
          <span className="flex items-center gap-1.5">
            <b className="text-white">{agent.circleWalletId ? shortAddress(agent.circleWalletId) : "pending"}</b>
            {agent.circleWalletId ? <CopyButton value={agent.circleWalletId} label="Circle ID" /> : null}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="surface flex items-center justify-between px-3 py-2"><span className="text-slate-400">Daily limit</span><b className="text-white">${agent.policy.dailyLimitUsdc}</b></div>
          <div className="surface flex items-center justify-between px-3 py-2"><span className="text-slate-400">Tx cap</span><b className="text-white">${agent.policy.transactionCapUsdc}</b></div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        <AllowlistGroup label="Contracts" items={contracts} />
        <AllowlistGroup label="Recipients" items={recipients} />
      </div>

      <button type="button" onClick={() => navigateTo("/settings/policies")} className="secondary-button mt-4 w-full justify-center">
        <Settings size={15} />
        Manage policy
      </button>
    </article>
  );
}

function AllowlistGroup({label, items}: {label: string; items: string[]}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label} · {items.length}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.length > 0 ? (
          items.map((item) => <span key={item} className="status-pill px-2.5 py-1 text-[11px]">{shortAddress(item)}</span>)
        ) : (
          <span className="text-xs text-slate-600">None saved</span>
        )}
      </div>
    </div>
  );
}

function CopyButton({value, label}: {value: string; label: string}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`Copied ${label}`);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  }
  return (
    <button type="button" onClick={copy} className="text-slate-500 transition hover:text-white" aria-label={`Copy ${label}`}>
      {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
    </button>
  );
}
