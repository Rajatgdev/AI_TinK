import "dotenv/config";
import fs from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { NewMessage } from "telegram/events/index.js";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { SourceMessageSchema } from "@remember-me/shared";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionFile = process.env.TELEGRAM_SESSION_FILE ?? ".telegram.session";
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

async function main(): Promise<void> {
  requireConfiguration();
  const prompts = createInterface({ input: stdin, output: stdout });
  const session = new StringSession(await readSession());
  const client = new TelegramClient(session, apiId, apiHash!, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: () => prompts.question("Test-account phone number: "),
    // Do not use a shared terminal when entering a two-factor password.
    password: () => prompts.question("Two-factor password (if enabled): "),
    phoneCode: () => prompts.question("Telegram verification code: "),
    onError: (error) => console.error("Telegram login error:", error),
  });
  prompts.close();
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

    // The API persistence call is added in the next milestone. Log structured
    // evidence now so allow-list behavior can be verified without storing data.
    console.log(JSON.stringify(source, null, 2));
  }, new NewMessage({ incoming: true }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
