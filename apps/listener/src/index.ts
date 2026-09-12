import dotenv from "dotenv";
import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import input from "input";
import { NewMessage } from "telegram/events/index.js";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { SourceMessageSchema } from "@remember-me/shared";
import { closePrompt, readLine } from "./prompt.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionFile = resolve(projectRoot, process.env.TELEGRAM_SESSION_FILE ?? "apps/listener/.telegram.session");
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const internalApiToken = process.env.INTERNAL_API_TOKEN;
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
    headers: { "content-type": "application/json", ...(internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {}) },
    body: JSON.stringify(source),
  });
  if (!response.ok) {
    throw new Error(`Source API rejected the message: ${response.status} ${await response.text()}`);
  }
}

async function captureIsPaused(chatId: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/capture-status/${encodeURIComponent(chatId)}`, {
      headers: internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {},
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return ((await response.json()) as { paused: boolean }).paused;
  } catch (error) {
    // A control-state failure must not result in accidental capture.
    console.error("Unable to verify capture control; message was not stored:", error);
    return true;
  }
}

async function main(): Promise<void> {
  requireConfiguration();
  const session = new StringSession(await readSession());
  const client = new TelegramClient(session, apiId, apiHash!, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: () => readLine("Test-account phone number: "),
      password: () => input.text("Two-factor password (if enabled): ", { hideEchoBack: true }),
      phoneCode: () => readLine("Telegram verification code: "),
      onError: (error) => console.error("Telegram login error:", error),
    });
  } finally {
    closePrompt();
  }
  await fs.writeFile(sessionFile, session.save(), { mode: 0o600 });

  console.log(`Listener ready. Monitoring ${allowedChatIds.size} selected test chat(s) only.`);
  client.addEventHandler(async (event) => {
    const message = event.message;
    const chatId = message.chatId?.toString();
    if (!chatId || !allowedChatIds.has(chatId)) return;
    if (!message.message.trim()) return;

    const sender = await message.getSender();
    if (sender && "bot" in sender && sender.bot) {
      console.log(`Ignored bot message in selected chat ${chatId}.`);
      return;
    }
    if (await captureIsPaused(chatId)) {
      console.log(`Capture is paused for selected chat ${chatId}.`);
      return;
    }

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
  }, new NewMessage({}));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
