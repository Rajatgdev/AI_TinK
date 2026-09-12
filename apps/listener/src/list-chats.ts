import dotenv from "dotenv";
import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { closePrompt, readLine } from "./prompt.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionFile = resolve(projectRoot, process.env.TELEGRAM_SESSION_FILE ?? "apps/listener/.telegram.session");

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

  const dialogs = await client.getDialogs({ limit: 100 });
  console.table(dialogs.map((dialog) => ({ id: dialog.id?.toString(), name: dialog.name })));
  await client.disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
