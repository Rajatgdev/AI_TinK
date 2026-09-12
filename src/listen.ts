import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import input from "input";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";
const session = new StringSession(process.env.TELEGRAM_SESSION ?? "");

if (!apiId || !apiHash) {
  throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env");
}

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
});

await client.start({
  phoneNumber: async () => input.text("Telegram phone number: "),
  password: async () => input.text("Telegram 2FA password, if enabled: "),
  phoneCode: async () => input.text("Telegram login code: "),
  onError: (error) => console.error("Telegram login error:", error),
});

console.log("Connected to Telegram.");

client.addEventHandler(async (event) => {
  const message = event.message;

  console.log({
    chatId: event.chatId?.toString(),
    messageId: message.id,
    text: message.message,
    receivedAt: new Date().toISOString(),
  });
}, new NewMessage({}));

console.log("Listening for new messages. Leave this terminal running.");
console.log("Save this private session value in .env:");
console.log(client.session.save());

await new Promise(() => {});