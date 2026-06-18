import {AlertTriangle, BellRing, CheckCircle2, ExternalLink, ShieldAlert} from "lucide-react";
import {EmptyState} from "@/components/EmptyState";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {navigateTo} from "@/lib/router";

type Snapshot = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>;
type RiskAlert = Snapshot["riskAlerts"][number];

export function RiskAlertsPanel() {
  const snapshot = useAppSnapshot();
  const alerts = snapshot.data?.riskAlerts ?? [];
  const critical = alerts.filter((alert) => alert.severity === "critical").length;
  const warning = alerts.filter((alert) => alert.severity === "warning").length;

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
          {alerts.map((alert) => <RiskAlertCard key={alert.id} alert={alert} />)}
        </div>
      )}
    </section>
  );
}

function RiskAlertCard({alert}: {alert: RiskAlert}) {
  const visual = alertVisual(alert.severity);
  return (
    <article className={`rounded-xl border p-4 ${visual.card}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${visual.iconBox}`}>
          {alert.severity === "info" ? <BellRing size={17} /> : <AlertTriangle size={17} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${visual.pill}`}>{alert.severity}</span>
            <span className="text-xs capitalize text-slate-500">{alert.category}</span>
          </div>
          <h3 className="mt-2 font-semibold text-white">{alert.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">{alert.detail}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">Current check</span>
            {alert.actionHref ? (
              <button type="button" className="secondary-button min-h-9 px-3 py-1.5 text-xs" onClick={() => navigateTo(alert.actionHref ?? "/settings/policies")}>
                Review <ExternalLink size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
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
