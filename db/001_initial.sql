CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, x_id text NOT NULL UNIQUE, name text NOT NULL, handle text NOT NULL,
 avatar_url text, bio text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
 followers_count integer NOT NULL DEFAULT 0, following_count integer NOT NULL DEFAULT 0,
 verification_type text NOT NULL DEFAULT 'unknown' CHECK (verification_type IN ('blue','business','government','none','unknown')),
 verification_checked_at timestamptz, verification_expires_at timestamptz,
 is_admin boolean NOT NULL DEFAULT false, admitted_at timestamptz, onboarding_completed_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
 preferences jsonb NOT NULL DEFAULT '{"city":"sf","interests":[],"theme":"system","density":"comfortable","emailNotifications":false,"eventReminders":true,"publicAttendance":false}',
 invite_quota integer NOT NULL DEFAULT 3, invites_issued integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS communities (
 id text PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL,
 icon text NOT NULL DEFAULT 'hash', color text NOT NULL DEFAULT '#e9e9e9', city text,
 rules text NOT NULL DEFAULT 'Be thoughtful. Share useful ideas. Disclose affiliations. Respect people and their privacy.',
 archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_memberships (
 user_id text NOT NULL REFERENCES users(id), community_id text NOT NULL REFERENCES communities(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,community_id)
);
CREATE INDEX IF NOT EXISTS community_memberships_community_idx ON community_memberships(community_id);
CREATE TABLE IF NOT EXISTS posts (
 id text PRIMARY KEY, community_id text NOT NULL REFERENCES communities(id), author_id text NOT NULL REFERENCES users(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300), body text NOT NULL DEFAULT '' CHECK(length(body)<=20000),
 type text NOT NULL DEFAULT 'text' CHECK(type IN ('text','link','image')), url text, image_url text,
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed','deleted')),
 locked boolean NOT NULL DEFAULT false, pinned boolean NOT NULL DEFAULT false, tags jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_feed_idx ON posts(status,created_at DESC,community_id);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts(author_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS posts_search_idx ON posts USING gin(to_tsvector('english',title || ' ' || body));
CREATE TABLE IF NOT EXISTS comments (
 id text PRIMARY KEY, post_id text NOT NULL REFERENCES posts(id), parent_id text REFERENCES comments(id),
 author_id text NOT NULL REFERENCES users(id), body text NOT NULL CHECK(length(body)<=10000),
 depth integer NOT NULL DEFAULT 0 CHECK(depth BETWEEN 0 AND 8),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,post_id), FOREIGN KEY(parent_id,post_id) REFERENCES comments(id,post_id)
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id,parent_id,created_at);
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments(author_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS post_votes (
 user_id text NOT NULL REFERENCES users(id), post_id text NOT NULL REFERENCES posts(id),
 value smallint NOT NULL CHECK(value IN (-1,1)), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,post_id)
);
CREATE INDEX IF NOT EXISTS post_votes_target_idx ON post_votes(post_id);
CREATE TABLE IF NOT EXISTS comment_votes (
 user_id text NOT NULL REFERENCES users(id), comment_id text NOT NULL REFERENCES comments(id),
 value smallint NOT NULL CHECK(value IN (-1,1)), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,comment_id)
);
CREATE INDEX IF NOT EXISTS comment_votes_target_idx ON comment_votes(comment_id);
CREATE TABLE IF NOT EXISTS saved_posts (
 user_id text NOT NULL REFERENCES users(id), post_id text NOT NULL REFERENCES posts(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,post_id)
);
CREATE TABLE IF NOT EXISTS blocks (
 user_id text NOT NULL REFERENCES users(id), blocked_id text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,blocked_id), CHECK(user_id<>blocked_id)
);
CREATE TABLE IF NOT EXISTS events (
 id text PRIMARY KEY, host_id text NOT NULL REFERENCES users(id), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 description text NOT NULL DEFAULT '', source text NOT NULL CHECK(source IN ('native','external')),
 external_url text, source_label text, city text NOT NULL, timezone text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 venue text NOT NULL DEFAULT '', exact_address text, venue_disclosure text NOT NULL DEFAULT 'attendees' CHECK(venue_disclosure IN ('all','attendees','later')),
 format text NOT NULL DEFAULT 'in_person' CHECK(format IN ('in_person','online')),
 visibility text NOT NULL DEFAULT 'listed' CHECK(visibility IN ('listed','unlisted','invited')),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','canceled')),
 capacity integer CHECK(capacity>0), requires_approval boolean NOT NULL DEFAULT false, waitlist_enabled boolean NOT NULL DEFAULT true,
 cover_style text NOT NULL DEFAULT 'grid', community_id text REFERENCES communities(id), tags jsonb NOT NULL DEFAULT '[]',
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source='native' OR (capacity IS NULL AND requires_approval=false)), CHECK(source='native' OR external_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS events_discovery_idx ON events(visibility,status,starts_at,city);
CREATE INDEX IF NOT EXISTS events_host_idx ON events(host_id,starts_at);
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_closed boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS event_invitations (
 event_id text NOT NULL REFERENCES events(id), user_id text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS event_rsvps (
 event_id text NOT NULL REFERENCES events(id), user_id text NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN ('pending_approval','going','waitlisted','declined','canceled','interested')),
 approved boolean NOT NULL DEFAULT false, public_attendance boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS event_rsvp_queue_idx ON event_rsvps(event_id,status,created_at);
CREATE TABLE IF NOT EXISTS saved_events (
 user_id text NOT NULL REFERENCES users(id), event_id text NOT NULL REFERENCES events(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,event_id)
);
CREATE TABLE IF NOT EXISTS event_updates (
 id text PRIMARY KEY, event_id text NOT NULL REFERENCES events(id), author_id text NOT NULL REFERENCES users(id),
 body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), type text NOT NULL, message text NOT NULL,
 resource_id text, dedupe_key text UNIQUE, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS reports (
 id text PRIMARY KEY, reporter_id text NOT NULL REFERENCES users(id), target_type text NOT NULL CHECK(target_type IN ('post','comment','event')),
 target_id text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','actioned')), resolution text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(reporter_id,target_type,target_id)
);
CREATE INDEX IF NOT EXISTS reports_queue_idx ON reports(status,created_at DESC);
CREATE TABLE IF NOT EXISTS community_suggestions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), name text NOT NULL, description text NOT NULL,
 city text, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','declined')),
 resolution text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
 id text PRIMARY KEY, actor_id text REFERENCES users(id), action text NOT NULL, target_id text,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_settings (
 key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 user_id text NOT NULL REFERENCES users(id), key text NOT NULL, action text NOT NULL, request_hash text NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS media_assets (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), storage_key text NOT NULL,
 mime_type text NOT NULL, byte_size integer NOT NULL CHECK(byte_size>0), width integer NOT NULL, height integer NOT NULL,
 alt_text text NOT NULL DEFAULT '', attached_post_id text REFERENCES posts(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS feed_snapshots (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), sort text NOT NULL CHECK(sort IN ('popular','new')),
 scope text NOT NULL, community text, city text, ordered_ids jsonb NOT NULL, as_of timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX IF NOT EXISTS feed_snapshots_expiry_idx ON feed_snapshots(expires_at);
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES('001') ON CONFLICT DO NOTHING;

-- Serialize contribution writes with account deletion and eligibility changes.
-- FK key-share locks alone do not conflict with non-key profile/status updates.
CREATE OR REPLACE FUNCTION reddix_guard_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id text; actor users%ROWTYPE; needs_verification boolean := true;
BEGIN
  IF TG_TABLE_NAME='posts' THEN
    actor_id := NEW.author_id;
    IF NEW.status<>'published' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.status=OLD.status AND (NEW.author_id,NEW.title,NEW.body,NEW.type,NEW.url,NEW.image_url,NEW.community_id,NEW.tags)
      IS NOT DISTINCT FROM (OLD.author_id,OLD.title,OLD.body,OLD.type,OLD.url,OLD.image_url,OLD.community_id,OLD.tags) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='comments' THEN
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

DO $$
DECLARE guarded_table text;
BEGIN
  FOREACH guarded_table IN ARRAY ARRAY['posts','comments','events','event_updates','media_assets','post_votes','comment_votes','event_rsvps','community_suggestions','community_memberships','saved_posts','saved_events','reports','blocks'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='reddix_contribution_guard_'||guarded_table) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reddix_guard_contribution()',
        'reddix_contribution_guard_'||guarded_table,guarded_table);
    END IF;
  END LOOP;
END $$;
