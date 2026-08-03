import {useEffect, useState, type ReactNode} from "react";
import {Activity, ArrowLeftRight, BadgeCheck, Bell, Bot, BriefcaseBusiness, CheckCircle2, CircleDollarSign, ExternalLink, Loader2, Mail, MessageCircle, RefreshCw, Send, ShieldCheck, Sparkles, Store, Unlink} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {EmptyState} from "@/components/EmptyState";
import {PageHeader} from "@/components/PageHeader";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {apiPost} from "@/lib/api";
import {arcTestnet} from "@/lib/arc";
import {formatTimestamp, timeAgo} from "@/lib/time";

type NotificationRecord = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["notifications"][number];
type Preferences = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["notificationPreferences"];

const whatsAppAvailable = import.meta.env.VITE_NEXORA_WHATSAPP_ENABLED === "true";

const defaultPreferences = {
  email: "",
  whatsapp: "",
  telegram: "",
  channels: {inApp: true, email: false, whatsapp: false, telegram: false},
  events: {agentActions: true, paymentReceipts: true, policyAlerts: true, escrowUpdates: true}
};

const TONES = {
  mint: {icon: "text-mint", dot: "bg-mint", pill: "border-mint/25 bg-mint/10 text-mint"},
  orchid: {icon: "text-orchid", dot: "bg-orchid", pill: "border-orchid/25 bg-orchid/10 text-orchid"},
  plasma: {icon: "text-plasma", dot: "bg-plasma", pill: "border-plasma/25 bg-plasma/10 text-plasma"},
  cyan: {icon: "text-cyan", dot: "bg-cyan", pill: "border-cyan/25 bg-cyan/10 text-cyan"},
  amber: {icon: "text-amber", dot: "bg-amber", pill: "border-amber/25 bg-amber/10 text-amber"},
  slate: {icon: "text-slate-300", dot: "bg-slate-500", pill: "border-white/[0.12] bg-white/[0.04] text-slate-300"}
} as const;

function notificationVisual(kind: string) {
  const value = kind.toLowerCase();
  if (value.includes("pay") || value.includes("settle")) return {icon: CircleDollarSign, tone: TONES.mint};
  if (value.includes("escrow")) return {icon: BriefcaseBusiness, tone: TONES.orchid};
  if (value.includes("policy")) return {icon: ShieldCheck, tone: TONES.plasma};
  if (value.includes("agent") || value.includes("wallet")) return {icon: Bot, tone: TONES.cyan};
  if (value.includes("earn") || value.includes("save") || value.includes("yield")) return {icon: Sparkles, tone: TONES.mint};
  if (value.includes("swap")) return {icon: ArrowLeftRight, tone: TONES.cyan};
  if (value.includes("service") || value.includes("market") || value.includes("publish")) return {icon: Store, tone: TONES.orchid};
  if (value.includes("reput") || value.includes("builder")) return {icon: BadgeCheck, tone: TONES.amber};
  return {icon: Activity, tone: TONES.slate};
}

function explorerTx(hash: string) {
  return `${arcTestnet.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

function activityHref(item: NotificationRecord) {
  if (item.actionHref) return item.actionHref;
  if (item.receiptId) return `/receipts/${encodeURIComponent(item.receiptId)}`;
  return null;
}

export default function NotificationsPage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const preferences = snapshot.data?.notificationPreferences ?? null;
  const notifications = [...(snapshot.data?.notifications ?? [])].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
  const deliveries = snapshot.data?.notificationDeliveries ?? [];
  const [form, setForm] = useState(defaultPreferences);
  const [saving, setSaving] = useState(false);
  const [telegramLink, setTelegramLink] = useState<{code: string; startUrl: string; expiresAt: string} | null>(null);
  const [linkingTelegram, setLinkingTelegram] = useState(false);
  const [confirmingTelegram, setConfirmingTelegram] = useState(false);
  const payments = notifications.filter((item) => /pay|settle/i.test(item.kind)).length;
  const controls = notifications.filter((item) => /policy|approval|cooldown/i.test(`${item.kind} ${item.title}`)).length;

  useEffect(() => {
    if (!preferences) return;
    setForm({
      email: preferences.email ?? "",
      whatsapp: preferences.whatsapp ?? "",
      telegram: preferences.telegram ?? "",
      channels: {...preferences.channels, whatsapp: whatsAppAvailable ? preferences.channels.whatsapp : false},
      events: preferences.events
    });
  }, [preferences]);

  async function save() {
    if (!address) {
      toast.error("Connect your wallet before saving notification settings.");
      return;
    }
    setSaving(true);
    const toastId = toast.loading("Saving notification settings...");
    try {
      await apiPost("/api/notifications/preferences", {
        operatorAddress: address,
        email: form.email,
        whatsapp: whatsAppAvailable ? form.whatsapp : "",
        telegram: form.telegram,
        channels: {...form.channels, whatsapp: whatsAppAvailable ? form.channels.whatsapp : false},
        events: form.events
      });
      await snapshot.refetch();
      toast.success("Notification settings saved.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Notification settings could not be saved", {id: toastId});
    } finally {
      setSaving(false);
    }
  }

  async function startTelegramLink() {
    if (!address) {
      toast.error("Connect your wallet before linking Telegram.");
      return;
    }
    setLinkingTelegram(true);
    const toastId = toast.loading("Creating Telegram link...");
    try {
      const result = await apiPost<{startUrl: string; code: string; expiresAt: string}>("/api/notifications/telegram/link", {
        operatorAddress: address
      });
      setTelegramLink(result);
      window.open(result.startUrl, "_blank", "noopener,noreferrer");
      toast.success("Telegram opened. Send /start in the bot, then confirm here.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Telegram link could not be created", {id: toastId});
    } finally {
      setLinkingTelegram(false);
    }
  }

  async function confirmTelegramLink() {
    if (!address || !telegramLink) return;
    setConfirmingTelegram(true);
    const toastId = toast.loading("Checking Telegram connection...");
    try {
      const result = await apiPost<{connected: boolean; telegram: string | null}>("/api/notifications/telegram/confirm", {
        operatorAddress: address,
        code: telegramLink.code
      });
      if (!result.connected) {
        toast.error("Telegram is not connected yet. Send /start to the bot, then try again.", {id: toastId});
        return;
      }
      setForm((current) => ({...current, telegram: result.telegram ?? "", channels: {...current.channels, telegram: true}}));
      setTelegramLink(null);
      await snapshot.refetch();
      toast.success("Telegram connected.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Telegram connection could not be confirmed", {id: toastId});
    } finally {
      setConfirmingTelegram(false);
    }
  }

  async function disconnectTelegram() {
    if (!address) return;
    const nextChannels = {...form.channels, whatsapp: false, telegram: false};
    setForm((current) => ({...current, telegram: "", channels: {...current.channels, telegram: false}}));
    const toastId = toast.loading("Disconnecting Telegram...");
    try {
      await apiPost("/api/notifications/preferences", {
        operatorAddress: address,
        email: form.email,
        whatsapp: whatsAppAvailable ? form.whatsapp : "",
        telegram: "",
        channels: nextChannels,
        events: form.events
      });
      await snapshot.refetch();
      toast.success("Telegram disconnected.", {id: toastId});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Telegram could not be disconnected", {id: toastId});
    }
  }

  if (!isConnected) {
    return (
      <EmptyState
        icon={<Bell size={26} />}
        title="Connect your wallet"
        copy="Connect an operator wallet to view agent actions, payment receipts, policy alerts, and Save/Earn activity."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Activity center"
        title="Notifications"
        description="Review agent actions, payment receipts, policy decisions, escrow updates, and Save/Earn activity in one place."
        action={
          <button type="button" onClick={() => void snapshot.refetch()} className="secondary-button min-h-10 px-3 py-2" disabled={snapshot.isFetching}>
            <RefreshCw size={16} className={snapshot.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      <section className="panel">
        <details open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
            <span>
              <span className="block text-lg font-semibold text-white">Delivery channels</span>
              <span className="mt-1 block text-sm leading-6 text-slate-400">Bind Telegram or email for external alerts. In-app notifications remain enabled by default.</span>
            </span>
            <span className="secondary-button shrink-0 px-3 py-2 text-sm">Manage</span>
          </summary>

          <div className="mt-5 space-y-5 border-t border-white/[0.08] pt-5">
            <div className="grid gap-3 md:grid-cols-3">
              <ContactField icon={<Mail size={17} />} label="Email" value={form.email} placeholder="you@example.com" onChange={(email) => setForm((current) => ({...current, email}))} />
              {whatsAppAvailable ? (
                <ContactField
                  icon={<MessageCircle size={17} />}
                  label="WhatsApp"
                  value={form.whatsapp}
                  placeholder="+1 555 010 0100"
                  help="Include the country code."
                  onChange={(whatsapp) => setForm((current) => ({...current, whatsapp}))}
                />
              ) : null}
              <TelegramConnectField
                value={form.telegram}
                pending={telegramLink}
                linking={linkingTelegram}
                confirming={confirmingTelegram}
                onStart={startTelegramLink}
                onConfirm={confirmTelegramLink}
                onDisconnect={disconnectTelegram}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ToggleGroup
                title="Delivery channels"
                items={[
                  ["inApp", "In-app"],
                  ["email", "Email"],
                  ...(whatsAppAvailable ? [["whatsapp", "WhatsApp"] as ["inApp" | "email" | "whatsapp" | "telegram", string]] : []),
                  ["telegram", "Telegram"]
                ]}
                values={form.channels}
                onChange={(key, value) => setForm((current) => ({...current, channels: {...current.channels, [key]: value}}))}
              />
              <ToggleGroup
                title="Events"
                items={[
                  ["agentActions", "Agent actions"],
                  ["paymentReceipts", "Payment receipts"],
                  ["policyAlerts", "Policy alerts"],
                  ["escrowUpdates", "Escrow updates"]
                ]}
                values={form.events}
                onChange={(key, value) => setForm((current) => ({...current, events: {...current.events, [key]: value}}))}
              />
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={save} className="action-button" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Save delivery settings
              </button>
            </div>
          </div>
        </details>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total activity" value={notifications.length} icon={<Bell size={17} />} />
        <SummaryCard label="Payment events" value={payments} icon={<CircleDollarSign size={17} />} />
        <SummaryCard label="Policy and approvals" value={controls} icon={<ShieldCheck size={17} />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Recent activity</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">In-app notifications stay available even when external delivery channels are not configured.</p>
            </div>
            <Bell size={19} className="mt-1 text-orchid" />
          </div>

          {notifications.length > 0 ? (
            <ol className="relative mt-6 space-y-3 border-l border-white/[0.1] pl-5">
              {notifications.map((item) => {
                const {icon: Icon, tone} = notificationVisual(item.kind);
                const href = activityHref(item);
                return (
                  <li key={item.id} className="relative">
                    <span className={`absolute -left-[26px] top-4 h-3 w-3 rounded-full border-2 border-[#0a0d16] ${tone.dot}`} />
                    <article className="surface p-4">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${tone.icon}`}>
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-white">{item.title}</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${tone.pill}`}>{item.kind}</span>
                          </div>
                          {item.detail ? <p className="mt-2 break-words text-sm leading-6 text-slate-400">{item.detail}</p> : null}
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
                            <span title={formatTimestamp(item.createdAt)}>{timeAgo(item.createdAt)}</span>
                            {href ? (
                              <a href={href} className="inline-flex items-center gap-1 text-orchid transition-colors hover:text-white">
                                {item.receiptId ? "View receipt" : "View details"}
                                <ExternalLink size={11} />
                              </a>
                            ) : null}
                            {item.txHash ? (
                              <a href={explorerTx(item.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-orchid transition-colors hover:text-white">
                                View transaction
                                <ExternalLink size={11} />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="mt-6 flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-5 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.04] text-slate-500">
                <Activity size={24} />
              </div>
              <p className="max-w-sm text-sm font-medium leading-6 text-slate-400">
                No activity yet. Agent actions, payment receipts, policy alerts, escrow updates, and Save/Earn events will appear here.
              </p>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Delivery status</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">External delivery attempts appear here when configured. In-app activity does not depend on Telegram or email.</p>
            </div>
            <CheckCircle2 size={19} className="mt-1 text-mint" />
          </div>

          <div className="mt-5 space-y-3">
            {deliveries.length > 0 ? deliveries.map((delivery) => (
              <div key={delivery.id} className="surface px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold capitalize text-white">{delivery.channel}</span>
                  <span className={delivery.status === "sent" ? "text-mint" : delivery.status === "failed" ? "text-magenta" : "text-amber"}>{delivery.status}</span>
                </div>
                <p className="mt-1 truncate text-slate-400">{delivery.target}</p>
                <p className="mt-2 text-xs text-slate-500">{delivery.provider} · {timeAgo(delivery.createdAt)}</p>
                {delivery.reason ? <p className="mt-2 text-xs text-amber">{delivery.reason}</p> : null}
              </div>
            )) : (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                <p className="text-sm leading-6 text-slate-400">No external delivery attempts have been recorded. You can still use this in-app notification center without connecting another channel.</p>
              </div>
            )}
          </div>
        </section>
      </div>

    </div>
  );
}

function ContactField({icon, label, value, placeholder, help, onChange}: {icon: ReactNode; label: string; value: string; placeholder: string; help?: string; onChange: (value: string) => void}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">{icon}{label}</span>
      <input className="field w-full" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {help ? <span className="mt-2 block text-xs leading-relaxed text-slate-500">{help}</span> : null}
    </label>
  );
}

function TelegramConnectField({
  value,
  pending,
  linking,
  confirming,
  onStart,
  onConfirm,
  onDisconnect
}: {
  value: string;
  pending: {code: string; startUrl: string; expiresAt: string} | null;
  linking: boolean;
  confirming: boolean;
  onStart: () => void;
  onConfirm: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"><Send size={17} />Telegram</span>
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] p-3">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <span className="min-w-0 truncate text-sm text-slate-300">{value ? `Connected: ${value}` : pending ? "Waiting for /start" : "Not connected"}</span>
          {value ? (
            <button type="button" className="icon-button" onClick={onDisconnect} aria-label="Disconnect Telegram">
              <Unlink size={16} />
            </button>
          ) : (
            <button type="button" className="secondary-button shrink-0" onClick={onStart} disabled={linking}>
              {linking ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Connect
            </button>
          )}
        </div>
        {pending ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="secondary-button" href={pending.startUrl} target="_blank" rel="noreferrer">
              <Send size={15} />
              Open bot
            </a>
            <button type="button" className="secondary-button" onClick={onConfirm} disabled={confirming}>
              {confirming ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Confirm
            </button>
          </div>
        ) : null}
        <span className="mt-2 block text-xs leading-relaxed text-slate-500">Open the Nexora bot and send /start once to bind Telegram.</span>
      </div>
    </div>
  );
}

function ToggleGroup<T extends Record<string, boolean>>({title, items, values, onChange}: {title: string; items: Array<[keyof T & string, string]>; values: T; onChange: (key: keyof T & string, value: boolean) => void}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] p-4">
      <h2 className="font-semibold text-white">{title}</h2>
      <div className="mt-4 grid gap-3">
        {items.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm">
            <span className="font-medium text-slate-300">{label}</span>
            <input type="checkbox" className="h-4 w-4 accent-mint" checked={Boolean(values[key])} onChange={(event) => onChange(key, event.target.checked)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({label, value, icon}: {label: string; value: number; icon: React.ReactNode}) {
  return (
    <div className="panel flex items-center gap-3 py-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-orchid">{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className="mt-1 text-xl font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
