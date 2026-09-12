import dotenv from "dotenv";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SourceMessageSchema } from "@remember-me/shared";
import { extractMemory, extractionIsConfigured } from "./extractor.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL in .env before starting the API.");

const port = Number(process.env.PORT ?? 3000);
const pool = new pg.Pool({ connectionString: databaseUrl });
const app = Fastify({ logger: true });

await app.register(cors, { origin: false });

app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { status: "ok", extractionConfigured: extractionIsConfigured() };
});

app.get("/memories", async () => {
  const result = await pool.query(
    `SELECT m.id, m.summary, m.people, m.event_title, m.occurred_at, m.importance,
            m.confidence, m.verified, s.chat_id, s.message_id, s.message_text, s.sent_at
       FROM memories m
       JOIN source_messages s ON s.id = m.source_message_id
      WHERE m.deleted_at IS NULL
      ORDER BY m.created_at DESC`,
  );
  return { memories: result.rows };
});

app.post("/ingest/sources", async (request, reply) => {
  const parsed = SourceMessageSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid source message", details: parsed.error.flatten() });
  }

  const source = parsed.data;
  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO source_messages
      (provider, chat_id, message_id, sender_id, sender_name, message_text, sent_at, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider, chat_id, message_id) DO NOTHING
     RETURNING id`,
    [
      source.provider,
      source.chatId,
      source.messageId,
      source.senderId,
      source.senderName,
      source.messageText,
      source.sentAt,
      source.capturedAt,
    ],
  );

  const sourceId = insertResult.rows[0]?.id;
  let extractionStatus: "created" | "skipped" | "failed" = "skipped";
  if (sourceId && extractionIsConfigured()) {
    try {
      const memory = await extractMemory(source);
      await pool.query(
        `INSERT INTO memories
          (source_message_id, summary, people, event_title, occurred_at, importance, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sourceId,
          memory.summary,
          JSON.stringify(memory.people),
          memory.event?.title ?? null,
          memory.event?.occurredAt ?? null,
          memory.importance,
          memory.confidence,
        ],
      );
      extractionStatus = "created";
    } catch (error) {
      extractionStatus = "failed";
      request.log.error(error, "Memory extraction failed; source remains stored.");
    }
  }

  return reply.code(201).send({
    status: sourceId ? "stored" : "duplicate",
    extractionStatus,
    source: { chatId: source.chatId, messageId: source.messageId },
  });
});

async function shutdown(): Promise<void> {
  await app.close();
  await pool.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: "127.0.0.1", port });
