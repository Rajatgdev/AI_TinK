import { getLatestSourceMessage, saveMemory } from "./db.js";
import { extractMemory } from "./extract-memory.js";

const source = getLatestSourceMessage();

if (!source) {
  throw new Error("No saved Telegram messages found.");
}

console.log("Extracting memory from:", source.text);

const memory = await extractMemory({
  text: source.text,
  sentAt: source.sentAt,
});

const saved = saveMemory({
  sourceMessageId: source.id,
  ...memory,
});

console.log({
  saved: saved.inserted,
  memoryId: saved.memoryId.toString(),
  memory,
});