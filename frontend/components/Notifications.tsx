import {createContext, useContext, useMemo, useState} from "react";
import {createPortal} from "react-dom";
import {AnimatePresence, motion} from "framer-motion";
import toast from "react-hot-toast";
import {
  Activity,
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Store,
  X
} from "lucide-react";
import {arcTestnet} from "@/lib/arc";
import {formatTimestamp, timeAgo} from "@/lib/time";

export type ActivityItem = {
  id: string;
  title: string;
  detail?: string | null;
  kind: string;
  txHash?: string | null;
  createdAt: string;
};

type NotificationContextValue = {
  notify: (input: {title: string; detail?: string; kind?: string}) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const TONES = {
  mint: {icon: "text-mint", dot: "bg-mint", pill: "border-mint/25 bg-mint/10 text-mint"},
  orchid: {icon: "text-orchid", dot: "bg-orchid", pill: "border-orchid/25 bg-orchid/10 text-orchid"},
  plasma: {icon: "text-plasma", dot: "bg-plasma", pill: "border-plasma/25 bg-plasma/10 text-plasma"},
  cyan: {icon: "text-cyan", dot: "bg-cyan", pill: "border-cyan/25 bg-cyan/10 text-cyan"},
  amber: {icon: "text-amber", dot: "bg-amber", pill: "border-amber/25 bg-amber/10 text-amber"},
  slate: {icon: "text-slate-300", dot: "bg-slate-500", pill: "border-white/[0.12] bg-white/[0.04] text-slate-300"}
} as const;

/** Maps an activity `kind` to a recognizable icon + accent so the feed reads at a glance. */
function activityVisual(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("pay") || k.includes("settle")) return {icon: CircleDollarSign, tone: TONES.mint};
  if (k.includes("escrow")) return {icon: BriefcaseBusiness, tone: TONES.orchid};
  if (k.includes("policy")) return {icon: ShieldCheck, tone: TONES.plasma};
  if (k.includes("agent") || k.includes("wallet")) return {icon: Bot, tone: TONES.cyan};
  if (k.includes("earn") || k.includes("save") || k.includes("yield")) return {icon: Sparkles, tone: TONES.mint};
  if (k.includes("swap")) return {icon: ArrowLeftRight, tone: TONES.cyan};
  if (k.includes("service") || k.includes("market") || k.includes("publish")) return {icon: Store, tone: TONES.orchid};
  if (k.includes("reput") || k.includes("builder")) return {icon: BadgeCheck, tone: TONES.amber};
  return {icon: Activity, tone: TONES.slate};
}

function explorerTx(hash: string) {
  return `${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function NotificationsProvider({children}: {children: React.ReactNode}) {
  const value = useMemo<NotificationContextValue>(
    () => ({
      notify(input) {
        // Single toast system (react-hot-toast); icon varies by kind, defaults to success.
        const visual = input.kind ? activityVisual(input.kind) : {icon: CheckCircle2, tone: TONES.mint};
        const Icon = visual.icon;
        toast.custom(
          (t) => (
            <div
              className={`pointer-events-auto flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-white/[0.12] bg-gradient-to-br from-[#101420]/98 to-[#0c0f18]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl ${t.visible ? "animate-slide-up" : "opacity-0"}`}
            >
              <div className={`mt-0.5 ${visual.tone.icon}`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">{input.title}</p>
                {input.detail ? <p className="mt-1 break-words text-xs leading-5 text-slate-400">{input.detail}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                className="text-slate-500 transition-all duration-200 hover:rotate-90 hover:text-white"
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          ),
          {duration: 6000}
        );
      }
    }),
    []
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    return {
      notify() {
        return undefined;
      }
    };
  }
  return context;
}

export function NotificationsButton({items = []}: {items?: ActivityItem[]}) {
  const [open, setOpen] = useState(false);
  const count = items.length;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="secondary-button min-h-11 px-3 py-2 text-sm sm:px-4">
        <Bell size={16} />
        <span className="hidden sm:inline">Activity</span>
        {count > 0 ? (
          <span className="rounded-full bg-plasma/20 px-2 py-0.5 text-[11px] font-semibold text-orchid">{count}</span>
        ) : null}
      </button>

      {createPortal(
        <AnimatePresence>
          {open ? (
            <div className="fixed inset-0 z-[60]">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/55 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-label="Close activity"
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              transition={{duration: 0.2}}
            />
            <motion.aside
              className="absolute right-0 top-0 flex h-full w-[min(420px,100vw)] flex-col border-l border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] p-6 shadow-[0_0_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
              initial={{x: "100%"}}
              animate={{x: 0}}
              exit={{x: "100%"}}
              transition={{type: "spring", stiffness: 320, damping: 34}}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.16em] text-orchid glow-text">Activity</p>
                  <h2 className="mt-1.5 text-xl font-bold text-white">Nexora actions</h2>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="secondary-button min-h-10 px-3 py-2" aria-label="Close activity">
                  <X size={16} />
                </button>
              </div>

              {items.length > 0 ? (
                <ol className="relative mt-6 flex-1 space-y-3 overflow-y-auto border-l border-white/[0.1] pr-1 scrollbar-hide">
                  {items.map((item, index) => {
                    const {icon: Icon, tone} = activityVisual(item.kind);
                    return (
                      <motion.li
                        key={item.id}
                        className="relative pl-6"
                        initial={{opacity: 0, x: 24}}
                        animate={{opacity: 1, x: 0}}
                        transition={{delay: Math.min(index * 0.04, 0.4), duration: 0.3, ease: [0.22, 1, 0.36, 1]}}
                      >
                        <span className={`absolute -left-[7px] top-4 h-3 w-3 rounded-full border-2 border-[#0a0d16] ${tone.dot}`} />
                        <article className="surface p-4">
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 ${tone.icon}`}>
                              <Icon size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-bold text-white">{item.title}</p>
                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${tone.pill}`}>{item.kind}</span>
                              </div>
                              {item.detail ? <p className="mt-2 break-words text-sm leading-6 text-slate-400">{item.detail}</p> : null}
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
                                <span title={formatTimestamp(item.createdAt)}>{timeAgo(item.createdAt)}</span>
                                {item.txHash ? (
                                  <a
                                    href={explorerTx(item.txHash)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-orchid transition-colors hover:text-white"
                                  >
                                    View tx
                                    <ExternalLink size={11} />
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </article>
                      </motion.li>
                    );
                  })}
                </ol>
              ) : (
                <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.04] text-slate-500">
                    <Activity size={24} />
                  </div>
                  <p className="max-w-xs text-sm font-medium leading-6 text-slate-400">
                    No activity yet. Payments, escrow updates, policy saves, and agent wallet creation will appear here.
                  </p>
                </div>
              )}
            </motion.aside>
            </div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
