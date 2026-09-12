import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { Markup, Telegraf } from "telegraf";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in .env before starting the bot.");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const internalApiToken = process.env.INTERNAL_API_TOKEN;
const allowedChatIds = new Set(
  (process.env.TELEGRAM_BOT_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
if (allowedChatIds.size === 0) throw new Error("Set TELEGRAM_BOT_ALLOWED_CHAT_IDS to selected test-chat IDs.");
const caregiverUserIds = new Set(
  (process.env.TELEGRAM_CAREGIVER_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
if (caregiverUserIds.size === 0) throw new Error("Set TELEGRAM_CAREGIVER_USER_IDS to one or more caregiver Telegram user IDs.");

type Memory = {
  id: string;
  summary: string;
  chat_id: string;
  message_id: number;
};

type AgentAnswer = {
  answer: string;
  sources: Array<{ memoryId: string; chatId: string; messageId: number }>;
};

type BriefingMemory = {
  id: string;
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

function isCaregiver(userId: number | undefined): boolean {
  return userId !== undefined && caregiverUserIds.has(String(userId));
}

async function setCaptureState(chatId: number, state: "pause" | "resume"): Promise<boolean> {
  const response = await fetch(`${apiBaseUrl}/controls/${chatId}/${state}`, { method: "POST", headers: internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {} });
  return response.ok;
}

async function getBriefing(): Promise<BriefingMemory[]> {
  const response = await fetch(`${apiBaseUrl}/briefing`, { headers: internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {} });
  if (!response.ok) throw new Error("Briefing API request failed.");
  return ((await response.json()) as { memories: BriefingMemory[] }).memories;
}

function briefingText(memories: BriefingMemory[]): string {
  if (memories.length === 0) return "Good morning. I do not have any high-confidence memories to highlight today.";
  return `Good morning. Here are the memories I found for today:\n${memories.map((memory) => `• ${memory.summary}`).join("\n")}`;
}

function briefingKeyboard(memories: BriefingMemory) {
  return Markup.inlineKeyboard([
    Markup.button.callback("Show original", `source:${memories.chat_id}:${memories.message_id}`),
  ]);
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

  const response = await fetch(`${apiBaseUrl}/agent/answer?q=${encodeURIComponent(question)}`, { headers: internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {} });
  if (!response.ok) {
    await ctx.reply("I could not search saved messages right now.");
    return;
  }
  const body = (await response.json()) as AgentAnswer;
  const source = body.sources[0];
  if (!source) {
    await ctx.reply(body.answer);
    return;
  }

  await ctx.reply(
    body.answer,
    Markup.inlineKeyboard([
      [Markup.button.callback("Show original", `source:${source.chatId}:${source.messageId}`)],
      [Markup.button.callback("Delete memory", `delete:${source.memoryId}`)],
    ]),
  );
});

bot.command("briefing", async (ctx) => {
  try {
    const memories = await getBriefing();
    await ctx.reply(briefingText(memories), memories[0] ? briefingKeyboard(memories[0]) : undefined);
  } catch {
    await ctx.reply("I could not prepare a briefing right now.");
  }
});

bot.command("pause", async (ctx) => {
  if (!isCaregiver(ctx.from?.id)) {
    await ctx.reply("Only the configured caregiver can pause capture.");
    return;
  }
  await ctx.reply((await setCaptureState(ctx.chat.id, "pause")) ? "Capture paused for this chat." : "I could not pause capture right now.");
});

bot.command("resume", async (ctx) => {
  if (!isCaregiver(ctx.from?.id)) {
    await ctx.reply("Only the configured caregiver can resume capture.");
    return;
  }
  await ctx.reply((await setCaptureState(ctx.chat.id, "resume")) ? "Capture resumed for this chat." : "I could not resume capture right now.");
});

bot.action(/^source:([-0-9]+):(\d+)$/, async (ctx) => {
  const [, chatId, messageId] = ctx.match;
  const response = await fetch(`${apiBaseUrl}/sources/${encodeURIComponent(chatId)}/${messageId}`, { headers: internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {} });
  await ctx.answerCbQuery();
  if (!response.ok) {
    await ctx.reply("That original message is no longer available.");
    return;
  }
  const body = (await response.json()) as { source: Source };
  const sender = body.source.sender_name ? `${body.source.sender_name}: ` : "";
  await ctx.reply(`Original message\n${sender}${body.source.message_text}`);
});

bot.action(/^delete:([0-9a-f-]{36})$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isCaregiver(ctx.from?.id)) {
    await ctx.reply("Only the configured caregiver can delete a memory.");
    return;
  }
  const [, memoryId] = ctx.match;
  const response = await fetch(`${apiBaseUrl}/memories/${memoryId}`, { method: "DELETE", headers: internalApiToken ? { authorization: `Bearer ${internalApiToken}` } : {} });
  await ctx.reply(response.ok ? "Memory deleted. Its original source is retained for audit." : "That memory could not be deleted.");
});

const briefingCron = process.env.DAILY_BRIEFING_CRON;
if (briefingCron) {
  const timezone = process.env.DAILY_BRIEFING_TIMEZONE ?? "UTC";
  if (!cron.validate(briefingCron)) throw new Error("DAILY_BRIEFING_CRON is not a valid five-field cron expression.");
  cron.schedule(
    briefingCron,
    async () => {
      try {
        const memories = await getBriefing();
        for (const chatId of allowedChatIds) {
          await bot.telegram.sendMessage(chatId, briefingText(memories), memories[0] ? briefingKeyboard(memories[0]) : undefined);
        }
      } catch (error) {
        console.error("Scheduled briefing failed:", error);
      }
    },
    { timezone },
  );
  console.log(`Daily briefing scheduled with ${briefingCron} in ${timezone}.`);
}

bot.launch().then(() => console.log("Bot is ready in selected test chats only."));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
