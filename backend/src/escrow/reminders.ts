import {dispatchNotification} from "../notifications.js";
import {
  preferencesForOperator,
  pushNotification,
  updateStore,
  type EscrowRecord,
  type EscrowReminderRunRecord,
  type EscrowReminderSettingsRecord,
  type NotificationRecord,
  type StoreShape
} from "../store.js";

export type EscrowReminderInput = {
  escrowId: string;
  operatorAddress: string;
  enabled?: boolean;
  deadlineAt?: string | null;
  offsetsHours?: number[];
  channels?: Partial<EscrowReminderSettingsRecord["channels"]>;
  muted?: boolean;
  snoozedUntil?: string | null;
};

type ReminderCandidate = {
  escrow: EscrowRecord;
  settings: EscrowReminderSettingsRecord;
  offsetHours: number;
  role: "creator" | "counterparty";
  operatorAddress: string;
  summary: string;
};

export async function updateEscrowReminderSettings(input: EscrowReminderInput) {
  const result = await updateStore((store) => {
    const escrow = ownedEscrow(store, input.escrowId, input.operatorAddress);
    const now = new Date().toISOString();
    const current = escrow.reminder ?? defaultReminderSettings(now);
    const next = normalizeReminderSettings({
      ...current,
      enabled: input.enabled ?? current.enabled,
      deadlineAt: input.deadlineAt === undefined ? current.deadlineAt : input.deadlineAt,
      offsetsHours: input.offsetsHours ?? current.offsetsHours,
      channels: {...current.channels, ...(input.channels ?? {})},
      muted: input.muted ?? current.muted,
      snoozedUntil: input.snoozedUntil === undefined ? current.snoozedUntil : input.snoozedUntil,
      updatedAt: now
    });
    next.nextReminderAt = nextReminderAt(next, new Date());
    escrow.reminder = next;

    const notification = pushNotification(store, {
      operatorAddress: input.operatorAddress,
      title: next.enabled && !next.muted ? "Escrow reminders updated" : "Escrow reminders paused",
      detail: reminderSettingsSummary(escrow, next),
      kind: "escrow",
      receiptId: escrow.id,
      actionHref: `/escrow?escrow=${encodeURIComponent(escrow.id)}`
    });

    return {escrow, notification};
  });
  await dispatchNotification({notification: result.notification, event: "escrowUpdates", receiptId: result.escrow.id}).catch(() => undefined);
  return result.escrow;
}

export async function evaluateEscrowReminders(operatorAddress?: string | null) {
  const now = new Date();
  const result = await updateStore((store) => {
    const candidates = reminderCandidates(store, now, operatorAddress);
    const deliveries: Array<{notification: NotificationRecord; channels: EscrowReminderSettingsRecord["channels"]}> = [];
    const runs: EscrowReminderRunRecord[] = [];

    for (const candidate of candidates) {
      const notificationDraft = {
        operatorAddress: candidate.operatorAddress,
        title: "Escrow deadline reminder",
        detail: candidate.summary,
        kind: "escrow" as const,
        receiptId: candidate.escrow.id,
        actionHref: `/escrow?escrow=${encodeURIComponent(candidate.escrow.id)}`
      };
      const notification = candidate.settings.channels.inApp
        ? pushNotification(store, notificationDraft)
        : {
            id: crypto.randomUUID(),
            createdAt: now.toISOString(),
            ...notificationDraft
          };
      deliveries.push({notification, channels: candidate.settings.channels});
      runs.push({
        id: crypto.randomUUID(),
        escrowId: candidate.escrow.id,
        operatorAddress: candidate.operatorAddress,
        role: candidate.role,
        dueAt: candidate.settings.deadlineAt ?? now.toISOString(),
        offsetHours: candidate.offsetHours,
        status: "sent",
        summary: candidate.summary,
        createdAt: now.toISOString()
      });
      candidate.settings.lastReminderAt = now.toISOString();
      candidate.settings.nextReminderAt = nextReminderAt(candidate.settings, now);
      candidate.settings.updatedAt = now.toISOString();
      candidate.escrow.reminder = candidate.settings;
    }

    if (runs.length > 0) {
      store.escrowReminderRuns.unshift(...runs);
      store.escrowReminderRuns = store.escrowReminderRuns.slice(0, 500);
    }

    return {runs, deliveries};
  });

  for (const delivery of result.deliveries) {
    await dispatchNotification({
      notification: delivery.notification,
      event: "escrowUpdates",
      receiptId: delivery.notification.receiptId,
      channels: delivery.channels
    }).catch(() => undefined);
  }

  return {
    evaluatedAt: new Date().toISOString(),
    runs: result.runs
  };
}

export function defaultReminderSettings(createdAt = new Date().toISOString()): EscrowReminderSettingsRecord {
  return {
    enabled: true,
    deadlineAt: null,
    offsetsHours: [72, 24, 1, 0],
    channels: {
      inApp: true,
      email: true,
      telegram: true,
      whatsapp: false
    },
    muted: false,
    snoozedUntil: null,
    lastReminderAt: null,
    nextReminderAt: null,
    createdAt,
    updatedAt: createdAt
  };
}

function reminderCandidates(store: StoreShape, now: Date, operatorAddress?: string | null): ReminderCandidate[] {
  const operator = operatorAddress?.toLowerCase();
  const candidates: ReminderCandidate[] = [];
  for (const escrow of store.escrows) {
    const settings = escrow.reminder ? normalizeReminderSettings(escrow.reminder) : null;
    if (!settings || !settings.enabled || settings.muted || !settings.deadlineAt) continue;
    if (["released", "cancelled", "disputed"].includes(escrow.status)) continue;
    const snoozedUntil = settings.snoozedUntil ? Date.parse(settings.snoozedUntil) : 0;
    if (snoozedUntil > now.getTime()) continue;
    const dueAt = Date.parse(settings.deadlineAt);
    if (!Number.isFinite(dueAt)) continue;

    const offset = dueOffset(settings, dueAt, now, store.escrowReminderRuns, escrow.id);
    if (offset === null) continue;

    for (const role of ["creator", "counterparty"] as const) {
      const party = role === "creator" ? escrow.creatorAddress : escrow.counterpartyAddress;
      if (operator && party.toLowerCase() !== operator) continue;
      if (!channelAllowed(store, party, settings)) continue;
      if (alreadyReminded(store.escrowReminderRuns, escrow.id, party, offset, settings.deadlineAt)) continue;
      candidates.push({
        escrow,
        settings,
        offsetHours: offset,
        role,
        operatorAddress: party,
        summary: reminderSummary(escrow, role, offset, settings.deadlineAt)
      });
    }
  }
  return candidates;
}

function dueOffset(settings: EscrowReminderSettingsRecord, dueAt: number, now: Date, runs: EscrowReminderRunRecord[], escrowId: string) {
  const elapsed = now.getTime();
  const sorted = [...settings.offsetsHours].sort((a, b) => a - b);
  for (const offset of sorted) {
    const reminderAt = dueAt - offset * 60 * 60 * 1000;
    if (elapsed >= reminderAt && !runs.some((run) => run.escrowId === escrowId && run.offsetHours === offset && run.dueAt === settings.deadlineAt)) return offset;
  }
  return null;
}

function channelAllowed(store: StoreShape, operatorAddress: string, settings: EscrowReminderSettingsRecord) {
  if (settings.channels.inApp) return true;
  const preferences = preferencesForOperator(store, operatorAddress);
  return Boolean(
    settings.channels.email && preferences.channels.email && preferences.email
    || settings.channels.telegram && preferences.channels.telegram && preferences.telegram
    || settings.channels.whatsapp && preferences.channels.whatsapp && preferences.whatsapp
  );
}

function alreadyReminded(runs: EscrowReminderRunRecord[], escrowId: string, operatorAddress: string, offsetHours: number, dueAt: string) {
  return runs.some((run) => (
    run.escrowId === escrowId
    && run.operatorAddress.toLowerCase() === operatorAddress.toLowerCase()
    && run.offsetHours === offsetHours
    && run.dueAt === dueAt
  ));
}

function ownedEscrow(store: StoreShape, escrowId: string, operatorAddress: string) {
  const escrow = store.escrows.find((item) => item.id === escrowId);
  if (!escrow) throw new Error("escrow not found");
  const operator = operatorAddress.toLowerCase();
  if (escrow.creatorAddress.toLowerCase() !== operator && escrow.counterpartyAddress.toLowerCase() !== operator) {
    throw new Error("Only escrow parties can update reminders.");
  }
  return escrow;
}

function normalizeReminderSettings(value: EscrowReminderSettingsRecord): EscrowReminderSettingsRecord {
  const now = new Date().toISOString();
  const offsets = Array.isArray(value.offsetsHours) ? value.offsetsHours : [];
  return {
    enabled: value.enabled !== false,
    deadlineAt: isoDateOrNull(value.deadlineAt),
    offsetsHours: [...new Set(offsets.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 24 * 90))]
      .sort((a, b) => b - a)
      .slice(0, 8),
    channels: {
      inApp: value.channels?.inApp !== false,
      email: Boolean(value.channels?.email),
      telegram: Boolean(value.channels?.telegram),
      whatsapp: Boolean(value.channels?.whatsapp)
    },
    muted: Boolean(value.muted),
    snoozedUntil: isoDateOrNull(value.snoozedUntil),
    lastReminderAt: isoDateOrNull(value.lastReminderAt),
    nextReminderAt: isoDateOrNull(value.nextReminderAt),
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? value.createdAt ?? now
  };
}

function nextReminderAt(settings: EscrowReminderSettingsRecord, now: Date) {
  if (!settings.enabled || settings.muted || !settings.deadlineAt) return null;
  const dueAt = Date.parse(settings.deadlineAt);
  if (!Number.isFinite(dueAt)) return null;
  const candidates = settings.offsetsHours
    .map((offset) => dueAt - offset * 60 * 60 * 1000)
    .filter((timestamp) => timestamp >= now.getTime())
    .sort((a, b) => a - b);
  return candidates[0] ? new Date(candidates[0]).toISOString() : null;
}

function reminderSummary(escrow: EscrowRecord, role: "creator" | "counterparty", offsetHours: number, deadlineAt: string) {
  const due = offsetHours === 0 ? "now" : offsetHours >= 24 ? `in ${Math.round(offsetHours / 24)} day${offsetHours === 24 ? "" : "s"}` : `in ${offsetHours} hour${offsetHours === 1 ? "" : "s"}`;
  return `${escrow.title} is due ${due}. Amount: ${escrow.amountUsdc} USDC. ${nextActionFor(escrow, role)} Deadline: ${new Date(deadlineAt).toLocaleString()}.`;
}

function nextActionFor(escrow: EscrowRecord, role: "creator" | "counterparty") {
  if (escrow.status === "draft" && role === "creator") return "Next action: fund the escrow or extend the deadline.";
  if (escrow.status === "funded" && role === "counterparty") return "Next action: submit delivery proof or request an extension.";
  if (escrow.status === "submitted" && role === "creator") return "Next action: review the deliverable, request changes, verify, or open a dispute.";
  if (escrow.status === "verified" && role === "creator") return "Next action: release payment if the work is accepted.";
  return "Next action: review the escrow status and coordinate with the other party.";
}

function reminderSettingsSummary(escrow: EscrowRecord, settings: EscrowReminderSettingsRecord) {
  if (!settings.enabled || settings.muted) return `${escrow.title} reminders are paused.`;
  if (!settings.deadlineAt) return `${escrow.title} reminders are enabled. Add a deadline to start scheduled alerts.`;
  return `${escrow.title} deadline ${new Date(settings.deadlineAt).toLocaleString()} · reminders ${settings.offsetsHours.map(formatOffset).join(", ")}`;
}

function formatOffset(offset: number) {
  if (offset === 0) return "at deadline";
  if (offset >= 24) return `${Math.round(offset / 24)}d before`;
  return `${offset}h before`;
}

function isoDateOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
