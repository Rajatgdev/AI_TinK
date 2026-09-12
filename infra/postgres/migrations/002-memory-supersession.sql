-- Apply to an existing Remember Me database before running the updated API.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded')),
  ADD COLUMN IF NOT EXISTS superseded_by UUID
    REFERENCES memories(id) ON DELETE SET NULL;
