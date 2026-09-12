CREATE TABLE caregiver_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider_subject TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monitored_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_user_id UUID REFERENCES caregiver_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'telegram'),
  chat_id TEXT NOT NULL,
  chat_label TEXT NOT NULL,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (caregiver_user_id, provider, chat_id)
);

CREATE TABLE source_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider = 'telegram'),
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  message_text TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, chat_id, message_id)
);

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id UUID NOT NULL REFERENCES source_messages(id) ON DELETE RESTRICT,
  summary TEXT NOT NULL,
  people JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_title TEXT,
  occurred_at TIMESTAMPTZ,
  importance TEXT NOT NULL CHECK (importance IN ('low', 'medium', 'high')),
  confidence NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  superseded_by UUID REFERENCES memories(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
