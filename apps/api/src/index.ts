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
await pool.query(`
  CREATE TABLE IF NOT EXISTS capture_controls (
    chat_id TEXT PRIMARY KEY,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

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

app.get<{ Querystring: { q?: string } }>("/memories/search", async (request, reply) => {
  const query = request.query.q?.trim();
  if (!query) return reply.code(400).send({ error: "Provide a memory query with ?q=" });

  const ignoredWords = new Set(["what", "did", "say", "about", "the", "a", "an", "is", "was", "to", "for"]);
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((term) => term.length > 1 && !ignoredWords.has(term))
    .slice(0, 6) ?? [];
  if (terms.length === 0) return { memories: [] };

  const matches = terms.map(
    (_term, index) =>
      `(lower(m.summary) LIKE $${index + 1} OR lower(coalesce(m.event_title, '')) LIKE $${index + 1} OR lower(m.people::text) LIKE $${index + 1} OR lower(s.message_text) LIKE $${index + 1})`,
  );
  const result = await pool.query(
    `SELECT m.id, m.summary, m.people, m.event_title, m.occurred_at, m.importance,
            m.confidence, s.chat_id, s.message_id, s.message_text, s.sent_at
       FROM memories m
       JOIN source_messages s ON s.id = m.source_message_id
      WHERE m.deleted_at IS NULL AND (${matches.join(" OR ")})
      ORDER BY m.confidence DESC, m.created_at DESC
      LIMIT 3`,
    terms.map((term) => `%${term}%`),
  );
  return { memories: result.rows };
});

app.get<{ Params: { chatId: string; messageId: string } }>("/sources/:chatId/:messageId", async (request, reply) => {
  const result = await pool.query(
    `SELECT chat_id, message_id, sender_name, message_text, sent_at
       FROM source_messages
      WHERE provider = 'telegram' AND chat_id = $1 AND message_id = $2`,
    [request.params.chatId, request.params.messageId],
  );
  const source = result.rows[0];
  if (!source) return reply.code(404).send({ error: "Source message not found" });
  return { source };
});

app.get<{ Params: { chatId: string } }>("/capture-status/:chatId", async (request) => {
  const result = await pool.query<{ is_paused: boolean }>(
    "SELECT is_paused FROM capture_controls WHERE chat_id = $1",
    [request.params.chatId],
  );
  return { paused: result.rows[0]?.is_paused ?? false };
});

app.post<{ Params: { chatId: string } }>("/controls/:chatId/pause", async (request) => {
  await pool.query(
    `INSERT INTO capture_controls (chat_id, is_paused)
     VALUES ($1, TRUE)
     ON CONFLICT (chat_id) DO UPDATE SET is_paused = TRUE, updated_at = now()`,
    [request.params.chatId],
  );
  return { paused: true };
});

app.post<{ Params: { chatId: string } }>("/controls/:chatId/resume", async (request) => {
  await pool.query(
    `INSERT INTO capture_controls (chat_id, is_paused)
     VALUES ($1, FALSE)
     ON CONFLICT (chat_id) DO UPDATE SET is_paused = FALSE, updated_at = now()`,
    [request.params.chatId],
  );
  return { paused: false };
});

app.delete<{ Params: { id: string } }>("/memories/:id", async (request, reply) => {
  const result = await pool.query(
    "UPDATE memories SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
    [request.params.id],
  );
  if (result.rowCount === 0) return reply.code(404).send({ error: "Memory not found" });
  return { deleted: true, id: request.params.id };
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
