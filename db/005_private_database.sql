-- Reddix authorizes all access in its server. Supabase's browser-facing roles
-- must never access these tables directly, including auth tokens and chat.
-- Run again after auth tables are created, inside their creation transaction.
DO $$
DECLARE
  table_name text;
  table_oid regclass;
  sequence_name regclass;
  client_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'communities', 'community_memberships', 'posts', 'comments',
    'post_votes', 'comment_votes', 'saved_posts', 'blocks', 'events',
    'event_invitations', 'event_rsvps', 'saved_events', 'event_updates',
    'notifications', 'reports', 'community_suggestions', 'audit_events',
    'platform_settings', 'rate_limits', 'idempotency_keys', 'media_assets',
    'feed_snapshots', 'schema_migrations', 'chat_conversations', 'chat_messages',
    'moderation_jobs', 'moderation_decisions', 'moderation_daily_usage',
    'x_bot_state', 'x_invite_requests', 'x_contact_preferences', 'x_outbox',
    'x_bot_usage', 'community_x_accounts', 'community_x_affiliations',
    'member_activity', 'member_visit_sessions',
    'auth_user', 'auth_session', 'auth_account', 'auth_verification',
    'auth_dev_sessions', 'enrollment_invites', 'auth_admission_attempts',
    'auth_admission_passes', 'auth_rate_limits', 'auth_sync_state', 'auth_audit'
  ] LOOP
    table_oid := to_regclass(format('public.%I', table_name));
    IF table_oid IS NULL THEN CONTINUE; END IF;

    -- No client policies and no FORCE: the server's table-owning connection
    -- retains access while browser roles are denied even if grants recur.
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_oid);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC', table_oid);
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I', table_oid, client_role);
      END IF;
    END LOOP;

    -- Restrict only sequences owned by our explicit tables. Leave unrelated
    -- project tables and Supabase's auth/storage schemas untouched.
    FOR sequence_name IN
      SELECT sequence.oid::regclass
      FROM pg_class sequence
      JOIN pg_depend dependency ON dependency.objid = sequence.oid
        AND dependency.classid = 'pg_class'::regclass
        AND dependency.refclassid = 'pg_class'::regclass
      WHERE sequence.relkind = 'S' AND dependency.refobjid = table_oid
        AND dependency.deptype IN ('a', 'i')
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM PUBLIC', sequence_name);
      FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %s FROM %I', sequence_name, client_role);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES ('005') ON CONFLICT DO NOTHING;
