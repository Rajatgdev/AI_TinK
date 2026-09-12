import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_mgvuutxtxschitzufezk",
  runtime: "node-24",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  // Tasks must live in a project-relative directory so local and cloud builds agree.
  dirs: ["trigger"],
});
