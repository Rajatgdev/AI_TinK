import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import pg from "pg";
import { SourceMessageSchema } from "@remember-me/shared";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL in .env before starting the API.");

const port = Number(process.env.PORT ?? 3000);
const pool = new pg.Pool({ connectionString: databaseUrl });
const app = Fastify({ logger: true });

await app.register(cors, { origin: false });

app.get("/health", async () => {
  await pool.query("SELECT 1");
  return { status: "ok" };
});

app.post("/ingest/sources", async (request, reply) => {
  const parsed = SourceMessageSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid source message", details: parsed.error.flatten() });
  }

  const source = parsed.data;
  await pool.query(
    `INSERT INTO source_messages
      (provider, chat_id, message_id, sender_id, sender_name, message_text, sent_at, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider, chat_id, message_id) DO NOTHING`,
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
  return reply.code(201).send({ status: "stored", source: { chatId: source.chatId, messageId: source.messageId } });
});

async function shutdown(): Promise<void> {
  await app.close();
  await pool.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: "127.0.0.1", port });
