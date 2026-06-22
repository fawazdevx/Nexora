import {config} from "./config.js";
import {preferencesForOperator, readStore, recordNotificationDeliveries, type NotificationDeliveryRecord, type NotificationPreferencesRecord, type NotificationRecord} from "./store.js";

type DeliveryEvent = "agentActions" | "paymentReceipts" | "policyAlerts" | "escrowUpdates";

type DispatchInput = {
  notification: NotificationRecord;
  event: DeliveryEvent;
  receiptId?: string | null;
};

type DeliveryDraft = Omit<NotificationDeliveryRecord, "id" | "createdAt">;

export async function dispatchNotification(input: DispatchInput) {
  if (!input.notification.operatorAddress) return [];
  const store = await readStore();
  const preferences = preferencesForOperator(store, input.notification.operatorAddress);
  if (!preferences.events[input.event]) return [];

  const drafts = await Promise.all(enabledTargets(preferences).map(async (target) => {
    const message = notificationMessage(input.notification, input.receiptId);
    try {
      const result = await sendChannelMessage(target.channel, target.target, message);
      return {
        notificationId: input.notification.id,
        operatorAddress: preferences.operatorAddress,
        channel: target.channel,
        target: target.target,
        status: result.sent ? "sent" as const : "skipped" as const,
        provider: result.provider,
        reason: result.reason ?? null
      };
    } catch (error) {
      return {
        notificationId: input.notification.id,
        operatorAddress: preferences.operatorAddress,
        channel: target.channel,
        target: target.target,
        status: "failed" as const,
        provider: providerForChannel(target.channel),
        reason: error instanceof Error ? error.message : "notification delivery failed"
      };
    }
  }));

  return recordNotificationDeliveries(drafts);
}

function enabledTargets(preferences: NotificationPreferencesRecord): Array<{channel: "email" | "whatsapp" | "telegram"; target: string}> {
  const targets: Array<{channel: "email" | "whatsapp" | "telegram"; target: string}> = [];
  if (preferences.channels.email && preferences.email) targets.push({channel: "email", target: preferences.email});
  if (preferences.channels.whatsapp && preferences.whatsapp) targets.push({channel: "whatsapp", target: preferences.whatsapp});
  if (preferences.channels.telegram && preferences.telegram) targets.push({channel: "telegram", target: preferences.telegram});
  return targets;
}

function notificationMessage(notification: NotificationRecord, receiptId?: string | null) {
  const receipt = receiptId ?? notification.receiptId;
  const lines = [
    `Nexora: ${notification.title}`,
    notification.detail ?? "",
    notification.txHash ? `Tx: ${notification.txHash}` : "",
    receipt ? `Receipt: ${receiptUrl(receipt)}` : "",
    notification.actionHref && !receipt ? `Open: ${appUrl(notification.actionHref)}` : ""
  ].filter(Boolean);
  return {
    subject: notification.title,
    text: lines.join("\n")
  };
}

async function sendChannelMessage(channel: "email" | "whatsapp" | "telegram", target: string, message: {subject: string; text: string}) {
  if (channel === "email") return sendEmail(target, message);
  if (channel === "whatsapp") return sendWhatsApp(target, message.text);
  return sendTelegram(target, message.text);
}

async function sendEmail(to: string, message: {subject: string; text: string}) {
  if (!config.notifications.email.resendApiKey || !config.notifications.email.from) {
    return {sent: false, provider: config.notifications.email.provider, reason: "email provider is not configured"};
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.notifications.email.resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: config.notifications.email.from,
      to,
      subject: message.subject,
      text: message.text
    })
  });
  if (!response.ok) throw new Error(`email provider returned ${response.status}`);
  return {sent: true, provider: config.notifications.email.provider};
}

async function sendWhatsApp(to: string, text: string) {
  if (!config.notifications.whatsapp.accountSid || !config.notifications.whatsapp.authToken || !config.notifications.whatsapp.from) {
    return {sent: false, provider: config.notifications.whatsapp.provider, reason: "WhatsApp provider is not configured"};
  }
  const body = new URLSearchParams({
    From: whatsappAddress(config.notifications.whatsapp.from),
    To: whatsappAddress(to),
    Body: text
  });
  const token = Buffer.from(`${config.notifications.whatsapp.accountSid}:${config.notifications.whatsapp.authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.notifications.whatsapp.accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${token}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) throw new Error(`WhatsApp provider returned ${response.status}`);
  return {sent: true, provider: config.notifications.whatsapp.provider};
}

async function sendTelegram(chatId: string, text: string) {
  if (!config.notifications.telegram.botToken) {
    return {sent: false, provider: "telegram", reason: "Telegram bot token is not configured"};
  }
  const response = await fetch(`https://api.telegram.org/bot${config.notifications.telegram.botToken}/sendMessage`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      chat_id: chatId.replace(/^@/, ""),
      text,
      disable_web_page_preview: true
    })
  });
  if (!response.ok) throw new Error(`Telegram provider returned ${response.status}`);
  return {sent: true, provider: "telegram"};
}

function providerForChannel(channel: "email" | "whatsapp" | "telegram") {
  if (channel === "email") return config.notifications.email.provider;
  if (channel === "whatsapp") return config.notifications.whatsapp.provider;
  return "telegram";
}

function receiptUrl(receiptId: string) {
  return appUrl(`/receipts/${encodeURIComponent(receiptId)}`);
}

function appUrl(path: string) {
  const base = config.notifications.publicAppUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

function whatsappAddress(value: string) {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}
