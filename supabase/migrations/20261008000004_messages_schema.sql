-- ==============================================================================
-- 20261008000004_messages_schema.sql
-- Anonymous Messaging Platform: Encrypted Messages Schema & Send Procedure
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Table: public.messages
--    Stores end-to-end encrypted ciphertext envelopes.
--    INVARIANTS:
--    - ZERO plaintext: Message content is encrypted client-side via Libsodium sealed box.
--    - Direct SELECT on base table is REVOKED from authenticated users (to protect sender_id).
--    - Recipients only read through security-barrier views in Prompt 008.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id UUID NOT NULL REFERENCES public.public_keys(id) ON DELETE RESTRICT,
  ciphertext TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  deleted_by_recipient BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sender cannot send messages to themselves
  CONSTRAINT sender_recipient_distinct_check CHECK (sender_id <> recipient_id),
  -- Enforce supported protocol version
  CONSTRAINT protocol_version_check CHECK (protocol_version = 1),
  -- Bounded ciphertext: max 32KB Base64 (~24KB binary payload, ample for ~4,000 chars)
  CONSTRAINT ciphertext_size_check CHECK (
    length(trim(ciphertext)) >= 48 AND length(ciphertext) <= 32768
  ),
  -- Enforce valid Base64 character set
  CONSTRAINT ciphertext_format_check CHECK (
    ciphertext ~ '^[A-Za-z0-9+/=]+$'
  )
);

-- ------------------------------------------------------------------------------
-- 2. Indexes
-- ------------------------------------------------------------------------------

-- Index for recipient inbox reads (future Prompt 008)
CREATE INDEX IF NOT EXISTS idx_messages_recipient_inbox
  ON public.messages (recipient_id, created_at DESC)
  WHERE deleted_by_recipient = false;

-- Index for sender sliding-window rate limit checks
CREATE INDEX IF NOT EXISTS idx_messages_sender_rate_limit
  ON public.messages (sender_id, created_at DESC);

-- Index for organization scoping and data auditing
CREATE INDEX IF NOT EXISTS idx_messages_organization_id
  ON public.messages (organization_id);

-- Index for recipient public key tracking
CREATE INDEX IF NOT EXISTS idx_messages_key_id
  ON public.messages (key_id);

-- ------------------------------------------------------------------------------
-- 3. Row Level Security (RLS) & Permissions
-- ------------------------------------------------------------------------------
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- CRITICAL PRIVACY & INTEGRITY BOUNDARIES:
-- Revoke ALL direct table operations (SELECT, INSERT, UPDATE, DELETE) on base messages table
-- from authenticated and anon roles!
-- Message writes are mediated EXCLUSIVELY via SECURITY DEFINER procedure send_anonymous_message.
-- Message reads and state mutations will be mediated via security barrier views / procedures in Prompt 008.
REVOKE ALL ON public.messages FROM anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: send_anonymous_message
--    Validates sender session, checks organization boundary, verifies recipient active key,
--    enforces sliding-window rate limits, and inserts the encrypted envelope atomically.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_anonymous_message(
  p_recipient_id UUID,
  p_key_id UUID,
  p_ciphertext TEXT,
  p_protocol_version INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender_id UUID;
  v_trimmed_ciphertext TEXT;
  v_org_id UUID;
  v_recipient_key_valid BOOLEAN;
  v_recent_minute_count INTEGER;
  v_recent_daily_count INTEGER;
  v_new_message_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- 1. Derive sender identity strictly from authenticated session
  v_sender_id := auth.uid();
  IF v_sender_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 2. Prevent concurrent rate-limit race conditions by serializing requests per sender
  PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::text));

  -- 3. Prevent self-messaging
  IF v_sender_id = p_recipient_id THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT: You cannot send an anonymous message to yourself';
  END IF;

  -- 3. Validate ciphertext format and bounds
  v_trimmed_ciphertext := trim(p_ciphertext);
  IF length(v_trimmed_ciphertext) < 48 OR length(v_trimmed_ciphertext) > 32768 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: Ciphertext payload must be between 48 and 32768 characters';
  END IF;

  -- 4. Validate protocol version
  IF p_protocol_version <> 1 THEN
    RAISE EXCEPTION 'UNSUPPORTED_VERSION: Protocol version % is not supported', p_protocol_version;
  END IF;

  -- 5. Verify sender and recipient share an active organization membership
  SELECT om1.organization_id INTO v_org_id
  FROM public.organization_members om1
  JOIN public.organization_members om2
    ON om1.organization_id = om2.organization_id
  WHERE om1.user_id = v_sender_id
    AND om1.status = 'active'
    AND om2.user_id = p_recipient_id
    AND om2.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Recipient is not a member of your active organization';
  END IF;

  -- 6. Verify recipient's active public key matches the provided key_id
  SELECT EXISTS (
    SELECT 1
    FROM public.public_keys
    WHERE id = p_key_id
      AND user_id = p_recipient_id
      AND is_active = true
  ) INTO v_recipient_key_valid;

  IF NOT v_recipient_key_valid THEN
    RAISE EXCEPTION 'RECIPIENT_KEY_MISMATCH: The recipient encryption key is invalid or has been rotated';
  END IF;

  -- 7. Server-side Rate Limiting:
  -- Max 5 messages per 60 seconds
  SELECT count(*) INTO v_recent_minute_count
  FROM public.messages
  WHERE sender_id = v_sender_id
    AND created_at > (NOW() - INTERVAL '1 minute');

  IF v_recent_minute_count >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMITED: You are sending messages too quickly. Please wait a moment.';
  END IF;

  -- Max 50 messages per 24 hours
  SELECT count(*) INTO v_recent_daily_count
  FROM public.messages
  WHERE sender_id = v_sender_id
    AND created_at > (NOW() - INTERVAL '24 hours');

  IF v_recent_daily_count >= 50 THEN
    RAISE EXCEPTION 'RATE_LIMITED: Daily sending limit reached. Please try again tomorrow.';
  END IF;

  -- 8. Insert encrypted message
  INSERT INTO public.messages (
    sender_id,
    recipient_id,
    organization_id,
    key_id,
    ciphertext,
    protocol_version
  )
  VALUES (
    v_sender_id,
    p_recipient_id,
    v_org_id,
    p_key_id,
    v_trimmed_ciphertext,
    p_protocol_version
  )
  RETURNING id, created_at INTO v_new_message_id, v_created_at;

  RETURN jsonb_build_object(
    'success', true,
    'message_id', v_new_message_id,
    'created_at', v_created_at
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Privileges
-- ------------------------------------------------------------------------------
-- Direct table access revoked; only procedure execution is granted to authenticated
GRANT EXECUTE ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) TO authenticated;
