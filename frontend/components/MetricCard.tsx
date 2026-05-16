export function MetricCard({label, value, delta}: {label: string; value: string; delta: string}) {
  return (
    <div className="panel relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-white/[0.08]" />
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <strong className="text-3xl font-semibold text-white">{value}</strong>
        <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs text-mint">{delta}</span>
      </div>
    </div>
  );
}
