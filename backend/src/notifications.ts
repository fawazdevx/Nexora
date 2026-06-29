import {config} from "./config.js";
import {completeTelegramNotificationLink, preferencesForOperator, readStore, recordNotificationDeliveries, type NotificationDeliveryRecord, type NotificationPreferencesRecord, type NotificationRecord} from "./store.js";

type DeliveryEvent = "agentActions" | "paymentReceipts" | "policyAlerts" | "escrowUpdates";

type DispatchInput = {
  notification: NotificationRecord;
  event: DeliveryEvent;
  receiptId?: string | null;
  channels?: Partial<NotificationPreferencesRecord["channels"]>;
};

type DeliveryDraft = Omit<NotificationDeliveryRecord, "id" | "createdAt">;

export async function dispatchNotification(input: DispatchInput) {
  if (!input.notification.operatorAddress) return [];
  const store = await readStore();
  const preferences = preferencesForOperator(store, input.notification.operatorAddress);
  if (!preferences.events[input.event]) return [];

  const drafts = await Promise.all(enabledTargets(preferences, input.channels).map(async (target) => {
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

function enabledTargets(preferences: NotificationPreferencesRecord, channels?: Partial<NotificationPreferencesRecord["channels"]>): Array<{channel: "email" | "whatsapp" | "telegram"; target: string}> {
  const targets: Array<{channel: "email" | "whatsapp" | "telegram"; target: string}> = [];
  const emailEnabled = channels?.email ?? true;
  const whatsappEnabled = channels?.whatsapp ?? true;
  const telegramEnabled = channels?.telegram ?? true;
  if (emailEnabled && preferences.channels.email && preferences.email) targets.push({channel: "email", target: preferences.email});
  if (whatsappEnabled && config.notifications.whatsapp.enabled && preferences.channels.whatsapp && preferences.whatsapp) targets.push({channel: "whatsapp", target: preferences.whatsapp});
  if (telegramEnabled && preferences.channels.telegram && preferences.telegram) targets.push({channel: "telegram", target: preferences.telegram});
  return targets;
}

function notificationMessage(notification: NotificationRecord, receiptId?: string | null) {
  const receipt = receiptId ?? notification.receiptId;
  const lines = [
    `Nexora: ${notification.title}`,
    notification.detail ?? "",
    notification.txHash ? `Tx: ${notification.txHash}` : "",
    receipt ? `Receipt: ${receiptUrl(receipt)}` : "",
    notification.actionHref && notification.actionHref !== receiptPath(receipt) ? `Open: ${appUrl(notification.actionHref)}` : ""
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
  if (!response.ok) throw new Error(`email provider returned ${response.status}: ${await providerErrorDescription(response)}`);
  return {sent: true, provider: config.notifications.email.provider};
}

async function sendWhatsApp(to: string, text: string) {
  if (!config.notifications.whatsapp.enabled) {
    return {sent: false, provider: config.notifications.whatsapp.provider, reason: "WhatsApp notifications are coming soon"};
  }
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
  if (!response.ok) throw new Error(`WhatsApp provider returned ${response.status}: ${await providerErrorDescription(response)}`);
  return {sent: true, provider: config.notifications.whatsapp.provider};
}

async function sendTelegram(chatId: string, text: string) {
  if (!config.notifications.telegram.botToken) {
    return {sent: false, provider: "telegram", reason: "Telegram bot token is not configured"};
  }
  const normalizedChatId = chatId.trim();
  if (!/^-?\d{5,20}$/.test(normalizedChatId)) {
    throw new Error("Telegram requires a numeric chat id. Ask the user to open the bot, send /start, then use getUpdates to find their chat id.");
  }
  const response = await fetch(`https://api.telegram.org/bot${config.notifications.telegram.botToken}/sendMessage`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      chat_id: normalizedChatId,
      text,
      disable_web_page_preview: true
    })
  });
  if (!response.ok) throw new Error(`Telegram provider returned ${response.status}: ${await providerErrorDescription(response)}`);
  return {sent: true, provider: "telegram"};
}

async function providerErrorDescription(response: Response) {
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
    if (typeof body.description === "string") return body.description;
    if (typeof body.errors === "object" && body.errors) return JSON.stringify(body.errors);
    return "unknown provider error";
  } catch {
    return "unknown provider error";
  }
}

function providerForChannel(channel: "email" | "whatsapp" | "telegram") {
  if (channel === "email") return config.notifications.email.provider;
  if (channel === "whatsapp") return config.notifications.whatsapp.provider;
  return "telegram";
}

function receiptUrl(receiptId: string) {
  return appUrl(`/receipts/${encodeURIComponent(receiptId)}`);
}

function receiptPath(receiptId?: string | null) {
  return receiptId ? `/receipts/${encodeURIComponent(receiptId)}` : "";
}

function appUrl(path: string) {
  const configuredBase = config.notifications.publicAppUrl.trim() || "https://nexorafi.app";
  const baseWithProtocol = /^https?:\/\//i.test(configuredBase) ? configuredBase : `https://${configuredBase}`;
  const base = baseWithProtocol.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function whatsappAddress(value: string) {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}

export async function telegramBotStartUrl(code: string) {
  if (!config.notifications.telegram.botToken) {
    throw new Error("Telegram bot token is not configured");
  }
  const bot = await telegramApi<{result?: {username?: string}}>("getMe", {});
  const username = bot.result?.username;
  if (!username) throw new Error("Telegram bot username could not be resolved");
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}

export async function syncTelegramNotificationLink(input: {operatorAddress: string; code: string}) {
  if (!config.notifications.telegram.botToken) {
    throw new Error("Telegram bot token is not configured");
  }
  const current = preferencesForOperator(await readStore(), input.operatorAddress);
  if (current.telegram && current.telegramLink?.code === input.code) return current;
  let updates: {result?: TelegramUpdate[]};
  try {
    updates = await telegramApi<{result?: TelegramUpdate[]}>("getUpdates", {
      allowed_updates: ["message"],
      limit: 100
    });
  } catch (error) {
    if (error instanceof Error && /409|webhook/i.test(error.message)) return current;
    throw error;
  }
  const match = (updates.result ?? []).find((update) => telegramStartCode(update) === input.code);
  const chat = match?.message?.chat;
  if (!chat) return current;
  const preferences = await completeTelegramNotificationLink({
    operatorAddress: input.operatorAddress,
    code: input.code,
    chatId: String(chat.id),
    username: chat.username ?? null
  });
  await sendTelegram(String(chat.id), "Nexora notifications are connected. You will receive enabled receipts and alerts here.").catch(() => undefined);
  return preferences;
}

export async function handleTelegramWebhookUpdate(update: unknown) {
  const parsed = update && typeof update === "object" ? update as TelegramUpdate : null;
  const code = parsed ? telegramStartCode(parsed) : null;
  const chat = parsed?.message?.chat;
  if (!code || !chat) {
    if (parsed?.message?.text?.trim().startsWith("/start") && parsed.message.chat) {
      await sendTelegram(String(parsed.message.chat.id), "Open Nexora notification settings and use Connect Telegram to link this chat.").catch(() => undefined);
    }
    return {linked: false};
  }
  const preferences = await completeTelegramNotificationLink({
    code,
    chatId: String(chat.id),
    username: chat.username ?? null
  });
  await sendTelegram(String(chat.id), "Nexora notifications are connected. You will receive enabled receipts and alerts here.").catch(() => undefined);
  return {linked: true, operatorAddress: preferences.operatorAddress};
}

async function telegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.notifications.telegram.botToken}/${method}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Telegram provider returned ${response.status}: ${await providerErrorDescription(response)}`);
  return await response.json() as T;
}

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: {
      id: number | string;
      username?: string;
    };
  };
};

function telegramStartCode(update: TelegramUpdate) {
  const text = update.message?.text?.trim();
  if (!text?.startsWith("/start")) return null;
  const [, code] = text.split(/\s+/, 2);
  return code && /^[a-zA-Z0-9_-]{12,80}$/.test(code) ? code : null;
}
