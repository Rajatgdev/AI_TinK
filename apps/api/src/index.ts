import dotenv from "dotenv";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg from "pg";
import { MemoryExtractionSchema, SourceMessageSchema } from "@remember-me/shared";
import { answerMemoryQuestion } from "./agent.js";
import { extractMemory, extractionIsConfigured, inferEventDate } from "./extractor.js";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL in .env before starting the API.");

const port = Number(process.env.PORT ?? 3000);
const auth0Domain = process.env.AUTH0_DOMAIN;
const auth0Audience = process.env.AUTH0_AUDIENCE;
const internalApiToken = process.env.INTERNAL_API_TOKEN;
const auth0Jwks = auth0Domain ? createRemoteJWKSet(new URL(`https://${auth0Domain}/.well-known/jwks.json`)) : null;
const pool = new pg.Pool({ connectionString: databaseUrl });
const app = Fastify({ logger: true });

await app.register(cors, { origin: ["http://localhost:5173", "http://127.0.0.1:5173"] });
await pool.query(`
  CREATE TABLE IF NOT EXISTS capture_controls (
    chat_id TEXT PRIMARY KEY,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
// Upgrade existing local databases before any query reads these fields.
await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
await pool.query("ALTER TABLE memories ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ");
await pool.query("ALTER TABLE memories ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded'))");
await pool.query("ALTER TABLE memories ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES memories(id) ON DELETE SET NULL");
const activeEvents = await pool.query<{ id: string; message_text: string; sent_at: string }>(
  `SELECT m.id, s.message_text, s.sent_at
     FROM memories m
     JOIN source_messages s ON s.id = m.source_message_id
    WHERE m.deleted_at IS NULL AND m.completed_at IS NULL AND m.status = 'active'
      AND m.event_title IS NOT NULL`,
);
for (const event of activeEvents.rows) {
  const occurredAt = inferEventDate(event.message_text, event.sent_at);
  if (occurredAt) await pool.query("UPDATE memories SET occurred_at = $1 WHERE id = $2", [occurredAt, event.id]);
}
await pool.query(`
  CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL UNIQUE REFERENCES memories(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    last_notified_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);
await pool.query(`
  UPDATE memories m
     SET completed_at = r.acknowledged_at
    FROM reminders r
   WHERE r.memory_id = m.id
     AND r.acknowledged_at IS NOT NULL
     AND m.completed_at IS NULL
`);
await pool.query(`
  INSERT INTO reminders (memory_id, chat_id)
  SELECT m.id, s.chat_id
    FROM memories m
    JOIN source_messages s ON s.id = m.source_message_id
   WHERE m.deleted_at IS NULL
     AND m.completed_at IS NULL
     AND m.status = 'active'
     AND m.occurred_at IS NOT NULL
  ON CONFLICT (memory_id) DO NOTHING
`);

function tokensMatch(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

async function requireAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    reply.code(401).send({ error: "Authentication is required." });
    return;
  }
  if (internalApiToken && tokensMatch(token, internalApiToken)) return;
  if (!auth0Domain || !auth0Audience || !auth0Jwks) {
    reply.code(503).send({ error: "Auth0 is not configured." });
    return;
  }
  try {
    await jwtVerify(token, auth0Jwks, { issuer: `https://${auth0Domain}/`, audience: auth0Audience });
  } catch {
    reply.code(401).send({ error: "Invalid access token." });
  }
}

app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { status: "ok", extractionConfigured: extractionIsConfigured() };
});

app.get("/memories", { preHandler: requireAccess }, async () => {
  const result = await pool.query(
    `SELECT m.id, m.summary, m.people, m.event_title, m.occurred_at, m.importance,
            m.confidence, m.verified, s.chat_id, s.message_id, s.message_text, s.sent_at
       FROM memories m
       JOIN source_messages s ON s.id = m.source_message_id
      WHERE m.deleted_at IS NULL
        AND m.completed_at IS NULL
        AND m.status = 'active'
      ORDER BY m.created_at DESC`,
  );
  return { memories: result.rows };
});

app.get("/briefing", { preHandler: requireAccess }, async () => {
  const result = await pool.query(
    `SELECT m.id, m.summary, m.event_title, m.occurred_at, m.importance, m.confidence,
            s.chat_id, s.message_id
       FROM memories m
       JOIN source_messages s ON s.id = m.source_message_id
      WHERE m.deleted_at IS NULL
        AND m.completed_at IS NULL
        AND m.status = 'active'
        AND m.confidence >= 0.70
        AND m.importance IN ('medium', 'high')
        AND (m.occurred_at IS NULL OR m.occurred_at >= now() - INTERVAL '1 day')
      ORDER BY m.occurred_at ASC NULLS LAST, m.confidence DESC, m.created_at DESC
      LIMIT 3`,
  );
  return { memories: result.rows };
});

app.get<{ Querystring: { q?: string } }>("/memories/search", { preHandler: requireAccess }, async (request, reply) => {
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
      WHERE m.deleted_at IS NULL
        AND m.completed_at IS NULL
        AND m.status = 'active'
        AND (${matches.join(" OR ")})
      ORDER BY m.confidence DESC, m.created_at DESC
      LIMIT 3`,
    terms.map((term) => `%${term}%`),
  );
  return { memories: result.rows };
});

app.get<{ Querystring: { q?: string } }>("/agent/answer", { preHandler: requireAccess }, async (request, reply) => {
  const question = request.query.q?.trim();
  if (!question) return reply.code(400).send({ error: "Provide a question with ?q=" });
  try {
    return await answerMemoryQuestion(pool, question);
  } catch (error) {
    request.log.error(error, "Memory agent failed");
    return reply.code(502).send({ error: "Memory agent could not answer right now." });
  }
});

app.get<{ Params: { chatId: string; messageId: string } }>("/sources/:chatId/:messageId", { preHandler: requireAccess }, async (request, reply) => {
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

app.get<{ Params: { chatId: string } }>("/capture-status/:chatId", { preHandler: requireAccess }, async (request) => {
  const result = await pool.query<{ is_paused: boolean }>(
    "SELECT is_paused FROM capture_controls WHERE chat_id = $1",
    [request.params.chatId],
  );
  return { paused: result.rows[0]?.is_paused ?? false };
});

app.get<{ Querystring: { leadMinutes?: string; repeatMinutes?: string } }>("/reminders/due", { preHandler: requireAccess }, async (request) => {
  const leadMinutes = Math.min(Math.max(Number(request.query.leadMinutes ?? 1440), 1), 10080);
  const repeatMinutes = Math.min(Math.max(Number(request.query.repeatMinutes ?? 30), 1), 1440);
  const result = await pool.query(
    `SELECT r.id, r.chat_id, m.id AS memory_id, m.summary, m.event_title, m.occurred_at,
            s.message_id
       FROM reminders r
       JOIN memories m ON m.id = r.memory_id
       JOIN source_messages s ON s.id = m.source_message_id
      WHERE r.acknowledged_at IS NULL
        AND m.deleted_at IS NULL
        AND m.completed_at IS NULL
        AND m.status = 'active'
        AND m.occurred_at <= now() + ($1::text || ' minutes')::interval
        AND m.occurred_at >= now() - INTERVAL '12 hours'
        AND (r.last_notified_at IS NULL OR r.last_notified_at <= now() - ($2::text || ' minutes')::interval)
      ORDER BY m.occurred_at ASC
      LIMIT 10`,
    [leadMinutes, repeatMinutes],
  );
  return { reminders: result.rows };
});

app.post<{ Params: { id: string } }>("/reminders/:id/notified", { preHandler: requireAccess }, async (request, reply) => {
  const result = await pool.query(
    "UPDATE reminders SET last_notified_at = now() WHERE id = $1 AND acknowledged_at IS NULL RETURNING id",
    [request.params.id],
  );
  if (result.rowCount === 0) return reply.code(404).send({ error: "Reminder not found" });
  return { notified: true };
});

app.post<{ Params: { id: string } }>("/reminders/:id/acknowledge", { preHandler: requireAccess }, async (request, reply) => {
  const result = await pool.query(
    `WITH completed_reminder AS (
       UPDATE reminders
          SET acknowledged_at = now()
        WHERE id = $1 AND acknowledged_at IS NULL
        RETURNING memory_id
     )
     UPDATE memories
        SET completed_at = now()
      WHERE id IN (SELECT memory_id FROM completed_reminder)
      RETURNING id`,
    [request.params.id],
  );
  if (result.rowCount === 0) return reply.code(404).send({ error: "Reminder not found or already completed" });
  return { acknowledged: true };
});

app.post<{ Params: { chatId: string } }>("/controls/:chatId/pause", { preHandler: requireAccess }, async (request) => {
  await pool.query(
    `INSERT INTO capture_controls (chat_id, is_paused)
     VALUES ($1, TRUE)
     ON CONFLICT (chat_id) DO UPDATE SET is_paused = TRUE, updated_at = now()`,
    [request.params.chatId],
  );
  return { paused: true };
});

app.post<{ Params: { chatId: string } }>("/controls/:chatId/resume", { preHandler: requireAccess }, async (request) => {
  await pool.query(
    `INSERT INTO capture_controls (chat_id, is_paused)
     VALUES ($1, FALSE)
     ON CONFLICT (chat_id) DO UPDATE SET is_paused = FALSE, updated_at = now()`,
    [request.params.chatId],
  );
  return { paused: false };
});

app.delete<{ Params: { id: string } }>("/memories/:id", { preHandler: requireAccess }, async (request, reply) => {
  const result = await pool.query(
    "UPDATE memories SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
    [request.params.id],
  );
  if (result.rowCount === 0) return reply.code(404).send({ error: "Memory not found" });
  return { deleted: true, id: request.params.id };
});

app.post("/ingest/sources", { preHandler: requireAccess }, async (request, reply) => {
  const parsed = SourceMessageSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid source message", details: parsed.error.flatten() });
  }

  const testMemoryPayload = (request.body as { testMemory?: unknown }).testMemory;
  const testMemory = process.env.ALLOW_TEST_MEMORY_EXTRACTION === "true" && testMemoryPayload !== undefined
    ? MemoryExtractionSchema.safeParse(testMemoryPayload)
    : null;
  if (testMemory && !testMemory.success) {
    return reply.code(400).send({ error: "Invalid test memory", details: testMemory.error.flatten() });
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
  if (sourceId && (extractionIsConfigured() || testMemory?.success)) {
    try {
      const memory = testMemory?.success ? testMemory.data : await extractMemory(source);
      const memoryInsert = await pool.query<{ id: string }>(
        `INSERT INTO memories
          (source_message_id, summary, people, event_title, occurred_at, importance, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
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
      if (memory.event?.occurredAt && memoryInsert.rows[0]) {
        await pool.query(
          `INSERT INTO reminders (memory_id, chat_id)
           SELECT id, $2 FROM memories WHERE id = $1 AND status = 'active'
           ON CONFLICT (memory_id) DO NOTHING`,
          [memoryInsert.rows[0].id, source.chatId],
        );
      }
      if (memoryInsert.rows[0]) {
        await pool.query(
          `WITH candidate AS (
             SELECT m.id
               FROM memories m
               JOIN source_messages s ON s.id = m.source_message_id
              WHERE m.id <> $1::uuid
                AND s.chat_id = $2::text
                AND m.deleted_at IS NULL
                AND m.status = 'active'
                AND EXISTS (
                  SELECT 1
                    FROM jsonb_array_elements_text(m.people) AS old_person(name)
                    JOIN jsonb_array_elements_text($3::jsonb) AS new_person(name)
                      ON lower(old_person.name) = lower(new_person.name)
                )
                AND (
                  (m.event_title IS NOT NULL AND $4::text IS NOT NULL
                    AND lower(trim(m.event_title)) = lower(trim($4::text)))
                  OR similarity(lower(m.summary), lower($5::text)) >= 0.45
                )
              ORDER BY m.created_at DESC
              LIMIT 1
           )
           UPDATE memories m
              SET status = 'superseded', superseded_by = $1::uuid
             FROM candidate
            WHERE m.id = candidate.id`,
          [memoryInsert.rows[0].id, source.chatId, JSON.stringify(memory.people), memory.event?.title ?? null, memory.summary],
        );
      }
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
