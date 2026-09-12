import Database from "better-sqlite3";
import fs from "node:fs";

fs.mkdirSync("data", { recursive: true });

const db = new Database("data/remember-me.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS source_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_chat_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    telegram_sender_id TEXT,
    text TEXT,
    sent_at TEXT,
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(telegram_chat_id, telegram_message_id)
  );
`);

const sourceMessageColumns = db
  .prepare("PRAGMA table_info(source_messages)")
  .all() as Array<{ name: string }>;

if (!sourceMessageColumns.some((column) => column.name === "telegram_sender_id")) {
  db.exec("ALTER TABLE source_messages ADD COLUMN telegram_sender_id TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_message_id INTEGER NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    people_json TEXT NOT NULL,
    importance TEXT NOT NULL,
    event_title TEXT,
    event_time_text TEXT,
    memory_cue TEXT NOT NULL,
    confidence REAL NOT NULL,
    needs_confirmation INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (source_message_id) REFERENCES source_messages(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function isMonitoringPaused(): boolean {
  const row = db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = 'monitoring_paused'
  `).get() as { value: string } | undefined;

  return row?.value === "true";
}

export function setMonitoringPaused(paused: boolean): void {
  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES ('monitoring_paused', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(paused ? "true" : "false");
}

export type SourceMessage = {
  id: number;
  chatId: string;
  messageId: number;
  senderId: string | null;
  text: string;
  sentAt: string;
  receivedAt: string;
};

export function saveSourceMessage(message: {
  chatId: string;
  messageId: number;
  senderId: string | null;
  text: string;
  sentAt: string;
  receivedAt: string;
}) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO source_messages (
      telegram_chat_id,
      telegram_message_id,
      telegram_sender_id,
      text,
      sent_at,
      received_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    message.chatId,
    message.messageId,
    message.senderId,
    message.text,
    message.sentAt,
    message.receivedAt,
  );

  return {
    inserted: result.changes === 1,
    sourceId: result.lastInsertRowid,
  };
}

export function listSourceMessages() {
  return db.prepare(`
    SELECT
      id,
      telegram_chat_id AS chatId,
      telegram_message_id AS messageId,
      telegram_sender_id AS senderId,
      text,
      sent_at AS sentAt,
      received_at AS receivedAt
    FROM source_messages
    ORDER BY id DESC
  `).all();
}

export function getLatestSourceMessage(): SourceMessage | undefined {
  return db.prepare(`
    SELECT
      id,
      telegram_chat_id AS chatId,
      telegram_message_id AS messageId,
      telegram_sender_id AS senderId,
      text,
      sent_at AS sentAt,
      received_at AS receivedAt
    FROM source_messages
    WHERE text IS NOT NULL
      AND TRIM(text) != ''
      AND text NOT LIKE '/%'
    ORDER BY id DESC
    LIMIT 1
  `).get() as SourceMessage | undefined;
}

export function saveMemory(memory: {
  sourceMessageId: number;
  summary: string;
  people: string[];
  importance: "low" | "medium" | "high";
  eventTitle: string | null;
  eventTimeText: string | null;
  memoryCue: string;
  confidence: number;
  needsConfirmation: boolean;
}) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO memories (
      source_message_id,
      summary,
      people_json,
      importance,
      event_title,
      event_time_text,
      memory_cue,
      confidence,
      needs_confirmation
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memory.sourceMessageId,
    memory.summary,
    JSON.stringify(memory.people),
    memory.importance,
    memory.eventTitle,
    memory.eventTimeText,
    memory.memoryCue,
    memory.confidence,
    memory.needsConfirmation ? 1 : 0,
  );

  return {
    inserted: result.changes === 1,
    memoryId: result.lastInsertRowid,
  };
}
export type MemoryWithSource = {
  id: number;
  summary: string;
  peopleJson: string;
  importance: "low" | "medium" | "high";
  eventTitle: string | null;
  eventTimeText: string | null;
  memoryCue: string;
  confidence: number;
  needsConfirmation: number;
  sourceText: string;
  chatId: string;
  messageId: number;
  sentAt: string;
};

export function listRecentMemories(limit = 20): MemoryWithSource[] {
  return db.prepare(`
    SELECT
      memories.id,
      memories.summary,
      memories.people_json AS peopleJson,
      memories.importance,
      memories.event_title AS eventTitle,
      memories.event_time_text AS eventTimeText,
      memories.memory_cue AS memoryCue,
      memories.confidence,
      memories.needs_confirmation AS needsConfirmation,
      source_messages.text AS sourceText,
      source_messages.telegram_chat_id AS chatId,
      source_messages.telegram_message_id AS messageId,
      source_messages.sent_at AS sentAt
    FROM memories
    JOIN source_messages
      ON source_messages.id = memories.source_message_id
    ORDER BY memories.id DESC
    LIMIT ?
  `).all(limit) as MemoryWithSource[];
}
