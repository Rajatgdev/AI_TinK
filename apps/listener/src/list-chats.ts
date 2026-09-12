import "dotenv/config";
import fs from "node:fs/promises";
import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionFile = process.env.TELEGRAM_SESSION_FILE ?? ".telegram.session";

async function readSession(): Promise<string> {
  try {
    return (await fs.readFile(sessionFile, "utf8")).trim();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function main(): Promise<void> {
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.");
  }

  const session = new StringSession(await readSession());
  const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: () => input.text("Test-account phone number: "),
    password: () => input.text("Two-factor password (if enabled): ", { hideEchoBack: true }),
    phoneCode: () => input.text("Telegram verification code: "),
    onError: (error) => console.error("Telegram login error:", error),
  });
  await fs.writeFile(sessionFile, session.save(), { mode: 0o600 });

  const dialogs = await client.getDialogs({ limit: 100 });
  console.table(dialogs.map((dialog) => ({ id: dialog.id?.toString(), name: dialog.name })));
  await client.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
