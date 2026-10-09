-- ==============================================================================
-- 20261008000009_blocks_schema.sql
-- Description: Adds public.blocks table, RPCs (block_user, block_message_sender,
--              unblock_user, get_blocked_users), and enforces bidirectional blocking
--              in send_anonymous_message with deterministic advisory locking.
-- Security:    Prompt 010B — Phase 1 User Blocking. Server/database enforced,
--              shields internal auth UUIDs, protects sender anonymity.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create public.blocks table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocks_unique_pair UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON public.blocks(blocker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON public.blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_blocks_org ON public.blocks(organization_id);
CREATE INDEX IF NOT EXISTS idx_blocks_bidirectional ON public.blocks(blocker_id, blocked_id);

-- Enable RLS and revoke direct client table access (mediated exclusively via RPCs)
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocks FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Stored Procedure: block_user
--    Blocks a target user using their public profile identifier.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_user(
  p_target_public_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blocker_id UUID;
  v_blocked_id UUID;
  v_org_id UUID;
  v_block_id UUID;
BEGIN
  v_blocker_id := auth.uid();
  IF v_blocker_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Derive blocker's active organization
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_blocker_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_ORGANIZATION: Active membership required';
  END IF;

  -- 2. Resolve target internal ID from public_id (with fallback for compatibility)
  SELECT p.id INTO v_blocked_id
  FROM public.profiles p
  WHERE p.public_id = p_target_public_id;

  IF v_blocked_id IS NULL THEN
    SELECT p.id INTO v_blocked_id
    FROM public.profiles p
    WHERE p.id = p_target_public_id;
  END IF;

  IF v_blocked_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target user does not exist';
  END IF;

  -- 3. Prevent self-blocking
  IF v_blocker_id = v_blocked_id THEN
    RAISE EXCEPTION 'CANNOT_BLOCK_SELF: You cannot block yourself';
  END IF;

  -- 4. Verify target belongs to the same active organization
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = v_blocked_id
      AND om.organization_id = v_org_id
      AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Target is not an active member of your organization';
  END IF;

  -- 5. Deterministic lock ordering to prevent deadlocks during concurrent reciprocal blocks
  IF v_blocker_id < v_blocked_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_blocker_id::text));
    PERFORM pg_advisory_xact_lock(hashtext(v_blocked_id::text));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(v_blocked_id::text));
    PERFORM pg_advisory_xact_lock(hashtext(v_blocker_id::text));
  END IF;

  -- 6. Insert block relationship idempotently
  INSERT INTO public.blocks (organization_id, blocker_id, blocked_id)
  VALUES (v_org_id, v_blocker_id, v_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  RETURNING id INTO v_block_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_blocked', (v_block_id IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Stored Procedure: block_message_sender
--    Blocks the anonymous sender of a received message without revealing
--    the sender's identity to the recipient.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_message_sender(
  p_message_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blocker_id UUID;
  v_blocked_id UUID;
  v_org_id UUID;
  v_block_id UUID;
BEGIN
  v_blocker_id := auth.uid();
  IF v_blocker_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Verify caller has active organization membership
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_blocker_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_ORGANIZATION: Active membership required';
  END IF;

  -- 2. Verify caller is authorized recipient of the message and resolve sender_id
  SELECT m.sender_id INTO v_blocked_id
  FROM public.messages m
  WHERE m.id = p_message_id
    AND m.recipient_id = v_blocker_id
    AND m.organization_id = v_org_id;

  IF v_blocked_id IS NULL THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND: Message does not exist or unauthorized';
  END IF;

  -- 3. Prevent self-blocking
  IF v_blocker_id = v_blocked_id THEN
    RAISE EXCEPTION 'CANNOT_BLOCK_SELF: You cannot block yourself';
  END IF;

  -- 4. Deterministic lock ordering
  IF v_blocker_id < v_blocked_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_blocker_id::text));
    PERFORM pg_advisory_xact_lock(hashtext(v_blocked_id::text));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(v_blocked_id::text));
    PERFORM pg_advisory_xact_lock(hashtext(v_blocker_id::text));
  END IF;

  -- 5. Insert block relationship idempotently
  INSERT INTO public.blocks (organization_id, blocker_id, blocked_id)
  VALUES (v_org_id, v_blocker_id, v_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  RETURNING id INTO v_block_id;

  -- Zero sender identity bits returned to caller
  RETURN jsonb_build_object(
    'success', true,
    'already_blocked', (v_block_id IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.block_message_sender(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_message_sender(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: unblock_user
--    Removes a block placed by the authenticated user against a target user.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unblock_user(
  p_target_public_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_blocker_id UUID;
  v_blocked_id UUID;
  v_deleted_count INTEGER;
BEGIN
  v_blocker_id := auth.uid();
  IF v_blocker_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Resolve target internal ID from public_id (with fallback)
  SELECT p.id INTO v_blocked_id
  FROM public.profiles p
  WHERE p.public_id = p_target_public_id;

  IF v_blocked_id IS NULL THEN
    SELECT p.id INTO v_blocked_id
    FROM public.profiles p
    WHERE p.id = p_target_public_id;
  END IF;

  IF v_blocked_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target user does not exist';
  END IF;

  -- 2. Delete only the caller's own block of the target
  DELETE FROM public.blocks
  WHERE blocker_id = v_blocker_id
    AND blocked_id = v_blocked_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'unblocked', (v_deleted_count > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_user(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. Stored Procedure: get_blocked_users
--    Retrieves the caller's blocked accounts list with safe public attributes only.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_blocked_users()
RETURNS TABLE (
  public_id UUID,
  username CITEXT,
  display_name TEXT,
  avatar_url TEXT,
  blocked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_org_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- Caller must possess active organization membership
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_ORGANIZATION: Active membership required';
  END IF;

  RETURN QUERY
  SELECT
    p.public_id,
    p.username,
    p.display_name,
    p.avatar_url,
    b.created_at AS blocked_at
  FROM public.blocks b
  JOIN public.profiles p ON p.id = b.blocked_id
  WHERE b.blocker_id = v_caller_id
    AND b.organization_id = v_org_id
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_blocked_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_blocked_users() TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. Update send_anonymous_message to enforce bidirectional blocking
--    and deterministic dual-party advisory locking
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
  v_recipient_user_id UUID;
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

  -- 2. Resolve p_recipient_id: check if it is a public_id from public.profiles
  SELECT p.id INTO v_recipient_user_id
  FROM public.profiles p
  WHERE p.public_id = p_recipient_id;

  -- Fallback if p_recipient_id was passed as the internal auth ID
  IF v_recipient_user_id IS NULL THEN
    SELECT p.id INTO v_recipient_user_id
    FROM public.profiles p
    WHERE p.id = p_recipient_id;
  END IF;

  IF v_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_FOUND: Recipient does not exist';
  END IF;

  -- 3. Prevent self-messaging
  IF v_sender_id = v_recipient_user_id THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT: You cannot send an anonymous message to yourself';
  END IF;

  -- 4. Deterministic dual-party advisory locking to coordinate concurrent send and block operations
  IF v_sender_id < v_recipient_user_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::text));
    PERFORM pg_advisory_xact_lock(hashtext(v_recipient_user_id::text));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(v_recipient_user_id::text));
    PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::text));
  END IF;

  -- 5. Bidirectional block check: neither party can message the other while a block exists
  IF EXISTS (
    SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id = v_recipient_user_id AND b.blocked_id = v_sender_id)
       OR (b.blocker_id = v_sender_id AND b.blocked_id = v_recipient_user_id)
  ) THEN
    RAISE EXCEPTION 'RECIPIENT_UNAVAILABLE: Unable to deliver message to recipient'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate ciphertext format and bounds
  v_trimmed_ciphertext := trim(p_ciphertext);
  IF length(v_trimmed_ciphertext) < 48 OR length(v_trimmed_ciphertext) > 32768 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: Ciphertext payload must be between 48 and 32768 characters';
  END IF;

  -- 7. Validate protocol version
  IF p_protocol_version <> 1 THEN
    RAISE EXCEPTION 'UNSUPPORTED_VERSION: Protocol version % is not supported', p_protocol_version;
  END IF;

  -- 8. Verify sender and recipient share an active organization membership
  SELECT om1.organization_id INTO v_org_id
  FROM public.organization_members om1
  JOIN public.organization_members om2
    ON om1.organization_id = om2.organization_id
  WHERE om1.user_id = v_sender_id
    AND om1.status = 'active'
    AND om2.user_id = v_recipient_user_id
    AND om2.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Recipient is not a member of your active organization';
  END IF;

  -- 9. Verify recipient's active public key matches the provided key_id
  SELECT EXISTS (
    SELECT 1
    FROM public.public_keys
    WHERE id = p_key_id
      AND user_id = v_recipient_user_id
      AND is_active = true
  ) INTO v_recipient_key_valid;

  IF NOT v_recipient_key_valid THEN
    RAISE EXCEPTION 'RECIPIENT_KEY_MISMATCH: The specified public key is not active for this recipient';
  END IF;

  -- 10. Check sliding-window rate limit: max 5 messages per 60 seconds
  SELECT COUNT(*) INTO v_recent_minute_count
  FROM public.messages
  WHERE sender_id = v_sender_id
    AND created_at >= NOW() - INTERVAL '60 seconds';

  IF v_recent_minute_count >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMITED: You are sending messages too quickly. Limit is 5 per minute.';
  END IF;

  -- 11. Check sliding-window rate limit: max 50 messages per 24 hours
  SELECT COUNT(*) INTO v_recent_daily_count
  FROM public.messages
  WHERE sender_id = v_sender_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_recent_daily_count >= 50 THEN
    RAISE EXCEPTION 'RATE_LIMITED: Daily sending limit reached (50 messages per 24 hours).';
  END IF;

  -- 12. Insert message record using internal v_recipient_user_id
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
    v_recipient_user_id,
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

REVOKE ALL ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_anonymous_message(UUID, UUID, TEXT, INTEGER) TO authenticated;
