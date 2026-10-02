CREATE TABLE IF NOT EXISTS chat_conversations (
  id text PRIMARY KEY,
  requester_id text NOT NULL REFERENCES users(id),
  recipient_id text NOT NULL REFERENCES users(id),
  member_low text GENERATED ALWAYS AS (least(requester_id,recipient_id)) STORED,
  member_high text GENERATED ALWAYS AS (greatest(requester_id,recipient_id)) STORED,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','closed')),
  accepted_at timestamptz,
  requester_read_sequence bigint NOT NULL DEFAULT 0 CHECK(requester_read_sequence>=0),
  recipient_read_sequence bigint NOT NULL DEFAULT 0 CHECK(recipient_read_sequence>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(requester_id<>recipient_id),
  UNIQUE(member_low,member_high)
);
CREATE INDEX IF NOT EXISTS chat_requester_idx ON chat_conversations(requester_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_recipient_idx ON chat_conversations(recipient_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  sequence bigserial UNIQUE NOT NULL,
  conversation_id text NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,
  body text NOT NULL CHECK(length(body)<=4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sender_id,client_id)
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(conversation_id,sequence DESC);

-- Use the same pair lock as API mutations. Profile-level blocks also close
-- existing chats, including a request being created concurrently.
CREATE OR REPLACE FUNCTION reddix_close_blocked_chat() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-pair:'||least(NEW.user_id,NEW.blocked_id)||'|'||greatest(NEW.user_id,NEW.blocked_id),0));
  UPDATE chat_conversations SET status='closed',updated_at=now()
    WHERE member_low=least(NEW.user_id,NEW.blocked_id) AND member_high=greatest(NEW.user_id,NEW.blocked_id) AND status<>'closed';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reddix_chat_block ON blocks;
CREATE TRIGGER reddix_chat_block AFTER INSERT OR UPDATE ON blocks FOR EACH ROW EXECUTE FUNCTION reddix_close_blocked_chat();

-- The database boundary protects against stale eligibility and races with
-- account deletion, blocking, request decisions, or a second first message.
CREATE OR REPLACE FUNCTION reddix_guard_chat_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE thread chat_conversations%ROWTYPE; actor users%ROWTYPE; peer users%ROWTYPE; peer_id text;
BEGIN
  SELECT * INTO thread FROM chat_conversations WHERE id=NEW.conversation_id;
  IF NOT FOUND OR NEW.sender_id NOT IN (thread.requester_id,thread.recipient_id) THEN
    RAISE EXCEPTION USING ERRCODE='RX004',MESSAGE='This conversation is unavailable.';
  END IF;
  PERFORM id FROM users WHERE id IN (thread.requester_id,thread.recipient_id) ORDER BY id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-pair:'||thread.member_low||'|'||thread.member_high,0));
  SELECT * INTO thread FROM chat_conversations WHERE id=NEW.conversation_id FOR UPDATE;
  SELECT * INTO actor FROM users WHERE id=NEW.sender_id;
  IF actor.status<>'active' OR actor.admitted_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='RX002',MESSAGE='This account is no longer active.';
  END IF;
  IF actor.onboarding_completed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='RX003',MESSAGE='Complete onboarding before chatting.';
  END IF;
  IF actor.verification_type NOT IN ('blue','business') OR actor.verification_expires_at IS NULL OR actor.verification_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='RX001',MESSAGE='Current blue or business verification is required.';
  END IF;
  peer_id := CASE WHEN NEW.sender_id=thread.requester_id THEN thread.recipient_id ELSE thread.requester_id END;
  SELECT * INTO peer FROM users WHERE id=peer_id;
  IF peer.status<>'active' OR peer.admitted_at IS NULL OR peer.onboarding_completed_at IS NULL
     OR EXISTS(SELECT 1 FROM blocks WHERE (user_id=NEW.sender_id AND blocked_id=peer_id) OR (user_id=peer_id AND blocked_id=NEW.sender_id))
     OR thread.status='closed' THEN
    RAISE EXCEPTION USING ERRCODE='RX004',MESSAGE='This conversation is unavailable.';
  END IF;
  IF thread.status='pending' AND (NEW.sender_id<>thread.requester_id OR EXISTS(SELECT 1 FROM chat_messages WHERE conversation_id=thread.id)) THEN
    RAISE EXCEPTION USING ERRCODE='RX005',MESSAGE='Wait for the message request to be accepted.';
  END IF;
  IF length(btrim(NEW.body))=0 THEN
    RAISE EXCEPTION USING ERRCODE='RX006',MESSAGE='Write a message before sending.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reddix_chat_message_guard ON chat_messages;
CREATE TRIGGER reddix_chat_message_guard BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION reddix_guard_chat_message();

INSERT INTO schema_migrations(version) VALUES('002') ON CONFLICT DO NOTHING;
