import "dotenv/config";
import { Context, Telegraf } from "telegraf";
import {
  isMonitoringPaused,
  listRecentMemories,
  setMonitoringPaused,
} from "./db.js";
import { answerQuestion } from "./answer-question.js";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
}

const bot = new Telegraf(token);

const caregiverChatId =
  process.env.CAREGIVER_TELEGRAM_CHAT_ID ??
  process.env.DEMO_RECIPIENT_CHAT_ID;

function isCaregiver(chatId: number): boolean {
  return Boolean(caregiverChatId) && chatId.toString() === caregiverChatId;
}

async function requireCaregiver(ctx: Context): Promise<boolean> {
  if (ctx.chat && isCaregiver(ctx.chat.id)) {
    return true;
  }

  await ctx.reply("This command is available only to the configured caregiver.");
  return false;
}

bot.start((ctx) => {
  console.log("DEMO_RECIPIENT_CHAT_ID:", ctx.chat.id);

  return ctx.reply(
    [
      "Hello. I can help you recall messages from your selected family chats.",
      "",
      "Try:",
      "/ask What did Sarah say about lunch?",
    ].join("\n"),
  );
});

bot.command("ask", async (ctx) => {
  const question = ctx.message.text
    .replace(/^\/ask(@\w+)?\s*/i, "")
    .trim();

  if (!question) {
    return ctx.reply(
      "Ask me a question after /ask.\n\nExample: /ask What did Sarah say about lunch?",
    );
  }

  try {
    const memories = listRecentMemories(20);

    if (memories.length === 0) {
      return ctx.reply("I do not have any saved memories yet.");
    }

    const result = await answerQuestion(question, memories);

    const sources = result.memoryIds
      .map((id) => memories.find((memory) => memory.id === id))
      .filter(Boolean)
      .map((memory) => {
        const sent = new Date(memory!.sentAt).toLocaleString();
        return `• ${memory!.sourceText} (${sent})`;
      });

    const reply = [
      result.answer,
      result.uncertain
        ? "\nPlease check with your caregiver or the original message if this is important."
        : "",
      sources.length > 0
        ? `\nSources:\n${sources.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return ctx.reply(reply);
  } catch (error) {
    console.error("BOT ANSWER ERROR", error);
    return ctx.reply(
      "I could not look that up just now. Please try again in a moment.",
    );
  }
});

bot.command("pause", async (ctx) => {
  if (!(await requireCaregiver(ctx))) {
    return;
  }

  setMonitoringPaused(true);
  return ctx.reply("Monitoring is paused. New selected-chat messages will not be saved.");
});

bot.command("resume", async (ctx) => {
  if (!(await requireCaregiver(ctx))) {
    return;
  }

  setMonitoringPaused(false);
  return ctx.reply("Monitoring is active again for the selected chats.");
});

bot.command("status", async (ctx) => {
  if (!(await requireCaregiver(ctx))) {
    return;
  }

  const status = isMonitoringPaused() ? "paused" : "active";
  return ctx.reply(`Monitoring is currently ${status}.`);
});

bot.launch();

console.log("Remember Me bot is running.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
