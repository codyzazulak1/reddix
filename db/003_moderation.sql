ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

INSERT INTO users(id,x_id,name,handle,bio,verification_type,is_bot,admitted_at,onboarding_completed_at,invite_quota)
VALUES('system-reddix','system:reddix','Reddix','reddix','The automated Reddix moderator. Reviews community posts and comments, flags uncertain cases for admins, and explains moderation actions.','none',true,now(),now(),0)
ON CONFLICT DO NOTHING;

UPDATE users SET avatar_url='/brand/reddix-logo.png'
WHERE id='system-reddix' AND is_bot=true;

CREATE TABLE IF NOT EXISTS moderation_jobs (
 id text PRIMARY KEY,
 target_type text NOT NULL CHECK(target_type IN ('post','comment')),
 target_id text NOT NULL,
 content_hash text NOT NULL,
 source text NOT NULL CHECK(source IN ('create','edit','report')),
 reported boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','complete','error','superseded')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token text,
 lease_until timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(target_type,target_id,content_hash)
);
CREATE INDEX IF NOT EXISTS moderation_jobs_queue ON moderation_jobs(state,next_attempt_at);
CREATE INDEX IF NOT EXISTS moderation_jobs_target ON moderation_jobs(target_type,target_id);
CREATE TABLE IF NOT EXISTS moderation_decisions (
 id text PRIMARY KEY,
 job_id text NOT NULL UNIQUE REFERENCES moderation_jobs(id) ON DELETE CASCADE,
 target_type text NOT NULL CHECK(target_type IN ('post','comment')),
 target_id text NOT NULL,
 post_id text NOT NULL,
 author_id text NOT NULL REFERENCES users(id),
 content_hash text NOT NULL,
 action text NOT NULL CHECK(action IN ('allow','review','remove')),
 category text NOT NULL,
 confidence double precision NOT NULL CHECK(confidence>=0 AND confidence<=1),
 reason text NOT NULL,
 model text NOT NULL,
 input_tokens integer NOT NULL DEFAULT 0,
 output_tokens integer NOT NULL DEFAULT 0,
 cost_usd numeric(14,8),
 resolution text NOT NULL DEFAULT 'pending' CHECK(resolution IN ('pending','removed','restored','dismissed','superseded')),
 reviewed_by text REFERENCES users(id),
 review_note text,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_decisions_queue ON moderation_decisions(resolution,created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_decisions_author ON moderation_decisions(author_id);
CREATE TABLE IF NOT EXISTS moderation_daily_usage (
 day date PRIMARY KEY,
 requests integer NOT NULL DEFAULT 0,
 input_tokens bigint NOT NULL DEFAULT 0,
 output_tokens bigint NOT NULL DEFAULT 0,
 cost_usd numeric(14,8) NOT NULL DEFAULT 0
);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderation_decision_id text;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS moderation_decision_id text;

INSERT INTO schema_migrations(version) VALUES('003') ON CONFLICT DO NOTHING;

-- Restoring unchanged content is an administrator action, not a new author contribution.
CREATE OR REPLACE FUNCTION reddix_guard_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id text; actor users%ROWTYPE; needs_verification boolean := true;
BEGIN
  IF TG_TABLE_NAME='posts' THEN
    IF TG_OP='UPDATE' AND OLD.status='removed' AND NEW.status='published'
      AND NEW.moderation_decision_id=OLD.moderation_decision_id
      AND (NEW.author_id,NEW.title,NEW.body,NEW.type,NEW.url,NEW.image_url,NEW.community_id,NEW.tags)
        IS NOT DISTINCT FROM (OLD.author_id,OLD.title,OLD.body,OLD.type,OLD.url,OLD.image_url,OLD.community_id,OLD.tags)
      AND EXISTS(SELECT 1 FROM moderation_decisions d JOIN users reviewer ON reviewer.id=d.reviewed_by
        WHERE d.id=OLD.moderation_decision_id AND d.target_type='post' AND d.target_id=OLD.id
        AND d.resolution='restored' AND reviewer.is_admin AND reviewer.status='active')
      THEN needs_verification := false; END IF;
    actor_id := NEW.author_id;
    IF NEW.status<>'published' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.status=OLD.status AND (NEW.author_id,NEW.title,NEW.body,NEW.type,NEW.url,NEW.image_url,NEW.community_id,NEW.tags)
      IS NOT DISTINCT FROM (OLD.author_id,OLD.title,OLD.body,OLD.type,OLD.url,OLD.image_url,OLD.community_id,OLD.tags) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='comments' THEN
    IF TG_OP='UPDATE' AND OLD.status='removed' AND NEW.status='published'
      AND NEW.moderation_decision_id=OLD.moderation_decision_id
      AND (NEW.author_id,NEW.body,NEW.post_id,NEW.parent_id) IS NOT DISTINCT FROM (OLD.author_id,OLD.body,OLD.post_id,OLD.parent_id)
      AND EXISTS(SELECT 1 FROM moderation_decisions d JOIN users reviewer ON reviewer.id=d.reviewed_by
        WHERE d.id=OLD.moderation_decision_id AND d.target_type='comment' AND d.target_id=OLD.id
        AND d.resolution='restored' AND reviewer.is_admin AND reviewer.status='active')
      THEN needs_verification := false; END IF;
    actor_id := NEW.author_id;
    IF NEW.status<>'published' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.status=OLD.status AND (NEW.author_id,NEW.body,NEW.post_id,NEW.parent_id)
      IS NOT DISTINCT FROM (OLD.author_id,OLD.body,OLD.post_id,OLD.parent_id) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='events' THEN
    actor_id := NEW.host_id;
    IF NEW.status<>'published' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.status=OLD.status AND (NEW.host_id,NEW.title,NEW.description,NEW.source,NEW.external_url,NEW.city,NEW.timezone,NEW.starts_at,NEW.ends_at,NEW.venue,NEW.exact_address,NEW.visibility,NEW.capacity)
      IS NOT DISTINCT FROM (OLD.host_id,OLD.title,OLD.description,OLD.source,OLD.external_url,OLD.city,OLD.timezone,OLD.starts_at,OLD.ends_at,OLD.venue,OLD.exact_address,OLD.visibility,OLD.capacity) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='event_updates' THEN
    actor_id := NEW.author_id;
  ELSIF TG_TABLE_NAME='media_assets' THEN
    actor_id := NEW.owner_id;
    IF TG_OP='UPDATE' AND NEW.owner_id=OLD.owner_id THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='reports' THEN
    actor_id := NEW.reporter_id;
    needs_verification := false;
    IF TG_OP='UPDATE' AND NEW.reporter_id=OLD.reporter_id THEN RETURN NEW; END IF;
  ELSE
    actor_id := NEW.user_id;
    IF TG_TABLE_NAME='event_rsvps' THEN
      IF NEW.status IN ('canceled','declined') THEN RETURN NEW; END IF;
      IF TG_OP='UPDATE' AND NEW.status=OLD.status AND NEW.user_id=OLD.user_id THEN RETURN NEW; END IF;
    END IF;
    IF TG_TABLE_NAME IN ('community_memberships','saved_posts','saved_events','blocks') THEN needs_verification := false; END IF;
  END IF;
  SELECT * INTO actor FROM users WHERE id=actor_id FOR SHARE;
  IF NOT FOUND OR actor.status<>'active' OR actor.admitted_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='RX002',MESSAGE='This account can no longer perform this action.';
  END IF;
  IF actor.onboarding_completed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='RX003',MESSAGE='Complete onboarding before participating.';
  END IF;
  IF needs_verification AND (actor.verification_type NOT IN ('blue','business') OR actor.verification_expires_at IS NULL OR actor.verification_expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='RX001',MESSAGE='Current blue or business verification is required.';
  END IF;
  RETURN NEW;
END $$;
