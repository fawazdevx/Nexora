export function MetricCard({label, value, delta}: {label: string; value: string; delta: string}) {
  return (
    <div className="group panel relative overflow-hidden transition-all duration-300 hover:scale-[1.02]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.15] to-transparent" />
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-plasma/[0.08] blur-2xl transition-all duration-500 group-hover:bg-plasma/[0.15]" />
      <p className="relative text-sm font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="relative mt-5 flex items-end justify-between gap-3">
        <strong className="bg-gradient-to-br from-white to-slate-300 bg-clip-text text-5xl font-bold tracking-tight text-transparent">{value}</strong>
        <span className="rounded-full border border-mint/30 bg-gradient-to-br from-mint/15 to-mint/10 px-4 py-2 text-[13px] font-semibold text-mint shadow-[0_0_16px_rgba(110,231,183,0.2)]">{delta}</span>
      </div>
    </div>
  );
}
