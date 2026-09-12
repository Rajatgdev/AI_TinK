import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Markup, Telegraf } from "telegraf";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in .env before starting the bot.");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const allowedChatIds = new Set(
  (process.env.TELEGRAM_BOT_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
if (allowedChatIds.size === 0) throw new Error("Set TELEGRAM_BOT_ALLOWED_CHAT_IDS to selected test-chat IDs.");

type Memory = {
  summary: string;
  chat_id: string;
  message_id: number;
};

type Source = {
  sender_name: string | null;
  message_text: string;
  sent_at: string;
};

function chatIsAllowed(chatId: number): boolean {
  return allowedChatIds.has(String(chatId));
}

const bot = new Telegraf(token);

bot.use(async (ctx, next) => {
  if (!ctx.chat || !chatIsAllowed(ctx.chat.id)) return;
  await next();
});

bot.start((ctx) => ctx.reply("I can help recall saved messages. Try /ask followed by a question."));

bot.command("ask", async (ctx) => {
  const question = ctx.payload.trim();
  if (!question) {
    await ctx.reply("Try: /ask What did Sarah say about Tuesday?");
    return;
  }

  const response = await fetch(`${apiBaseUrl}/memories/search?q=${encodeURIComponent(question)}`);
  if (!response.ok) {
    await ctx.reply("I could not search saved messages right now.");
    return;
  }
  const body = (await response.json()) as { memories: Memory[] };
  const memory = body.memories[0];
  if (!memory) {
    await ctx.reply("I do not know based on the saved messages I found.");
    return;
  }

  await ctx.reply(
    `I found a message that says: ${memory.summary}`,
    Markup.inlineKeyboard([
      Markup.button.callback("Show original", `source:${memory.chat_id}:${memory.message_id}`),
    ]),
  );
});

bot.action(/^source:([-0-9]+):(\d+)$/, async (ctx) => {
  const [, chatId, messageId] = ctx.match;
  const response = await fetch(`${apiBaseUrl}/sources/${encodeURIComponent(chatId)}/${messageId}`);
  await ctx.answerCbQuery();
  if (!response.ok) {
    await ctx.reply("That original message is no longer available.");
    return;
  }
  const body = (await response.json()) as { source: Source };
  const sender = body.source.sender_name ? `${body.source.sender_name}: ` : "";
  await ctx.reply(`Original message\n${sender}${body.source.message_text}`);
});

bot.launch().then(() => console.log("Bot is ready in selected test chats only."));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
