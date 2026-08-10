import {useEffect, useMemo, useState} from "react";
import {AlertTriangle, CheckCircle2, ClipboardCheck, Clock, Loader2, Play, ShieldCheck, XCircle} from "lucide-react";
import toast from "react-hot-toast";
import {useAccount} from "wagmi";
import {AgentPicker} from "@/components/AgentPicker";
import {AgentAvatar} from "@/components/AgentAvatar";
import {EmptyState} from "@/components/EmptyState";
import {apiPost} from "@/lib/api";
import {shortAddress} from "@/lib/arc";
import {timeAgo} from "@/lib/time";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";

type Snapshot = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>;
type ApprovalRequest = Snapshot["approvalRequests"][number];

type SimulationResult = {
  allowed: boolean;
  reason: string | null;
  agent: {
    id: string;
    address: string | null;
    arcName: string | null;
    dailyLimitUsdc: number;
    transactionCapUsdc: number;
  };
  service: {
    id: string;
    chainServiceId: number | null;
    name: string;
    publisherAddress: string;
    pricePerUnitUsdc: number;
  };
  units: number;
  amountUsdc: number;
  dailySpentUsdc: number;
  weeklySpentUsdc: number;
  monthlySpentUsdc: number;
  remainingDailyUsdc: number;
  requestHash: string;
};

export function PolicySimulationPanel({
  variant = "full",
  lockedAgentId,
  onSelectAgent
}: {
  variant?: "full" | "embedded";
  lockedAgentId?: string;
  onSelectAgent?: (id: string) => void;
} = {}) {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const agents = (snapshot.data?.agents ?? []).filter((agent) => agent.walletKind !== "external_eoa");
  const services = (snapshot.data?.services ?? []).filter((service) => service.active);
  const requests = snapshot.data?.approvalRequests ?? [];
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const recentRequests = [...requests]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, variant === "embedded" ? 6 : 8)
    .filter((request) => !lockedAgentId || request.agentId === lockedAgentId);

  const [agentId, setAgentId] = useState(lockedAgentId ?? "");
  const [serviceId, setServiceId] = useState("");
  const [units, setUnits] = useState("1");
  const [note, setNote] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [decidingId, setDecidingId] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);

  useEffect(() => {
    if (lockedAgentId) {
      setAgentId(lockedAgentId);
      setResult(null);
    }
  }, [lockedAgentId]);

  useEffect(() => {
    if (lockedAgentId) return;
    if (!agentId && agents[0]) setAgentId(agents[0].id);
  }, [agents, agentId, lockedAgentId]);

  useEffect(() => {
    if (!serviceId && services[0]) setServiceId(services[0].id);
  }, [services, serviceId]);

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedService = services.find((service) => service.id === serviceId);
  const estimatedAmount = selectedService ? Number(selectedService.pricePerUnitUsdc || 0) * Number(units || 0) : 0;
  const serviceOptions = useMemo(() => services.slice().sort((a, b) => a.name.localeCompare(b.name)), [services]);

  function changeAgent(id: string) {
    setAgentId(id);
    setResult(null);
    onSelectAgent?.(id);
  }

  async function simulate() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before testing a policy.");
      return;
    }
    if (!agentId || !serviceId) {
      toast.error("Select an agent and service first.");
      return;
    }
    setSimulating(true);
    try {
      const data = await apiPost<SimulationResult>("/api/policies/simulate", {
        operatorAddress: address,
        agentId,
        serviceId,
        units: Number(units || 1)
      });
      setResult(data);
      toast.success(data.allowed ? "Policy test passed" : "Policy test blocked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Policy test failed");
    } finally {
      setSimulating(false);
    }
  }

  async function createRequest() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet before creating an approval request.");
      return;
    }
    if (!agentId || !serviceId) {
      toast.error("Select an agent and service first.");
      return;
    }
    setRequesting(true);
    const toastId = toast.loading("Creating approval request…");
    try {
      await apiPost<ApprovalRequest>("/api/agent-approvals", {
        operatorAddress: address,
        agentId,
        serviceId,
        units: Number(units || 1),
        note
      });
      setNote("");
      await snapshot.refetch();
      toast.success("Approval request added to queue", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Approval request failed", {id: toastId});
    } finally {
      setRequesting(false);
    }
  }

  async function decide(request: ApprovalRequest, decision: "approve" | "reject") {
    if (!address) {
      toast.error("Connect your wallet before deciding an approval request.");
      return;
    }
    setDecidingId(`${request.id}:${decision}`);
    const toastId = toast.loading(decision === "approve" ? "Approving request…" : "Rejecting request…");
    try {
      await apiPost<ApprovalRequest>(`/api/agent-approvals/${encodeURIComponent(request.id)}/${decision}`, {
        operatorAddress: address
      });
      await snapshot.refetch();
      toast.success(decision === "approve" ? "Request approved" : "Request rejected", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Approval update failed", {id: toastId});
    } finally {
      setDecidingId("");
    }
  }

  const testPanel = (
    <div className={variant === "embedded" ? "space-y-4" : "panel"}>
      {variant === "full" ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="section-kicker flex items-center gap-2"><Play size={14} /> Policy simulation</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Test an agent payment before it happens</h2>
            <p className="muted-copy mt-2 max-w-2xl">
              Run the same policy checks used at authorization: spend caps, cooldowns, allowlists, expiry, and service limits.
            </p>
          </div>
          <span className="status-pill">{pendingRequests.length} pending</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">Test this policy</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Simulate a payment against the selected agent before real spend.
            </p>
          </div>
          <span className="status-pill">{pendingRequests.filter((item) => !lockedAgentId || item.agentId === lockedAgentId).length} pending</span>
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {variant === "full" || !lockedAgentId ? (
          <div className="grid min-w-[240px] flex-1 gap-2 text-sm text-slate-300">
            Agent
            <AgentPicker agents={agents} value={selectedAgent} onChange={changeAgent} />
          </div>
        ) : null}
        <label className="grid min-w-[200px] flex-1 gap-2 text-sm text-slate-300">
          Service
          <select className="field w-full min-w-0 bg-slate-950 text-white" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            {serviceOptions.length === 0 ? <option value="">No services available</option> : null}
            {serviceOptions.map((service) => (
              <option key={service.id} value={service.id}>{service.name} · ${service.pricePerUnitUsdc}/unit</option>
            ))}
          </select>
        </label>
        <label className="grid w-24 shrink-0 gap-2 text-sm text-slate-300">
          Units
          <input
            className="field w-full"
            inputMode="numeric"
            value={units}
            onChange={(event) => setUnits(event.target.value.replace(/[^\d]/g, "") || "1")}
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MiniMetric label="Estimated spend" value={`$${formatUsdc(estimatedAmount)}`} />
        <MiniMetric label="Daily limit" value={selectedAgent ? `$${formatUsdc(selectedAgent.policy.dailyLimitUsdc)}` : "—"} />
        <MiniMetric label="Tx cap" value={selectedAgent ? `$${formatUsdc(selectedAgent.policy.transactionCapUsdc)}` : "—"} />
      </div>

      <label className="mt-4 grid gap-2 text-sm text-slate-300">
        Request note
        <input className="field" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional reason for this approval" />
      </label>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void simulate()}
          disabled={!isConnected || simulating || agents.length === 0 || services.length === 0}
        >
          {simulating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          Test payment
        </button>
        <button
          type="button"
          className="action-button"
          onClick={() => void createRequest()}
          disabled={!isConnected || requesting || agents.length === 0 || services.length === 0}
        >
          {requesting ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
          Queue for approval
        </button>
      </div>

      {result ? <SimulationResultCard result={result} /> : null}
    </div>
  );

  const queuePanel = (
    <div className={variant === "embedded" ? "space-y-4 border-t border-white/[0.08] pt-4" : "panel"}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <p className={`${variant === "embedded" ? "text-sm font-bold text-white" : "section-kicker flex items-center gap-2"}`}>
            {variant === "embedded" ? "Approval queue" : <><Clock size={14} /> Approval queue</>}
          </p>
          {variant === "full" ? <h2 className="mt-2 text-xl font-semibold text-white">Agent payment requests</h2> : (
            <p className="mt-1 text-xs text-slate-400">
              {lockedAgentId ? "Pending and recent requests for this agent." : "Recent agent payment requests."}
            </p>
          )}
        </div>
        <button type="button" className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={() => void snapshot.refetch()}>
          Refresh
        </button>
      </div>

      {snapshot.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="shimmer h-24 rounded-xl" />)}</div>
      ) : recentRequests.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="No approval requests"
          copy="Test a payment and queue it here before an agent spends USDC."
          className="border-0 bg-transparent p-0 shadow-none py-6"
        />
      ) : (
        <div className="space-y-3">
          {recentRequests.map((request) => (
            <ApprovalRequestCard
              key={request.id}
              request={request}
              decidingId={decidingId}
              onApprove={() => void decide(request, "approve")}
              onReject={() => void decide(request, "reject")}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (variant === "embedded") {
    return (
      <div className="space-y-5">
        {testPanel}
        {queuePanel}
      </div>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_420px]">
      {testPanel}
      {queuePanel}
    </section>
  );
}

function SimulationResultCard({result}: {result: SimulationResult}) {
  const Icon = result.allowed ? CheckCircle2 : XCircle;
  return (
    <div className={`mt-5 rounded-xl border p-4 ${result.allowed ? "border-mint/25 bg-mint/10" : "border-amber/25 bg-amber/10"}`}>
      <div className="flex items-start gap-3">
        <Icon size={20} className={result.allowed ? "mt-0.5 shrink-0 text-mint" : "mt-0.5 shrink-0 text-amber"} />
        <div className="min-w-0">
          <p className={`font-semibold ${result.allowed ? "text-mint" : "text-amber"}`}>
            {result.allowed ? "Payment would pass policy" : "Payment would be blocked"}
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {result.reason ?? `${result.service.name} can spend ${formatUsdc(result.amountUsdc)} USDC for ${result.units} unit${result.units === 1 ? "" : "s"}.`}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <MiniMetric label="Daily spent" value={`$${formatUsdc(result.dailySpentUsdc)}`} />
        <MiniMetric label="Weekly spent" value={`$${formatUsdc(result.weeklySpentUsdc)}`} />
        <MiniMetric label="Monthly spent" value={`$${formatUsdc(result.monthlySpentUsdc)}`} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <MiniMetric label="Remaining daily" value={`$${formatUsdc(result.remainingDailyUsdc)}`} />
        <MiniMetric label="Request hash" value={shortAddress(result.requestHash)} />
      </div>
    </div>
  );
}

function ApprovalRequestCard({
  request,
  decidingId,
  onApprove,
  onReject
}: {
  request: ApprovalRequest;
  decidingId: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const pending = request.status === "pending";
  const blocked = !request.simulation.allowed;
  return (
    <article className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar seed={request.agentWallet ?? request.agentId} label={request.serviceName} size={34} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{request.serviceName}</p>
            <p className="mt-0.5 text-[13px] text-slate-400">
              {timeAgo(request.createdAt)} · {request.units} unit{request.units === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <RequestStatus status={request.status} blocked={blocked} />
      </div>

      <div className="mt-3 grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Amount</span>
          <b className="text-white">${formatUsdc(request.amountUsdc)}</b>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Publisher</span>
          <b className="font-mono text-white">{shortAddress(request.publisherAddress)}</b>
        </div>
      </div>

      {request.simulation.reason ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber/20 bg-amber/10 p-2.5 text-[13px] leading-5 text-amber">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {request.simulation.reason}
        </p>
      ) : null}

      {request.note ? <p className="mt-3 text-[13px] leading-5 text-slate-300">{request.note}</p> : null}

      {pending ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="secondary-button min-h-10 px-3 py-2 text-sm" onClick={onReject} disabled={Boolean(decidingId)}>
            {decidingId === `${request.id}:reject` ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Reject
          </button>
          <button type="button" className="action-button min-h-10 px-3 py-2 text-sm" onClick={onApprove} disabled={Boolean(decidingId) || blocked}>
            {decidingId === `${request.id}:approve` ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Approve
          </button>
        </div>
      ) : null}
    </article>
  );
}

function RequestStatus({status, blocked}: {status: ApprovalRequest["status"]; blocked: boolean}) {
  const label = status === "pending" && blocked ? "Blocked" : status[0].toUpperCase() + status.slice(1);
  const classes = status === "approved"
    ? "border-mint/25 bg-mint/10 text-mint"
    : status === "rejected" || blocked
      ? "border-amber/25 bg-amber/10 text-amber"
      : "border-white/[0.12] bg-white/[0.04] text-slate-300";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>{label}</span>;
}

function MiniMetric({label, value}: {label: string; value: string}) {
  return (
    <div className="surface px-3 py-2.5">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function formatUsdc(value: number) {
  return Number(value || 0).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 6});
}
