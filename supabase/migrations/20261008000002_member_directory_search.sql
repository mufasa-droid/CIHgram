-- ==============================================================================
-- Migration: 20261008000002_member_directory_search.sql
-- Description: Member discovery and directory search routines with strict
--              organization scoping, safe public projection, and caller exclusion.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Performance Indexes for Directory Search
-- ------------------------------------------------------------------------------

-- Search indexes for case-insensitive lookup on public profile fields
CREATE INDEX IF NOT EXISTS idx_profiles_display_name_lower 
  ON public.profiles (lower(display_name));

CREATE INDEX IF NOT EXISTS idx_profiles_username_lower 
  ON public.profiles (lower(username));

-- ------------------------------------------------------------------------------
-- 2. search_organization_members Function
-- ------------------------------------------------------------------------------
-- Returns active members within the caller's active organization matching an
-- optional search query over username and display_name.
-- Automatically excludes the calling user from recipient results.
-- Strictly scoped to the caller's organization; never trusts client-supplied org ID.
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
      p.id,
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
      p.id,
      p.username,
      p.display_name,
      p.avatar_url
    FROM public.organization_members om
    INNER JOIN public.profiles p ON p.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.status = 'active'
      AND om.user_id != v_user_id
      AND (
        p.username ILIKE ('%' || v_sanitized_query || '%')
        OR p.display_name ILIKE ('%' || v_sanitized_query || '%')
      )
    ORDER BY p.display_name ASC, p.username ASC
    LIMIT v_limit;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. get_organization_member_by_username Function
-- ------------------------------------------------------------------------------
-- Resolves a single recipient's public profile by username strictly within the
-- caller's active organization. Returns 0 rows if target is not in the same org,
-- preventing cross-organization enumeration.
CREATE OR REPLACE FUNCTION public.get_organization_member_by_username(
  target_username CITEXT
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
  v_clean_username CITEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'NO_ACTIVE_ORGANIZATION';
  END IF;

  v_clean_username := TRIM(COALESCE(target_username, ''));

  RETURN QUERY
  SELECT 
    p.id,
    p.username,
    p.display_name,
    p.avatar_url
  FROM public.organization_members om
  INNER JOIN public.profiles p ON p.id = om.user_id
  WHERE om.organization_id = v_org_id
    AND om.status = 'active'
    AND om.user_id != v_user_id
    AND p.username = v_clean_username
  LIMIT 1;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Permissions Hardening
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.search_organization_members(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_organization_member_by_username(CITEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.search_organization_members(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_member_by_username(CITEXT) TO authenticated;
