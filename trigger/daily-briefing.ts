import "dotenv/config";
import { logger, schedules } from "@trigger.dev/sdk";
import { sendBriefing } from "../src/send-briefing.js";

export const dailyBriefing = schedules.task({
  id: "daily-briefing",

  cron: {
    pattern: "0 9 * * *",
    timezone: "Europe/Dublin",
  },

  run: async () => {
    const result = await sendBriefing();

    logger.log("Daily briefing finished", result);

    return result;
  },
});