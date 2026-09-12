import "dotenv/config";
import { listRecentMemories } from "./db.js";

export async function sendBriefing() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.DEMO_RECIPIENT_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "Missing TELEGRAM_BOT_TOKEN or DEMO_RECIPIENT_CHAT_ID in .env",
    );
  }

  const memories = listRecentMemories(3);

  if (memories.length === 0) {
    return { sent: false, reason: "No memories available" };
  }

  const items = memories.map((memory) => {
    const timing = memory.eventTimeText
      ? ` — ${memory.eventTimeText}`
      : "";

    return `• ${memory.summary}${timing}`;
  });

  const text = [
    "Good morning.",
    "",
    "Here is your memory briefing:",
    ...items,
    "",
    "You can ask me anything with /ask.",
  ].join("\n");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram send failed: ${await response.text()}`);
  }

  return { sent: true, text };
}