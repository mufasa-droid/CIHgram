-- ==============================================================================
-- 20261008000008_public_profile_identifiers.sql
-- Description: Adds stable, opaque public_id to public.profiles and decouples
--              member discovery and messaging from auth.users(id).
-- Security:    Remediates FINDING-009A-1: internal auth UUIDs are completely
--              shielded from directory queries, client DTOs, and network payloads.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Add public_id to public.profiles
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_public_id 
  ON public.profiles(public_id);

-- ------------------------------------------------------------------------------
-- 2. Update search_organization_members to project public_id AS id
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_organization_members(
  query_text TEXT DEFAULT '',
  result_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  username CITEXT,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_sanitized_query TEXT;
  v_limit INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  -- Derive the authenticated caller's active organization
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_ORGANIZATION';
  END IF;

  -- Clamp result limit between 1 and 100 to guarantee bounded queries
  v_limit := LEAST(GREATEST(COALESCE(result_limit, 50), 1), 100);
  v_sanitized_query := TRIM(COALESCE(query_text, ''));

  IF v_sanitized_query = '' THEN
    RETURN QUERY
    SELECT 
      p.public_id AS id,
      p.username,
      p.display_name,
      p.avatar_url
    FROM public.organization_members om
    INNER JOIN public.profiles p ON p.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.status = 'active'
      AND om.user_id != v_user_id
    ORDER BY p.display_name ASC, p.username ASC
    LIMIT v_limit;
  ELSE
    RETURN QUERY
    SELECT 
      p.public_id AS id,
      p.username,
      p.display_name,
      p.avatar_url
    FROM public.organization_members om
    INNER JOIN public.profiles p ON p.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.status = 'active'
      AND om.user_id != v_user_id
      AND (
        p.display_name ILIKE '%' || v_sanitized_query || '%'
        OR p.username ILIKE '%' || v_sanitized_query || '%'
      )
    ORDER BY 
      CASE 
        WHEN p.username ILIKE v_sanitized_query || '%' THEN 1
        WHEN p.display_name ILIKE v_sanitized_query || '%' THEN 2
        ELSE 3
      END,
      p.display_name ASC
    LIMIT v_limit;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_organization_members(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_organization_members(TEXT, INT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Update get_organization_member_by_username to project public_id AS id
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_organization_member_by_username(
  target_username TEXT
)
RETURNS TABLE (
  id UUID,
  username CITEXT,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_org_id UUID;
  v_clean_username TEXT;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_ORGANIZATION';
  END IF;

  v_clean_username := lower(trim(COALESCE(target_username, '')));
  IF v_clean_username = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 
    p.public_id AS id,
    p.username,
    p.display_name,
    p.avatar_url
  FROM public.organization_members om
  INNER JOIN public.profiles p ON p.id = om.user_id
  WHERE om.organization_id = v_org_id
    AND om.status = 'active'
    AND p.username = v_clean_username::citext
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_organization_member_by_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_member_by_username(TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Update get_active_public_key to resolve recipient by public_id or user_id
--    and return public_id in place of raw auth user_id
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_public_key(
  p_target_user_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  public_key TEXT,
  algorithm TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_target_user_id UUID;
  v_target_public_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Resolve p_target_user_id: check if it matches a profiles.public_id
  SELECT p.id, p.public_id INTO v_target_user_id, v_target_public_id
  FROM public.profiles p
  WHERE p.public_id = p_target_user_id;

  -- 2. Fallback if p_target_user_id is the internal auth ID
  IF v_target_user_id IS NULL THEN
    SELECT p.id, p.public_id INTO v_target_user_id, v_target_public_id
    FROM public.profiles p
    WHERE p.id = p_target_user_id;
  END IF;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'RECIPIENT_NOT_FOUND: Recipient does not exist';
  END IF;

  -- 3. Verify organization boundary (or querying own key)
  IF v_target_user_id <> v_caller_id AND NOT public.shares_active_organization(v_target_user_id, v_caller_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Recipient is not a member of your active organization';
  END IF;

  -- 4. Return active key with public_id projected as user_id (shielding internal auth UUID)
  RETURN QUERY
  SELECT
    pk.id,
    v_target_public_id AS user_id,
    pk.public_key,
    pk.algorithm,
    pk.created_at
  FROM public.public_keys pk
  WHERE pk.user_id = v_target_user_id
    AND pk.is_active = true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_active_public_key(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_public_key(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. Update send_anonymous_message to resolve recipient by public_id or user_id
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

  -- 3. Prevent concurrent rate-limit race conditions by serializing requests per sender
  PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::text));

  -- 4. Prevent self-messaging
  IF v_sender_id = v_recipient_user_id THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT: You cannot send an anonymous message to yourself';
  END IF;

  -- 5. Validate ciphertext format and bounds
  v_trimmed_ciphertext := trim(p_ciphertext);
  IF length(v_trimmed_ciphertext) < 48 OR length(v_trimmed_ciphertext) > 32768 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: Ciphertext payload must be between 48 and 32768 characters';
  END IF;

  -- 6. Validate protocol version
  IF p_protocol_version <> 1 THEN
    RAISE EXCEPTION 'UNSUPPORTED_VERSION: Protocol version % is not supported', p_protocol_version;
  END IF;

  -- 7. Verify sender and recipient share an active organization membership
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

  -- 8. Verify recipient's active public key matches the provided key_id
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

  -- 9. Check sliding-window rate limit: max 5 messages per 60 seconds
  SELECT COUNT(*) INTO v_recent_minute_count
  FROM public.messages
  WHERE sender_id = v_sender_id
    AND created_at >= NOW() - INTERVAL '60 seconds';

  IF v_recent_minute_count >= 5 THEN
    RAISE EXCEPTION 'RATE_LIMITED: You are sending messages too quickly. Limit is 5 per minute.';
  END IF;

  -- 10. Check sliding-window rate limit: max 50 messages per 24 hours
  SELECT COUNT(*) INTO v_recent_daily_count
  FROM public.messages
  WHERE sender_id = v_sender_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_recent_daily_count >= 50 THEN
    RAISE EXCEPTION 'RATE_LIMITED: Daily sending limit reached (50 messages per 24 hours).';
  END IF;

  -- 11. Insert message record using internal v_recipient_user_id
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
