import {useEffect} from "react";
import {animate, motion, useMotionValue, useTransform} from "framer-motion";
import type {LucideIcon} from "lucide-react";

type StatMetricProps = {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  loading?: boolean;
  accent?: boolean;
  icon?: LucideIcon;
  /** "landing" = large hero figure; "panel" = compact card with label + optional icon. */
  variant?: "landing" | "panel";
  /** Number size for the "landing" variant. */
  size?: "md" | "lg" | "xl";
};

const SIZE_CLASS: Record<NonNullable<StatMetricProps["size"]>, string> = {
  md: "text-2xl",
  lg: "text-3xl",
  xl: "text-4xl"
};

/**
 * Animated count-up statistic that eases to its value once data arrives and shows
 * a shimmer skeleton while loading. The numeric part animates; `suffix` (e.g. "/4")
 * stays static so ratios read correctly.
 */
export function StatMetric({
  value,
  label,
  prefix = "",
  suffix = "",
  decimals = 0,
  loading = false,
  accent = false,
  icon: Icon,
  variant = "landing",
  size = "md"
}: StatMetricProps) {
  const count = useMotionValue(0);
  const display = useTransform(
    count,
    (latest) =>
      `${prefix}${latest.toLocaleString("en-US", {minimumFractionDigits: decimals, maximumFractionDigits: decimals})}${suffix}`
  );

  useEffect(() => {
    const controls = animate(count, value, {duration: 1.1, ease: [0.22, 1, 0.36, 1]});
    return controls.stop;
  }, [value, count]);

  if (variant === "panel") {
    return (
      <div className="group rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.06]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          {Icon ? <Icon size={15} className={accent ? "text-mint" : "text-orchid"} /> : null}
        </div>
        {loading ? (
          <div className="shimmer mt-2 h-6 w-16 rounded-md" />
        ) : (
          <motion.p className={`mt-2 text-lg font-bold ${accent ? "text-mint" : "text-white"}`}>{display}</motion.p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 backdrop-blur-sm">
      {loading ? (
        <div className={`shimmer rounded-md ${size === "xl" ? "h-10 w-32" : size === "lg" ? "h-8 w-24" : "h-7 w-20"}`} />
      ) : (
        <motion.p className={`${SIZE_CLASS[size]} font-semibold ${accent ? "text-mint" : "text-white"}`}>{display}</motion.p>
      )}
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}
