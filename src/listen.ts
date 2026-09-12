import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import input from "input";
import {
  isMonitoringPaused,
  saveMemory,
  saveSourceMessage,
} from "./db.js";
import { extractMemory } from "./extract-memory.js";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";
const session = new StringSession(process.env.TELEGRAM_SESSION ?? "");

const monitoredChatIds = new Set(
  (process.env.MONITORED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

if (!apiId || !apiHash) {
  throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env");
}

if (monitoredChatIds.size === 0) {
  throw new Error("Add at least one MONITORED_CHAT_IDS value in .env");
}

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

async function getBotUserId(): Promise<string | undefined> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.warn("No TELEGRAM_BOT_TOKEN: bot messages cannot be filtered.");
    return undefined;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error("Unable to identify the Telegram bot account.");
  }

  return String(data.result.id);
}

await client.start({
  phoneNumber: async () => input.text("Telegram phone number: "),
  password: async () => input.text("Telegram 2FA password, if enabled: "),
  phoneCode: async () => input.text("Telegram login code: "),
  onError: (error) => console.error("Telegram login error:", error),
});

const botUserId = await getBotUserId();

console.log("Connected.");
console.log("Monitoring chat IDs:", [...monitoredChatIds]);
console.log("Ignoring bot sender ID:", botUserId ?? "not configured");

client.addEventHandler(async (event) => {
  const chatId = event.chatId?.toString();

  if (!chatId || !monitoredChatIds.has(chatId)) {
    return;
  }

  const message = event.message;
  const text = message.message?.trim() ?? "";
  const senderId = message.senderId?.toString() ?? null;

  // Prevent the assistant from storing and later repeating its own replies.
  if (botUserId && senderId === botUserId) {
    console.log("IGNORED BOT MESSAGE", { messageId: message.id });
    return;
  }

  if (isMonitoringPaused()) {
    console.log("MONITORING PAUSED — message ignored.", { messageId: message.id });
    return;
  }

  // Ignore bot commands and media-only messages for now.
  if (!text || text.startsWith("/")) {
    return;
  }

  const receivedAt = new Date().toISOString();

  const savedSource = saveSourceMessage({
    chatId,
    messageId: message.id,
    senderId,
    text,
    sentAt: new Date(message.date * 1000).toISOString(),
    receivedAt,
  });

  console.log("SAVED SOURCE MESSAGE", {
    inserted: savedSource.inserted,
    sourceId: savedSource.sourceId.toString(),
    text,
  });

  // Do not call the AI twice for a duplicate Telegram message.
  if (!savedSource.inserted) {
    return;
  }

  try {
    const extracted = await extractMemory({
      text,
      sentAt: new Date(message.date * 1000).toISOString(),
    });

    const savedMemory = saveMemory({
      sourceMessageId: Number(savedSource.sourceId),
      ...extracted,
    });

    console.log("SAVED MEMORY", {
      inserted: savedMemory.inserted,
      memoryId: savedMemory.memoryId.toString(),
      summary: extracted.summary,
      importance: extracted.importance,
      eventTitle: extracted.eventTitle,
      eventTimeText: extracted.eventTimeText,
      needsConfirmation: extracted.needsConfirmation,
    });
  } catch (error) {
    // The original source message remains safely saved even if AI processing fails.
    console.error("MEMORY EXTRACTION FAILED", error);
  }
}, new NewMessage({}));

console.log("Listening for selected-chat messages.");
await new Promise(() => {});
