export function EmptyState({
  icon,
  title,
  copy,
  action,
  className = ""
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel flex flex-col items-center justify-center gap-3 py-14 text-center ${className}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.04] text-orchid">{icon}</div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="max-w-sm text-sm leading-6 text-slate-400">{copy}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
