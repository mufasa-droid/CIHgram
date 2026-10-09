-- ==============================================================================
-- 20261008000007_harden_inbox_organization_boundary.sql
-- Anonymous Messaging Platform: Harden Inbox Organization Boundary
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Security Barrier View: recipient_inbox_messages
--    Re-defined WITH (security_barrier = true) enforcing:
--    - recipient_id = auth.uid()
--    - deleted_by_recipient = false
--    - Active organization membership matching the message's organization_id
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
  AND m.deleted_by_recipient = false
  AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = m.organization_id
      AND om.status = 'active'
  );

GRANT SELECT ON public.recipient_inbox_messages TO authenticated;
REVOKE ALL ON public.recipient_inbox_messages FROM anon;

-- ------------------------------------------------------------------------------
-- 2. Stored Procedure: get_recipient_inbox
--    Re-defined to query directly through recipient_inbox_messages view and
--    verify active organization membership for caller.
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

  -- 2. Verify caller has at least one active organization membership
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = v_recipient_id AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: No active organization membership';
  END IF;

  -- 3. Clamp limit safely between 1 and 50
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  -- 4. Query messages via security barrier view with cursor pagination (+1 to check for has_more)
  WITH paged_records AS (
    SELECT
      m.id,
      m.ciphertext,
      m.key_id,
      m.protocol_version,
      m.created_at,
      m.is_read,
      m.is_starred
    FROM public.recipient_inbox_messages m
    WHERE (p_cursor IS NULL OR m.created_at < p_cursor)
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

  UPDATE public.messages m
  SET is_read = true
  WHERE m.id = p_message_id
    AND m.recipient_id = v_recipient_id
    AND m.deleted_by_recipient = false
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = v_recipient_id
        AND om.organization_id = m.organization_id
        AND om.status = 'active'
    );

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_rows_affected > 0
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: set_message_starred
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

  UPDATE public.messages m
  SET is_starred = p_is_starred
  WHERE m.id = p_message_id
    AND m.recipient_id = v_recipient_id
    AND m.deleted_by_recipient = false
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = v_recipient_id
        AND om.organization_id = m.organization_id
        AND om.status = 'active'
    );

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

  UPDATE public.messages m
  SET deleted_by_recipient = true
  WHERE m.id = p_message_id
    AND m.recipient_id = v_recipient_id
    AND EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.user_id = v_recipient_id
        AND om.organization_id = m.organization_id
        AND om.status = 'active'
    );

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', v_rows_affected > 0
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Stored Procedure: get_inbox_unread_count
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
  FROM public.recipient_inbox_messages m
  WHERE m.is_read = false;

  RETURN COALESCE(v_count, 0);
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Execution Grants
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
