import {useMemo, useState} from "react";
import {AlertTriangle, BellRing, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, ShieldAlert} from "lucide-react";
import {EmptyState} from "@/components/EmptyState";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {navigateTo} from "@/lib/router";
import {timeAgo} from "@/lib/time";

type Snapshot = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>;
type RiskAlert = Snapshot["riskAlerts"][number];

export function RiskAlertsPanel({
  compact = false,
  onSelectAgent
}: {
  compact?: boolean;
  onSelectAgent?: (agentId: string | null) => void;
} = {}) {
  const snapshot = useAppSnapshot();
  const alerts = snapshot.data?.riskAlerts ?? [];
  const critical = alerts.filter((alert) => alert.severity === "critical").length;
  const warning = alerts.filter((alert) => alert.severity === "warning").length;
  const pendingApprovals = (snapshot.data?.approvalRequests ?? []).filter((request) => request.status === "pending").length;
  const needsAttention = alerts.length + pendingApprovals;

  const [expanded, setExpanded] = useState(!compact || critical > 0);

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [alerts]
  );

  if (compact) {
    return (
      <section className="panel !py-4">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              needsAttention > 0 ? "border-amber/30 bg-amber/10 text-amber" : "border-mint/25 bg-mint/10 text-mint"
            }`}>
              {needsAttention > 0 ? <ShieldAlert size={18} /> : <CheckCircle2 size={18} />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {needsAttention > 0 ? "Needs attention" : "All clear"}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {needsAttention > 0
                  ? `${critical} critical · ${warning} warning · ${pendingApprovals} pending approval${pendingApprovals === 1 ? "" : "s"}`
                  : "No active risk alerts or pending approvals"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {critical > 0 ? <span className="status-pill border-magenta/20 bg-magenta/10 text-magenta">{critical}</span> : null}
            {warning > 0 ? <span className="status-pill border-amber/20 bg-amber/10 text-amber">{warning}</span> : null}
            {expanded ? <ChevronDown size={16} className="text-slate-500" /> : <ChevronRight size={16} className="text-slate-500" />}
          </div>
        </button>

        {expanded ? (
          <div className="mt-4 space-y-3 border-t border-white/[0.08] pt-4">
            {snapshot.isLoading ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {[0, 1].map((item) => <div key={item} className="shimmer h-24 rounded-xl" />)}
              </div>
            ) : sortedAlerts.length === 0 ? (
              <p className="text-sm text-slate-400">
                Policy expiry, spend limits, allowlists, and approval windows look healthy right now.
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {sortedAlerts.map((alert) => (
                  <RiskAlertCard
                    key={alert.id}
                    alert={alert}
                    compact
                    onSelectAgent={onSelectAgent}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="section-kicker flex items-center gap-2"><ShieldAlert size={14} /> Risk alerts</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Policy and payment risk monitor</h2>
          <p className="muted-copy mt-2 max-w-2xl">Live checks for policy expiry, spend limits, missing allowlists, approval windows, and repeated payment blocks.</p>
        </div>
        <div className="flex gap-2">
          <span className="status-pill border-magenta/20 bg-magenta/10 text-magenta">{critical} critical</span>
          <span className="status-pill border-amber/20 bg-amber/10 text-amber">{warning} warning</span>
        </div>
      </div>

      {snapshot.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((item) => <div key={item} className="shimmer h-28 rounded-xl" />)}
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={24} />}
          title="No active risk alerts"
          copy="Your visible agent policies, approvals, and recent payment attempts do not need attention right now."
          className="border-0 bg-transparent p-0 py-8 shadow-none"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sortedAlerts.map((alert) => (
            <RiskAlertCard key={alert.id} alert={alert} onSelectAgent={onSelectAgent} />
          ))}
        </div>
      )}
    </section>
  );
}

function RiskAlertCard({
  alert,
  compact,
  onSelectAgent
}: {
  alert: RiskAlert;
  compact?: boolean;
  onSelectAgent?: (agentId: string | null) => void;
}) {
  const visual = alertVisual(alert.severity);

  function handleReview() {
    if (alert.agentId && onSelectAgent) {
      onSelectAgent(alert.agentId);
      return;
    }
    if (alert.actionHref) navigateTo(alert.actionHref);
    else navigateTo("/settings/policies");
  }

  return (
    <article className={`rounded-xl border p-4 ${visual.card}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${visual.iconBox}`}>
          {alert.severity === "info" ? <BellRing size={17} /> : <AlertTriangle size={17} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${visual.pill}`}>
              {alert.severity}
            </span>
            <span className="text-xs capitalize text-slate-400">{alert.category}</span>
          </div>
          <h3 className={`mt-2 font-semibold text-white ${compact ? "text-sm" : "text-base"}`}>{alert.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{alert.detail}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">{alert.createdAt ? `Detected ${timeAgo(alert.createdAt)}` : "Live check"}</span>
            {alert.actionHref || alert.agentId ? (
              <button type="button" className="secondary-button min-h-9 px-3 py-1.5 text-xs" onClick={handleReview}>
                Review <ExternalLink size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function severityRank(severity: RiskAlert["severity"]) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function alertVisual(severity: RiskAlert["severity"]) {
  if (severity === "critical") {
    return {
      card: "border-magenta/25 bg-magenta/10",
      iconBox: "border-magenta/25 bg-magenta/10 text-magenta",
      pill: "border-magenta/25 bg-magenta/10 text-magenta"
    };
  }
  if (severity === "warning") {
    return {
      card: "border-amber/25 bg-amber/10",
      iconBox: "border-amber/25 bg-amber/10 text-amber",
      pill: "border-amber/25 bg-amber/10 text-amber"
    };
  }
  return {
    card: "border-sky/20 bg-sky/10",
    iconBox: "border-sky/20 bg-sky/10 text-sky",
    pill: "border-sky/20 bg-sky/10 text-sky"
  };
}
