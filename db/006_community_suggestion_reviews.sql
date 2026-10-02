-- Reviewing a suggestion is an administrator action. The author's contribution
-- eligibility still applies to creating or editing the suggestion itself, but
-- must not prevent a later status/resolution decision after verification expires.
DROP TRIGGER IF EXISTS reddix_contribution_guard_community_suggestions ON community_suggestions;
CREATE TRIGGER reddix_contribution_guard_community_suggestions
  BEFORE INSERT OR UPDATE OF id,user_id,name,description,city,created_at
  ON community_suggestions
  FOR EACH ROW EXECUTE FUNCTION reddix_guard_contribution();

INSERT INTO schema_migrations(version) VALUES ('006') ON CONFLICT DO NOTHING;
