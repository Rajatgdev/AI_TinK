import dotenv from "dotenv";
import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import input from "input";
import { NewMessage } from "telegram/events/index.js";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { SourceMessageSchema } from "@remember-me/shared";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionFile = process.env.TELEGRAM_SESSION_FILE ?? ".telegram.session";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const allowedChatIds = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

function requireConfiguration(): void {
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env before starting the listener.");
  }
  if (allowedChatIds.size === 0) {
    throw new Error("Set TELEGRAM_ALLOWED_CHAT_IDS to one or more selected test-chat IDs.");
  }
}

async function readSession(): Promise<string> {
  try {
    return (await fs.readFile(sessionFile, "utf8")).trim();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function persistSource(source: unknown): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/ingest/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(source),
  });
  if (!response.ok) {
    throw new Error(`Source API rejected the message: ${response.status} ${await response.text()}`);
  }
}

async function main(): Promise<void> {
  requireConfiguration();
  const session = new StringSession(await readSession());
  const client = new TelegramClient(session, apiId, apiHash!, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => input.text("Test-account phone number: "),
    password: () => input.text("Two-factor password (if enabled): ", { hideEchoBack: true }),
    phoneCode: () => input.text("Telegram verification code: "),
    onError: (error) => console.error("Telegram login error:", error),
  });
  await fs.writeFile(sessionFile, session.save(), { mode: 0o600 });

  console.log(`Listener ready. Monitoring ${allowedChatIds.size} selected test chat(s) only.`);
  client.addEventHandler(async (event) => {
    const message = event.message;
    const chatId = message.chatId?.toString();
    if (!chatId || !allowedChatIds.has(chatId)) return;
    if (!message.message.trim()) return;

    const source = SourceMessageSchema.parse({
      provider: "telegram",
      chatId,
      messageId: message.id,
      senderId: message.senderId?.toString() ?? null,
      senderName: null,
      messageText: message.message,
      sentAt: new Date(message.date * 1000).toISOString(),
      capturedAt: new Date().toISOString(),
    });

    try {
      await persistSource(source);
      console.log(`Saved source ${source.chatId}/${source.messageId}.`);
    } catch (error) {
      // Never silently claim capture succeeded if the source is not durable.
      console.error("Source was not saved:", error);
    }
  }, new NewMessage({ incoming: true }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
