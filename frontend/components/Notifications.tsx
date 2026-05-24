import {createContext, useContext, useMemo, useState} from "react";
import {Bell, CheckCircle2, X} from "lucide-react";

type Notification = {
  id: string;
  title: string;
  detail?: string;
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
    }
  }), []);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 grid w-[min(360px,calc(100vw-2rem))] gap-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/[0.1] bg-[#101420]/95 p-4 shadow-neon backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-mint"><CheckCircle2 size={17} /></div>
                <div>
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  {item.detail ? <p className="mt-1 break-all text-xs leading-5 text-slate-400">{item.detail}</p> : null}
                </div>
              </div>
              <button
                type="button"
                className="text-slate-500 transition hover:text-white"
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

export function NotificationsButton({count = 0}: {count?: number}) {
  return (
    <button type="button" className="secondary-button hidden min-h-11 px-4 py-2 text-sm lg:inline-flex">
      <Bell size={16} />
      Activity
      {count > 0 ? <span className="status-pill px-2 py-0.5 text-[11px]">{count}</span> : null}
    </button>
  );
}
