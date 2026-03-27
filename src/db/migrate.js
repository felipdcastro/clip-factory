const { pool } = require('./connection');

const schema = `
  CREATE TABLE IF NOT EXISTS jobs (
    id          SERIAL PRIMARY KEY,
    url         TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    title       TEXT,
    duration_seconds INTEGER,
    thumbnail_url TEXT,
    channel_name  TEXT,
    file_path   TEXT,
    estimated_cost_usd DECIMAL(10,4),
    error_message TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS transcriptions (
    id          SERIAL PRIMARY KEY,
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    text        TEXT,
    words       JSONB,
    duration_seconds INTEGER,
    estimated_cost_usd DECIMAL(10,4),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS clip_suggestions (
    id          SERIAL PRIMARY KEY,
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    start_time  DECIMAL(10,3) NOT NULL,
    end_time    DECIMAL(10,3) NOT NULL,
    title       TEXT NOT NULL,
    reason      TEXT,
    type        TEXT NOT NULL CHECK (type IN ('video', 'reel')),
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS clips (
    id          SERIAL PRIMARY KEY,
    suggestion_id INTEGER REFERENCES clip_suggestions(id) ON DELETE SET NULL,
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    file_path   TEXT,
    type        TEXT NOT NULL CHECK (type IN ('video', 'reel')),
    status      TEXT NOT NULL DEFAULT 'cutting' CHECK (status IN ('cutting', 'ready', 'failed')),
    duration_ms INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id              SERIAL PRIMARY KEY,
    clip_id         INTEGER REFERENCES clips(id) ON DELETE SET NULL,
    youtube_video_id TEXT,
    youtube_url     TEXT,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'uploading', 'uploaded', 'scheduled', 'failed')),
    scheduled_at    TIMESTAMPTZ,
    uploaded_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id           SERIAL PRIMARY KEY,
    provider     TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at   TIMESTAMPTZ,
    auth_status  TEXT NOT NULL DEFAULT 'active' CHECK (auth_status IN ('active', 'expired')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const migrations = [
  // Story 5.1: adicionar auth_status à tabela oauth_tokens (idempotente)
  `ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS auth_status TEXT NOT NULL DEFAULT 'active'
   CHECK (auth_status IN ('active', 'expired'))`,

  // Story 5.2: retry_count e failure_reason na tabela uploads
  `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS failure_reason TEXT`,

  // content_type por job (batalha-de-rima, toguro, mbl)
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'mbl'`,

  // Story 5.6: indexes de performance
  // PostgreSQL não cria indexes automaticamente para FKs
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transcriptions_job_id ON transcriptions(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clip_suggestions_job_id ON clip_suggestions(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clip_suggestions_status ON clip_suggestions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_job_id ON clips(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_suggestion_id ON clips(suggestion_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clips_status ON clips(status)`,
  `CREATE INDEX IF NOT EXISTS idx_uploads_clip_id ON uploads(clip_id)`,
  `CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status)`,

  // Story 6.2: adicionar clip_category à tabela clip_suggestions (idempotente)
  `ALTER TABLE clip_suggestions ADD COLUMN IF NOT EXISTS clip_category TEXT`,
];

async function migrate() {
  const client = await pool.connect();
  try {
    require('../utils/logger').info('Running migrations...');
    await client.query(schema);

    for (const migration of migrations) {
      await client.query(migration);
    }

    require('../utils/logger').info('Migrations complete');
  } finally {
    client.release();
  }
}

module.exports = { migrate };
