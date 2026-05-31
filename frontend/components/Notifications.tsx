import {createContext, useContext, useMemo, useState} from "react";
import {Bell, CheckCircle2, Clock3, X} from "lucide-react";

type Notification = {
  id: string;
  title: string;
  detail?: string;
  createdAt: string;
};

export type ActivityItem = {
  id: string;
  title: string;
  detail?: string | null;
  kind: string;
  txHash?: string | null;
  createdAt: string;
};

type NotificationContextValue = {
  notify: (input: {title: string; detail?: string}) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationsProvider({children}: {children: React.ReactNode}) {
  const [items, setItems] = useState<Notification[]>([]);
  const value = useMemo(() => ({
    notify(input: {title: string; detail?: string}) {
      const item = {
        id: crypto.randomUUID(),
        title: input.title,
        detail: input.detail,
        createdAt: new Date().toISOString()
      };
      setItems((current) => [item, ...current].slice(0, 8));
      window.setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      }, 6_000);
    }
  }), []);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 grid w-[min(360px,calc(100vw-2rem))] gap-2">
        {items.map((item) => (
          <div key={item.id} className="animate-slide-up rounded-xl border border-white/[0.12] bg-gradient-to-br from-[#101420]/98 to-[#0c0f18]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-mint drop-shadow-[0_0_8px_rgba(110,231,183,0.5)]"><CheckCircle2 size={18} /></div>
                <div>
                  <p className="text-sm font-bold text-white">{item.title}</p>
                  {item.detail ? <p className="mt-1 break-all text-xs leading-5 text-slate-400">{item.detail}</p> : null}
                </div>
              </div>
              <button
                type="button"
                className="text-slate-500 transition-all duration-200 hover:rotate-90 hover:text-white"
                onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
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
      <button type="button" onClick={() => setOpen(true)} className="secondary-button hidden min-h-11 px-4 py-2 text-sm lg:inline-flex">
        <Bell size={16} />
        Activity
        {count > 0 ? <span className="status-pill px-2 py-0.5 text-[11px]">{count}</span> : null}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50">
          <button type="button" className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close activity" />
          <aside className="absolute right-0 top-0 h-full w-[min(420px,100vw)] animate-slide-up border-l border-white/[0.12] bg-gradient-to-b from-[#0c101b] to-[#0a0d16] p-6 shadow-[0_0_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-orchid glow-text">Activity</p>
                <h2 className="mt-1.5 text-xl font-bold text-white">Nexora actions</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="secondary-button min-h-10 px-3 py-2" aria-label="Close activity">
                <X size={16} />
              </button>
            </div>
            <div className="mt-6 grid gap-3 overflow-y-auto pr-1">
              {items.map((item) => (
                <article key={item.id} className="surface p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-mint drop-shadow-[0_0_8px_rgba(110,231,183,0.4)]"><Clock3 size={16} /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-white">{item.title}</p>
                        <span className="status-pill px-2 py-0.5 text-[11px]">{item.kind}</span>
                      </div>
                      {item.detail ? <p className="mt-2 break-words text-sm leading-6 text-slate-400">{item.detail}</p> : null}
                      <p className="mt-2 text-xs font-medium text-slate-500">{formatActivityTime(item.createdAt)}</p>
                    </div>
                  </div>
                </article>
              ))}
              {items.length === 0 ? (
                <p className="surface p-4 text-sm font-medium text-slate-400">No activity yet. Actions such as payments, escrow updates, policy saves, and agent wallet creation will appear here.</p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
}
