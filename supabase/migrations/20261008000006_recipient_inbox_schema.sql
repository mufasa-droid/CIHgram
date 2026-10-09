-- ==============================================================================
-- 20261008000006_recipient_inbox_schema.sql
-- Anonymous Messaging Platform: Recipient Inbox, Security Barrier View & Actions
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PostgreSQL Security Barrier View: recipient_inbox_messages
--    DUAL DEFENSE ANONYMITY LAYER:
--    - Projects ONLY recipient-safe columns (id, recipient_id, ciphertext, key_id,
--      protocol_version, created_at, is_read, is_starred).
--    - Excludes sender_id and organization_id at the database level.
--    - Enforces recipient_id = auth.uid() and deleted_by_recipient = false.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.recipient_inbox_messages
WITH (security_barrier = true) AS
SELECT
  m.id,
  m.recipient_id,
  m.ciphertext,
  m.key_id,
  m.protocol_version,
  m.created_at,
  m.is_read,
  m.is_starred
FROM public.messages m
WHERE m.recipient_id = auth.uid()
  AND m.deleted_by_recipient = false;

GRANT SELECT ON public.recipient_inbox_messages TO authenticated;
REVOKE ALL ON public.recipient_inbox_messages FROM anon;

-- ------------------------------------------------------------------------------
-- 2. Stored Procedure: get_recipient_inbox
--    Returns paginated encrypted messages for the authenticated recipient.
--    INVARIANTS:
--    - Caller identity derived strictly from auth.uid().
--    - Bounded pagination: limit clamped between 1 and 50 (default 20).
--    - Stable ordering: created_at DESC, id DESC.
--    - Excludes deleted_by_recipient = true.
--    - ZERO sender-identifying fields returned.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_recipient_inbox(
  p_cursor TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id UUID;
  v_limit INTEGER;
  v_messages JSONB;
  v_has_more BOOLEAN := false;
  v_next_cursor TIMESTAMPTZ := NULL;
BEGIN
  -- 1. Derive recipient identity strictly from verified session
  v_recipient_id := auth.uid();
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 2. Clamp limit safely between 1 and 50
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  -- 3. Query messages for recipient with cursor pagination (+1 to check for has_more)
  WITH paged_records AS (
    SELECT
      m.id,
      m.ciphertext,
      m.key_id,
      m.protocol_version,
      m.created_at,
      m.is_read,
      m.is_starred
    FROM public.messages m
    WHERE m.recipient_id = v_recipient_id
      AND m.deleted_by_recipient = false
      AND (p_cursor IS NULL OR m.created_at < p_cursor)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT (v_limit + 1)
  ),
  counted AS (
    SELECT count(*) AS total_fetched FROM paged_records
  ),
  trimmed_records AS (
    SELECT *
    FROM paged_records
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'ciphertext', r.ciphertext,
          'key_id', r.key_id,
          'protocol_version', r.protocol_version,
          'created_at', r.created_at,
          'is_read', r.is_read,
          'is_starred', r.is_starred
        )
        ORDER BY r.created_at DESC, r.id DESC
      ),
      '[]'::jsonb
    ),
    COALESCE((SELECT total_fetched > v_limit FROM counted), false),
    (SELECT r.created_at FROM trimmed_records r ORDER BY r.created_at ASC, r.id ASC LIMIT 1)
  INTO v_messages, v_has_more, v_next_cursor
  FROM trimmed_records r;

  IF NOT v_has_more THEN
    v_next_cursor := NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'messages', COALESCE(v_messages, '[]'::jsonb),
    'has_more', COALESCE(v_has_more, false),
    'next_cursor', v_next_cursor
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Stored Procedure: mark_message_read
--    Idempotently marks a recipient message as read.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_message_read(
  p_message_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id UUID;
  v_rows_affected INTEGER;
BEGIN
  v_recipient_id := auth.uid();
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  UPDATE public.messages
  SET is_read = true
  WHERE id = p_message_id
    AND recipient_id = v_recipient_id
    AND deleted_by_recipient = false;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_rows_affected > 0
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: set_message_starred
--    Updates the recipient-owned star state for a message.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_message_starred(
  p_message_id UUID,
  p_is_starred BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id UUID;
  v_rows_affected INTEGER;
BEGIN
  v_recipient_id := auth.uid();
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  UPDATE public.messages
  SET is_starred = p_is_starred
  WHERE id = p_message_id
    AND recipient_id = v_recipient_id
    AND deleted_by_recipient = false;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'MESSAGE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_starred', p_is_starred
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Stored Procedure: delete_message_for_recipient
--    Soft-deletes a message from the recipient inbox.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_message_for_recipient(
  p_message_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id UUID;
  v_rows_affected INTEGER;
BEGIN
  v_recipient_id := auth.uid();
  IF v_recipient_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  UPDATE public.messages
  SET deleted_by_recipient = true
  WHERE id = p_message_id
    AND recipient_id = v_recipient_id;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_rows_affected > 0
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Stored Procedure: get_inbox_unread_count
--    Returns unread count for recipient inbox without exposing messages.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inbox_unread_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_id UUID;
  v_count INTEGER;
BEGIN
  v_recipient_id := auth.uid();
  IF v_recipient_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.messages
  WHERE recipient_id = v_recipient_id
    AND deleted_by_recipient = false
    AND is_read = false;

  RETURN v_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Additional Indexes for Performance
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread
  ON public.messages (recipient_id)
  WHERE deleted_by_recipient = false AND is_read = false;

CREATE INDEX IF NOT EXISTS idx_messages_recipient_starred
  ON public.messages (recipient_id, created_at DESC)
  WHERE deleted_by_recipient = false AND is_starred = true;

-- ------------------------------------------------------------------------------
-- 8. Execution Grants
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_recipient_inbox(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recipient_inbox(TIMESTAMPTZ, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_message_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_message_read(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.set_message_starred(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_message_starred(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_message_for_recipient(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_message_for_recipient(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_inbox_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inbox_unread_count() TO authenticated;
