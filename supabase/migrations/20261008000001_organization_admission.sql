-- ==============================================================================
-- 20261008000001_organization_admission.sql
-- Anonymous Messaging Platform: Server-Enforced Organization Admission
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Helper: Find Organization by Email Domain
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_organization_by_domain(check_domain TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT o.id, o.name, o.slug
  FROM public.organizations o
  WHERE lower(trim(check_domain)) = ANY(o.allowed_domains)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_organization_by_domain(TEXT) TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 2. Procedure: Admit User to Eligible Organization
--    Enforces:
--    - Verified email domain match against organizations.allowed_domains
--    - Atomic profile creation/update
--    - Role hard-coded to 'member' (never client-controlled)
--    - Idempotent execution (safe to retry)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admit_user_to_organization(
  user_username TEXT,
  user_display_name TEXT,
  user_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_domain TEXT;
  v_org_id UUID;
  v_org_name TEXT;
  v_normalized_username TEXT;
  v_normalized_display_name TEXT;
BEGIN
  -- 1. Authenticate user from session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 2. Extract verified email from JWT
  v_email := auth.jwt() ->> 'email';
  IF v_email IS NULL OR trim(v_email) = '' THEN
    RAISE EXCEPTION 'MISSING_EMAIL: Authenticated user has no verified email address';
  END IF;

  -- 3. Safely extract domain (after single '@')
  v_email := lower(trim(v_email));
  IF position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'MALFORMED_EMAIL: Invalid email format';
  END IF;
  v_domain := split_part(v_email, '@', 2);

  -- 4. Match domain against allowed organizations
  SELECT o.id, o.name INTO v_org_id, v_org_name
  FROM public.organizations o
  WHERE v_domain = ANY(o.allowed_domains)
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'INELIGIBLE_DOMAIN: Email domain % is not authorized for any organization', v_domain;
  END IF;

  -- 5. Normalize and validate profile inputs
  v_normalized_username := lower(trim(user_username));
  v_normalized_display_name := trim(user_display_name);

  IF char_length(v_normalized_username) < 3 OR char_length(v_normalized_username) > 30 THEN
    RAISE EXCEPTION 'INVALID_USERNAME: Username must be between 3 and 30 characters';
  END IF;

  IF NOT (v_normalized_username ~ '^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$') THEN
    RAISE EXCEPTION 'INVALID_USERNAME: Username contains invalid characters';
  END IF;

  IF char_length(v_normalized_display_name) < 1 OR char_length(v_normalized_display_name) > 50 THEN
    RAISE EXCEPTION 'INVALID_DISPLAY_NAME: Display name must be between 1 and 50 characters';
  END IF;

  -- 6. Check for username collision across profiles
  IF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE username = v_normalized_username AND id != v_user_id
  ) THEN
    RAISE EXCEPTION 'USERNAME_TAKEN: The requested username is already in use';
  END IF;

  -- 7. Upsert profile record
  INSERT INTO public.profiles (id, username, display_name, avatar_url, updated_at)
  VALUES (
    v_user_id,
    v_normalized_username,
    v_normalized_display_name,
    user_avatar_url,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = NOW();

  -- 8. Upsert organization membership (strictly with role = 'member', status = 'active')
  INSERT INTO public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at,
    updated_at
  )
  VALUES (
    v_org_id,
    v_user_id,
    'member',
    'active',
    NOW(),
    NOW()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    status = 'active',
    updated_at = NOW();

  -- 9. Return structured confirmation
  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'organization_id', v_org_id,
    'organization_name', v_org_name,
    'username', v_normalized_username
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admit_user_to_organization(TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Query: Get Current User's Admission & Profile Status
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_domain TEXT;
  v_profile RECORD;
  v_member RECORD;
  v_eligible_org RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  v_email := auth.jwt() ->> 'email';
  IF v_email IS NOT NULL THEN
    v_domain := split_part(lower(trim(v_email)), '@', 2);
    SELECT id, name, slug INTO v_eligible_org
    FROM public.organizations
    WHERE v_domain = ANY(allowed_domains)
    LIMIT 1;
  END IF;

  SELECT id, username, display_name, avatar_url INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  SELECT m.organization_id, m.role, m.status, o.name AS organization_name, o.slug AS organization_slug
  INTO v_member
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = v_user_id AND m.status = 'active'
  LIMIT 1;

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', v_user_id,
    'email', v_email,
    'has_profile', (v_profile.id IS NOT NULL),
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'avatar_url', v_profile.avatar_url,
    'has_active_membership', (v_member.organization_id IS NOT NULL),
    'organization_id', v_member.organization_id,
    'organization_name', v_member.organization_name,
    'organization_slug', v_member.organization_slug,
    'role', v_member.role,
    'is_domain_eligible', (v_eligible_org.id IS NOT NULL),
    'eligible_organization_id', v_eligible_org.id,
    'eligible_organization_name', v_eligible_org.name,
    'eligible_organization_slug', v_eligible_org.slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_user_status() TO authenticated;
