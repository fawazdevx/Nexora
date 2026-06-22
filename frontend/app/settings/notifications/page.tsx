import {useEffect, useState, type ReactNode} from "react";
import {Bell, CheckCircle2, Loader2, Mail, MessageCircle, Send} from "lucide-react";
import {useAccount} from "wagmi";
import toast from "react-hot-toast";
import {EmptyState} from "@/components/EmptyState";
import {PageHeader} from "@/components/PageHeader";
import {useAppSnapshot} from "@/hooks/useAppSnapshot";
import {apiPost} from "@/lib/api";
import {timeAgo} from "@/lib/time";

type Preferences = NonNullable<ReturnType<typeof useAppSnapshot>["data"]>["notificationPreferences"];

const defaultPreferences = {
  email: "",
  whatsapp: "",
  telegram: "",
  channels: {inApp: true, email: false, whatsapp: false, telegram: false},
  events: {agentActions: true, paymentReceipts: true, policyAlerts: true, escrowUpdates: true}
};

export default function NotificationsSettingsPage() {
  const {address, isConnected} = useAccount();
  const snapshot = useAppSnapshot();
  const preferences = snapshot.data?.notificationPreferences ?? null;
  const deliveries = snapshot.data?.notificationDeliveries ?? [];
  const [form, setForm] = useState(defaultPreferences);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!preferences) return;
    setForm({
      email: preferences.email ?? "",
      whatsapp: preferences.whatsapp ?? "",
      telegram: preferences.telegram ?? "",
      channels: preferences.channels,
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
        whatsapp: form.whatsapp,
        telegram: form.telegram,
        channels: form.channels,
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

  if (!isConnected) {
    return (
      <EmptyState
        icon={<Bell size={26} />}
        title="Connect your wallet"
        copy="Connect an operator wallet to manage agent action alerts and receipt delivery."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Operator alerts"
        title="Notification delivery"
        description="Choose where Nexora sends agent action updates and verified receipts."
        action={
          <button type="button" onClick={save} className="action-button" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Save settings
          </button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <section className="panel space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <ContactField icon={<Mail size={17} />} label="Email" value={form.email} placeholder="you@nexorafi.app" onChange={(email) => setForm((current) => ({...current, email}))} />
            <ContactField icon={<MessageCircle size={17} />} label="WhatsApp" value={form.whatsapp} placeholder="+15551234567" onChange={(whatsapp) => setForm((current) => ({...current, whatsapp}))} />
            <ContactField icon={<Send size={17} />} label="Telegram" value={form.telegram} placeholder="@username or chat id" onChange={(telegram) => setForm((current) => ({...current, telegram}))} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ToggleGroup
              title="Delivery channels"
              items={[
                ["inApp", "In-app"],
                ["email", "Email"],
                ["whatsapp", "WhatsApp"],
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
        </section>

        <section className="panel">
          <h2 className="text-lg font-semibold text-white">Recent deliveries</h2>
          <div className="mt-4 space-y-3">
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
              <p className="rounded-lg border border-white/[0.08] bg-white/[0.035] p-4 text-sm text-slate-400">No outbound deliveries yet. They will appear after an agent action, receipt, policy alert, or escrow update.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ContactField({icon, label, value, placeholder, onChange}: {icon: ReactNode; label: string; value: string; placeholder: string; onChange: (value: string) => void}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">{icon}{label}</span>
      <input className="field w-full" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
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
