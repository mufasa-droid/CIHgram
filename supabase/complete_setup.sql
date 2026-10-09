-- ==============================================================================
-- 20261008000000_initial_core_schema.sql
-- Anonymous Messaging Platform: Core Identity, Organizations, and Membership
-- ==============================================================================

-- Ensure required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ==============================================================================
-- 1. Helper Functions
-- ==============================================================================

-- Shared trigger function to automatically update `updated_at` column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ==============================================================================
-- 2. Organizations Table
-- ==============================================================================

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organizations_name_length_check CHECK (char_length(trim(name)) >= 2 AND char_length(name) <= 100),
  CONSTRAINT organizations_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) >= 2 AND char_length(slug) <= 50)
);

CREATE UNIQUE INDEX idx_organizations_slug ON public.organizations(slug);

CREATE TRIGGER set_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================================
-- 3. Profiles Table (Application-level user identity)
-- ==============================================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username CITEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_username_format_check CHECK (username ~ '^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$' AND char_length(username) >= 3 AND char_length(username) <= 30),
  CONSTRAINT profiles_display_name_length_check CHECK (char_length(trim(display_name)) >= 1 AND char_length(display_name) <= 50),
  CONSTRAINT profiles_bio_length_check CHECK (bio IS NULL OR char_length(bio) <= 250),
  CONSTRAINT profiles_avatar_url_check CHECK (avatar_url IS NULL OR avatar_url ~ '^https?://[^\s]+$')
);

CREATE UNIQUE INDEX idx_profiles_username ON public.profiles(username);
CREATE INDEX idx_profiles_created_at ON public.profiles(created_at);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================================
-- 4. Organization Members Table
-- ==============================================================================

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_members_role_check CHECK (role IN ('admin', 'moderator', 'member')),
  CONSTRAINT organization_members_status_check CHECK (status IN ('active', 'pending', 'suspended', 'removed')),
  CONSTRAINT organization_members_unique_membership UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_organization_members_user ON public.organization_members(user_id);
CREATE INDEX idx_organization_members_org ON public.organization_members(organization_id);
CREATE INDEX idx_organization_members_active_lookup ON public.organization_members(organization_id, user_id) WHERE status = 'active';

CREATE TRIGGER set_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================================
-- 5. Security Definer Authorization Functions
--    (Used to prevent recursive RLS evaluations)
-- ==============================================================================

-- Check if a user is an active member of an organization
CREATE OR REPLACE FUNCTION public.is_org_member(lookup_org_id UUID, lookup_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.organization_members
    WHERE organization_id = lookup_org_id 
      AND user_id = lookup_user_id 
      AND status = 'active'
  );
$$;

-- Check if a user has admin privileges in an organization
CREATE OR REPLACE FUNCTION public.is_org_admin(lookup_org_id UUID, lookup_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.organization_members
    WHERE organization_id = lookup_org_id 
      AND user_id = lookup_user_id 
      AND role = 'admin'
      AND status = 'active'
  );
$$;

-- Check if two users share at least one active organization membership
CREATE OR REPLACE FUNCTION public.shares_active_organization(target_user_id UUID, current_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m1
    INNER JOIN public.organization_members m2
      ON m1.organization_id = m2.organization_id
    WHERE m1.user_id = target_user_id
      AND m2.user_id = current_user_id
      AND m1.status = 'active'
      AND m2.status = 'active'
  );
$$;

-- Grant execution permissions on helper functions to authenticated role
REVOKE EXECUTE ON FUNCTION public.is_org_member(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_admin(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.shares_active_organization(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_org_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_active_organization(UUID, UUID) TO authenticated;

-- ==============================================================================
-- 6. Row Level Security Policies
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 6.1 Organizations Table RLS
-- ------------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Active organization members can view their organization details
CREATE POLICY organizations_select_active_member
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(id, auth.uid()));

-- Only organization admins can update organization details
CREATE POLICY organizations_update_admin
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (public.is_org_admin(id, auth.uid()))
  WITH CHECK (public.is_org_admin(id, auth.uid()));

-- ------------------------------------------------------------------------------
-- 6.2 Profiles Table RLS
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile or profiles of peers in the same organization
CREATE POLICY profiles_select_own_and_org_peers
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid() 
    OR public.shares_active_organization(id, auth.uid())
  );

-- Users can insert their own profile upon onboarding
CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Users can only update their own profile
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Users can delete their own profile
CREATE POLICY profiles_delete_own
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (id = auth.uid());

-- ------------------------------------------------------------------------------
-- 6.3 Organization Members Table RLS
-- ------------------------------------------------------------------------------
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Active members can view membership lists within their organization
CREATE POLICY org_members_select_active_peers
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

-- Only organization admins can add new members
CREATE POLICY org_members_insert_admin
  ON public.organization_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_admin(organization_id, auth.uid()));

-- Only organization admins can update member roles or statuses
CREATE POLICY org_members_update_admin
  ON public.organization_members
  FOR UPDATE
  TO authenticated
  USING (public.is_org_admin(organization_id, auth.uid()))
  WITH CHECK (public.is_org_admin(organization_id, auth.uid()));

-- Organization admins can remove members, or a member can leave (delete own record)
CREATE POLICY org_members_delete_admin_or_self
  ON public.organization_members
  FOR DELETE
  TO authenticated
  USING (
    public.is_org_admin(organization_id, auth.uid()) 
    OR user_id = auth.uid()
  );

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

-- ==============================================================================
-- 20261008000003_public_keys_schema.sql
-- Anonymous Messaging Platform: Public Key Infrastructure & Key Management
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Table: public.public_keys
--    Stores Curve25519 (X25519) 32-byte public encryption keys for authenticated users.
--    INVARIANTS:
--    - Strictly public key material; NEVER stores private keys or recovery secrets.
--    - At most ONE active key per user (enforced via partial unique index).
--    - Every key belongs to a verified user profile (FK to profiles.id).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'x25519-xsalsa20poly1305',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT public_key_format_check CHECK (
    length(trim(public_key)) = 44 AND public_key ~ '^[A-Za-z0-9+/]{43}=$'
  ),
  CONSTRAINT algorithm_check CHECK (
    algorithm = 'x25519-xsalsa20poly1305'
  )
);

-- ------------------------------------------------------------------------------
-- 2. Indexes
-- ------------------------------------------------------------------------------

-- Strict partial unique index: A user can have at most one active public key at any time
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_keys_unique_active_user
  ON public.public_keys (user_id)
  WHERE is_active = true;

-- Index for fetching all historical or active keys by user
CREATE INDEX IF NOT EXISTS idx_public_keys_user_id
  ON public.public_keys (user_id);

-- Index for key rotation timeline queries
CREATE INDEX IF NOT EXISTS idx_public_keys_user_created
  ON public.public_keys (user_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.public_keys ENABLE ROW LEVEL SECURITY;

-- SELECT: Authenticated users can read their own keys OR keys of users with whom
-- they share an active organization membership.
CREATE POLICY public_keys_select_policy
  ON public.public_keys
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.shares_active_organization(user_id, auth.uid())
  );

-- INSERT: Authenticated users can only insert keys where user_id matches their session.
CREATE POLICY public_keys_insert_policy
  ON public.public_keys
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
  );

-- UPDATE: Authenticated users can only update their own keys (e.g. marking inactive).
CREATE POLICY public_keys_update_policy
  ON public.public_keys
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
  );

-- DELETE: Authenticated users can only delete their own keys.
CREATE POLICY public_keys_delete_policy
  ON public.public_keys
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
  );

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: register_public_key
--    Atomically deactivates any existing active key for the calling user,
--    and registers the new active public key.
--    Guarantees auth.uid() authority (client cannot supply arbitrary user_id).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_public_key(
  p_public_key TEXT,
  p_algorithm TEXT DEFAULT 'x25519-xsalsa20poly1305'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_trimmed_key TEXT;
  v_new_key_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- Authenticate calling user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  v_trimmed_key := trim(p_public_key);

  -- Validate key format (32 bytes base64 = 44 chars ending in '=')
  IF length(v_trimmed_key) <> 44 OR v_trimmed_key !~ '^[A-Za-z0-9+/]{43}=$' THEN
    RAISE EXCEPTION 'INVALID_PUBLIC_KEY: Key must be a valid 44-character Base64 X25519 public key';
  END IF;

  -- Validate algorithm
  IF p_algorithm <> 'x25519-xsalsa20poly1305' THEN
    RAISE EXCEPTION 'INVALID_ALGORITHM: Unsupported algorithm %', p_algorithm;
  END IF;

  -- Verify user has an established profile
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: User must complete profile creation before key registration';
  END IF;

  -- Atomically deactivate previous active keys for this user
  UPDATE public.public_keys
  SET is_active = false
  WHERE user_id = v_user_id AND is_active = true;

  -- Insert the new active key
  INSERT INTO public.public_keys (
    user_id,
    public_key,
    algorithm,
    is_active
  )
  VALUES (
    v_user_id,
    v_trimmed_key,
    p_algorithm,
    true
  )
  RETURNING id, created_at INTO v_new_key_id, v_created_at;

  RETURN jsonb_build_object(
    'id', v_new_key_id,
    'user_id', v_user_id,
    'public_key', v_trimmed_key,
    'algorithm', p_algorithm,
    'is_active', true,
    'created_at', v_created_at
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Stored Procedure: get_active_public_key
--    Safely resolves the active public key of a recipient.
--    Verifies the recipient shares an active organization with the caller,
--    or that the caller is querying their own active key.
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
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  IF p_target_user_id <> v_caller_id AND NOT public.shares_active_organization(p_target_user_id, v_caller_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Recipient is not a member of your active organization';
  END IF;

  RETURN QUERY
  SELECT
    pk.id,
    pk.user_id,
    pk.public_key,
    pk.algorithm,
    pk.created_at
  FROM public.public_keys pk
  WHERE pk.user_id = p_target_user_id
    AND pk.is_active = true
  LIMIT 1;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. Stored Procedure: get_user_key_status
--    Returns key existence and registration status for the calling user.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_key_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_active_key RECORD;
  v_count INTEGER;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.public_keys
  WHERE user_id = v_caller_id;

  SELECT id, public_key, created_at INTO v_active_key
  FROM public.public_keys
  WHERE user_id = v_caller_id AND is_active = true
  LIMIT 1;

  IF v_active_key.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'has_active_key', true,
      'active_key_id', v_active_key.id,
      'active_public_key', v_active_key.public_key,
      'created_at', v_active_key.created_at,
      'key_count', v_count
    );
  ELSE
    RETURN jsonb_build_object(
      'has_active_key', false,
      'active_key_id', NULL,
      'active_public_key', NULL,
      'created_at', NULL,
      'key_count', v_count
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Privileges
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_keys TO authenticated;
REVOKE ALL ON public.public_keys FROM anon;

GRANT EXECUTE ON FUNCTION public.register_public_key(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_public_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_key_status() TO authenticated;

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

-- ==============================================================================
-- 20261008000005_strict_organization_admission.sql
-- Anonymous Messaging Platform: Database-Enforced Strict Organization Admission
-- ==============================================================================
-- INVARIANTS ENFORCED:
-- 1. Check Constraint on public.organizations(allowed_domains):
--    - Prohibits wildcard '*' or empty/blank domains.
--    - Requires strictly valid, lowercase FQDN syntax with at least one dot.
-- 2. Strict Exact-Domain Matching:
--    - Replaces find_organization_by_domain, admit_user_to_organization, and
--      get_current_user_status to strictly check `v_domain = ANY(o.allowed_domains)`.
--    - Removes all wildcard '*' clauses and fallbacks from SQL functions.
-- 3. Security Definer & Permission Boundaries:
--    - Functions retain SECURITY DEFINER with fixed search_path = public, pg_temp.
--    - Strict EXECUTE grants preserved (authenticated only for write/status RPCs).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Helper Function: Validate Organization Allowed Domains
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_allowed_domains(domains TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d TEXT;
BEGIN
  IF domains IS NULL THEN
    RETURN FALSE;
  END IF;

  FOREACH d IN ARRAY domains LOOP
    -- Disallow wildcard '*', null, or empty string
    IF d IS NULL OR trim(d) = '' OR d = '*' THEN
      RETURN FALSE;
    END IF;

    -- Require lowercase normalized string
    IF d <> lower(trim(d)) THEN
      RETURN FALSE;
    END IF;

    -- Require valid domain syntax: alphanumeric labels, hyphens, and at least one dot
    -- Max length 255 chars
    IF char_length(d) > 255 OR NOT (d ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$') THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Enforce Check Constraint on public.organizations
-- ------------------------------------------------------------------------------
-- Sanitize any existing organization that may have had a wildcard in development
UPDATE public.organizations
SET allowed_domains = array_remove(allowed_domains, '*')
WHERE '*' = ANY(allowed_domains);

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_allowed_domains_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_allowed_domains_check
  CHECK (public.validate_allowed_domains(allowed_domains));

-- ------------------------------------------------------------------------------
-- 3. Re-define public.find_organization_by_domain (Strict Exact Match)
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

REVOKE ALL ON FUNCTION public.find_organization_by_domain(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_organization_by_domain(TEXT) TO authenticated, anon;

-- ------------------------------------------------------------------------------
-- 4. Re-define public.admit_user_to_organization (Strict Exact Match)
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

  -- 4. Match domain strictly against allowed organizations (exact match only)
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

REVOKE ALL ON FUNCTION public.admit_user_to_organization(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admit_user_to_organization(TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. Re-define public.get_current_user_status (Strict Exact Match)
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

REVOKE ALL ON FUNCTION public.get_current_user_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_status() TO authenticated;

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



