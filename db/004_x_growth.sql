ALTER TABLE posts ADD COLUMN IF NOT EXISTS promote_on_x boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS x_bot_state (
 key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}', lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS x_invite_requests (
 id text PRIMARY KEY, x_id text NOT NULL, handle text NOT NULL,
 source_post_id text NOT NULL UNIQUE, consent_text text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','review','approved','declined','delivered','error','stopped')),
 reason text, profile jsonb, decision jsonb, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), invite_id text,
 reviewed_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS x_invite_pending ON x_invite_requests(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS x_invite_identity ON x_invite_requests(x_id,created_at DESC);
CREATE TABLE IF NOT EXISTS x_contact_preferences (
 x_id text PRIMARY KEY, stopped_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS x_outbox (
 id text PRIMARY KEY, dedupe_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('post','digest','invite_dm')),
 resource_id text, recipient_x_id text, payload jsonb NOT NULL DEFAULT '{}', secret_payload text,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','preview','sending','sent','error','uncertain','canceled')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 remote_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS x_outbox_pending ON x_outbox(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS x_bot_usage (
 day date NOT NULL, kind text NOT NULL, count integer NOT NULL DEFAULT 0, PRIMARY KEY(day,kind)
);
CREATE TABLE IF NOT EXISTS community_x_accounts (
 community_id text PRIMARY KEY REFERENCES communities(id), x_id text NOT NULL,
 handle text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 sync_cursor text, sync_id text, synced_at timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(),
 last_error text, verified_by text REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_x_affiliations (
 community_id text NOT NULL REFERENCES communities(id), x_id text NOT NULL,
 source text NOT NULL CHECK(source = 'x'), sync_id text,
 evidence text NOT NULL, verified_by text REFERENCES users(id),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,x_id)
);
CREATE INDEX IF NOT EXISTS community_x_affiliation_identity ON community_x_affiliations(x_id,expires_at);
CREATE TABLE IF NOT EXISTS member_activity (
 member_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, last_seen_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS member_visit_sessions (
 id text PRIMARY KEY, member_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_visit_sessions_time ON member_visit_sessions(started_at);

-- These tables are server-only, including when deployed to Supabase. No client policies.
ALTER TABLE x_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_invite_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_contact_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE x_bot_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_x_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_x_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_visit_sessions ENABLE ROW LEVEL SECURITY;
INSERT INTO schema_migrations(version) VALUES ('004') ON CONFLICT DO NOTHING;
