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

-- ==============================================================================
-- 20261008000010_reports_schema.sql
-- Description: Adds public.reports table, constraints, indexes, and
--              create_message_report RPC for Phase 2 Abuse Reporting.
-- Security:    Prompt 010C — Abuse Reporting & Explicit Evidence Disclosure.
--              Enforces one-report-per-message DB uniqueness, reporter rate
--              limiting, optional plaintext consent, and zero client sender exposure.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create public.reports table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('harassment', 'threats', 'spam', 'inappropriate_content', 'impersonation', 'other')),
  details TEXT CHECK (details IS NULL OR (length(trim(details)) >= 1 AND length(details) <= 1000)),
  disclosed_plaintext TEXT CHECK (disclosed_plaintext IS NULL OR (length(disclosed_plaintext) >= 1 AND length(disclosed_plaintext) <= 2000)),
  disclosed_plaintext_consent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reports_no_self_report CHECK (reporter_id <> reported_user_id),
  CONSTRAINT reports_unique_message_reporter UNIQUE (message_id, reporter_id),
  CONSTRAINT reports_plaintext_consent_check CHECK (disclosed_plaintext IS NULL OR disclosed_plaintext_consent = true)
);

CREATE INDEX IF NOT EXISTS idx_reports_org_status ON public.reports(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_message ON public.reports(message_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON public.reports(reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON public.reports(reported_user_id, created_at DESC);

-- Enable RLS and revoke direct client table access (mediated exclusively via controlled RPCs)
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reports FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Stored Procedure: create_message_report
--    Creates a message abuse report submitted by the recipient.
--    Optionally stores user-disclosed plaintext only when explicit consent is provided.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_message_report(
  p_message_id UUID,
  p_category TEXT,
  p_details TEXT DEFAULT NULL,
  p_disclose_plaintext BOOLEAN DEFAULT FALSE,
  p_disclosed_plaintext TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org_id UUID;
  v_msg_org_id UUID;
  v_msg_sender_id UUID;
  v_clean_details TEXT;
  v_clean_plaintext TEXT;
  v_consent BOOLEAN;
  v_report_id UUID;
  v_recent_reports_count INTEGER;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Derive reporter's active organization
  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an active organization member';
  END IF;

  -- 2. Validate category
  IF p_category NOT IN ('harassment', 'threats', 'spam', 'inappropriate_content', 'impersonation', 'other') THEN
    RAISE EXCEPTION 'INVALID_CATEGORY: Invalid report category';
  END IF;

  -- 3. Validate details if provided
  IF p_details IS NOT NULL AND length(trim(p_details)) > 0 THEN
    v_clean_details := trim(p_details);
    IF length(v_clean_details) > 1000 THEN
      RAISE EXCEPTION 'INVALID_DETAILS: Report details must not exceed 1000 characters';
    END IF;
  ELSE
    v_clean_details := NULL;
  END IF;

  -- 4. Rate limiting: Max 10 reports per hour per reporter
  SELECT count(*) INTO v_recent_reports_count
  FROM public.reports
  WHERE reporter_id = v_caller_id
    AND created_at > NOW() - INTERVAL '1 hour';

  IF v_recent_reports_count >= 10 THEN
    RAISE EXCEPTION 'RATE_LIMITED: You have submitted too many reports recently. Please wait before submitting another.';
  END IF;

  -- 5. Serialize concurrent duplicate attempts using transaction advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('report:' || v_caller_id::text || ':' || p_message_id::text));

  -- 6. Duplicate report check
  IF EXISTS (
    SELECT 1 FROM public.reports
    WHERE message_id = p_message_id
      AND reporter_id = v_caller_id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_REPORT: You have already submitted a report for this message.';
  END IF;

  -- 7. Verify message existence, recipient ownership, and organization scoping
  SELECT m.organization_id, m.sender_id INTO v_msg_org_id, v_msg_sender_id
  FROM public.messages m
  WHERE m.id = p_message_id
    AND m.recipient_id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND: Message not found or caller is not authorized recipient';
  END IF;

  IF v_msg_org_id <> v_caller_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Message does not belong to caller active organization';
  END IF;

  IF v_msg_sender_id = v_caller_id THEN
    RAISE EXCEPTION 'CANNOT_REPORT_SELF: You cannot report your own message';
  END IF;

  -- 8. Validate optional plaintext disclosure
  IF p_disclose_plaintext IS TRUE AND p_disclosed_plaintext IS NOT NULL AND length(p_disclosed_plaintext) > 0 THEN
    v_clean_plaintext := p_disclosed_plaintext;
    IF length(v_clean_plaintext) > 2000 THEN
      RAISE EXCEPTION 'INVALID_PLAINTEXT: Disclosed plaintext must not exceed 2000 characters';
    END IF;
    v_consent := true;
  ELSE
    v_clean_plaintext := NULL;
    v_consent := false;
  END IF;

  -- 9. Insert report record
  INSERT INTO public.reports (
    organization_id,
    reporter_id,
    reported_user_id,
    message_id,
    category,
    details,
    disclosed_plaintext,
    disclosed_plaintext_consent,
    status
  ) VALUES (
    v_caller_org_id,
    v_caller_id,
    v_msg_sender_id,
    p_message_id,
    p_category,
    v_clean_details,
    v_clean_plaintext,
    v_consent,
    'pending'
  )
  RETURNING id INTO v_report_id;

  -- 10. Return minimal confirmation (never reveals sender identity)
  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report_id
  );
END;
$$;

-- Explicitly revoke and grant execution permissions
REVOKE ALL ON FUNCTION public.create_message_report FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_message_report TO authenticated;

-- ==============================================================================
-- 20261008000011_moderation_actions_schema.sql
-- Description: Adds moderation_actions audit table, moderator authorization,
--              get_organization_reports, get_report_details, resolve_report,
--              apply_moderation_action, and get_moderation_actions RPCs.
-- Security:    Prompt 010D — Moderator Dashboard, Report Review & Auditable Moderation.
--              Enforces server-side moderator role verification, append-only
--              audit history, scoped plaintext access, and membership status
--              synchronization (suspension/reactivation).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Authorization Helper: is_org_moderator_or_admin
--    Checks whether the lookup user has active admin or moderator role.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_moderator_or_admin(lookup_org_id UUID, lookup_user_id UUID)
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
      AND role IN ('admin', 'moderator')
      AND status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_moderator_or_admin(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_moderator_or_admin(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. Create public.moderation_actions Table
--    Append-only audit trail capturing all consequential moderation decisions.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  moderator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('resolve_report', 'dismiss_report', 'investigate_report', 'warn_user', 'suspend_user', 'reactivate_user')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3 AND length(reason) <= 1000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_org_created ON public.moderation_actions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_report ON public.moderation_actions(report_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_moderator ON public.moderation_actions(moderator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON public.moderation_actions(target_user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

-- Revoke all direct privileges; only controlled SELECT via policy for authorized moderators/admins
REVOKE ALL ON public.moderation_actions FROM PUBLIC, anon, authenticated;

CREATE POLICY moderation_actions_mod_admin_read ON public.moderation_actions
  FOR SELECT TO authenticated
  USING (public.is_org_moderator_or_admin(organization_id, auth.uid()));

GRANT SELECT ON public.moderation_actions TO authenticated;

-- Allow SELECT on public.reports for active moderators/admins
CREATE POLICY reports_mod_admin_read ON public.reports
  FOR SELECT TO authenticated
  USING (public.is_org_moderator_or_admin(organization_id, auth.uid()));

GRANT SELECT ON public.reports TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Stored Procedure: get_organization_reports
--    Returns report queue summary for the moderator's active organization.
--    Omits raw plaintext to prevent bulk extraction; shields reporter identity.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_organization_reports(
  p_status TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  category TEXT,
  details TEXT,
  status TEXT,
  has_disclosed_plaintext BOOLEAN,
  disclosed_plaintext_consent BOOLEAN,
  reported_user_public_id UUID,
  reported_username CITEXT,
  reported_display_name TEXT,
  reported_user_status TEXT,
  message_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org_id UUID;
  v_limit INTEGER;
  v_offset INTEGER;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- Derive caller's active organization where caller is moderator or admin
  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.role IN ('admin', 'moderator')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an active moderator or administrator';
  END IF;

  -- Clamp limit and offset
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  SELECT
    r.id,
    r.organization_id,
    r.category,
    r.details,
    r.status,
    (r.disclosed_plaintext IS NOT NULL AND r.disclosed_plaintext_consent = true) AS has_disclosed_plaintext,
    r.disclosed_plaintext_consent,
    p.public_id AS reported_user_public_id,
    p.username AS reported_username,
    p.display_name AS reported_display_name,
    om_target.status AS reported_user_status,
    r.message_id,
    r.created_at,
    r.updated_at
  FROM public.reports r
  JOIN public.profiles p ON p.id = r.reported_user_id
  LEFT JOIN public.organization_members om_target 
    ON om_target.user_id = r.reported_user_id 
   AND om_target.organization_id = r.organization_id
  WHERE r.organization_id = v_caller_org_id
    AND (p_status IS NULL OR r.status = p_status)
    AND (p_category IS NULL OR r.category = p_category)
  ORDER BY r.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_organization_reports(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organization_reports(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: get_report_details
--    Fetches full detail for a single report including disclosed plaintext
--    (if consented) and associated audit actions. Scoped to moderator's org.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_details(
  p_report_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org_id UUID;
  v_report RECORD;
  v_actions JSONB;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.role IN ('admin', 'moderator')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an active moderator or administrator';
  END IF;

  -- Fetch report details
  SELECT
    r.id,
    r.organization_id,
    r.category,
    r.details,
    r.status,
    CASE 
      WHEN r.disclosed_plaintext_consent = true THEN r.disclosed_plaintext
      ELSE NULL
    END AS disclosed_plaintext,
    r.disclosed_plaintext_consent,
    r.message_id,
    r.created_at,
    r.updated_at,
    p.public_id AS reported_user_public_id,
    p.username AS reported_username,
    p.display_name AS reported_display_name,
    om_target.status AS reported_user_status
  INTO v_report
  FROM public.reports r
  JOIN public.profiles p ON p.id = r.reported_user_id
  LEFT JOIN public.organization_members om_target
    ON om_target.user_id = r.reported_user_id
   AND om_target.organization_id = r.organization_id
  WHERE r.id = p_report_id
    AND r.organization_id = v_caller_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: Report does not exist or caller is not authorized';
  END IF;

  -- Fetch audit history for this report
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ma.id,
        'action_type', ma.action_type,
        'reason', ma.reason,
        'created_at', ma.created_at,
        'moderator_username', mod_p.username,
        'moderator_display_name', mod_p.display_name
      ) ORDER BY ma.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_actions
  FROM public.moderation_actions ma
  JOIN public.profiles mod_p ON mod_p.id = ma.moderator_id
  WHERE ma.report_id = p_report_id;

  RETURN jsonb_build_object(
    'id', v_report.id,
    'organization_id', v_report.organization_id,
    'category', v_report.category,
    'details', v_report.details,
    'status', v_report.status,
    'disclosed_plaintext', v_report.disclosed_plaintext,
    'disclosed_plaintext_consent', v_report.disclosed_plaintext_consent,
    'message_id', v_report.message_id,
    'created_at', v_report.created_at,
    'updated_at', v_report.updated_at,
    'reported_user', jsonb_build_object(
      'public_id', v_report.reported_user_public_id,
      'username', v_report.reported_username,
      'display_name', v_report.reported_display_name,
      'status', v_report.reported_user_status
    ),
    'actions', v_actions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_report_details(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_details(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. Stored Procedure: resolve_report
--    Transitions report status and records an auditable action.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_report(
  p_report_id UUID,
  p_new_status TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org_id UUID;
  v_current_status TEXT;
  v_reported_user_id UUID;
  v_report_org_id UUID;
  v_clean_reason TEXT;
  v_action_type TEXT;
  v_action_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Validate caller is active moderator or admin
  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.role IN ('admin', 'moderator')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an active moderator or administrator';
  END IF;

  -- 2. Validate input parameters
  IF p_new_status NOT IN ('investigating', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'INVALID_STATUS: Allowed statuses are investigating, resolved, or dismissed';
  END IF;

  v_clean_reason := trim(COALESCE(p_reason, ''));
  IF length(v_clean_reason) < 3 OR length(v_clean_reason) > 1000 THEN
    RAISE EXCEPTION 'INVALID_REASON: Reason must be between 3 and 1000 characters';
  END IF;

  -- 3. Lock report row for state transition
  PERFORM pg_advisory_xact_lock(hashtext('resolve_report:' || p_report_id::text));

  SELECT r.organization_id, r.status, r.reported_user_id
  INTO v_report_org_id, v_current_status, v_reported_user_id
  FROM public.reports r
  WHERE r.id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: Report does not exist';
  END IF;

  IF v_report_org_id <> v_caller_org_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Report does not belong to caller organization';
  END IF;

  IF v_current_status = p_new_status THEN
    RAISE EXCEPTION 'NOOP_STATUS: Report is already in status %', p_new_status;
  END IF;

  -- 4. Update report record
  UPDATE public.reports
  SET status = p_new_status,
      updated_at = timezone('utc'::text, now())
  WHERE id = p_report_id;

  -- 5. Determine action type
  v_action_type := CASE 
    WHEN p_new_status = 'investigating' THEN 'investigate_report'
    WHEN p_new_status = 'resolved' THEN 'resolve_report'
    ELSE 'dismiss_report'
  END;

  -- 6. Record append-only audit entry
  INSERT INTO public.moderation_actions (
    organization_id,
    report_id,
    moderator_id,
    target_user_id,
    action_type,
    reason,
    metadata
  ) VALUES (
    v_caller_org_id,
    p_report_id,
    v_caller_id,
    v_reported_user_id,
    v_action_type,
    v_clean_reason,
    jsonb_build_object(
      'previous_status', v_current_status,
      'new_status', p_new_status
    )
  ) RETURNING id INTO v_action_id;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', p_report_id,
    'new_status', p_new_status,
    'action_id', v_action_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_report(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_report(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. Stored Procedure: apply_moderation_action
--    Applies user sanctions (warn, suspend, reactivate) and records audit trail.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_moderation_action(
  p_target_public_id UUID,
  p_action_type TEXT,
  p_reason TEXT,
  p_report_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org_id UUID;
  v_caller_role TEXT;
  v_target_user_id UUID;
  v_target_role TEXT;
  v_target_status TEXT;
  v_clean_reason TEXT;
  v_action_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  -- 1. Validate caller is active moderator or admin
  SELECT om.organization_id, om.role INTO v_caller_org_id, v_caller_role
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.role IN ('admin', 'moderator')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an active moderator or administrator';
  END IF;

  -- 2. Validate action type
  IF p_action_type NOT IN ('warn_user', 'suspend_user', 'reactivate_user') THEN
    RAISE EXCEPTION 'INVALID_ACTION_TYPE: Allowed actions are warn_user, suspend_user, or reactivate_user';
  END IF;

  v_clean_reason := trim(COALESCE(p_reason, ''));
  IF length(v_clean_reason) < 3 OR length(v_clean_reason) > 1000 THEN
    RAISE EXCEPTION 'INVALID_REASON: Reason must be between 3 and 1000 characters';
  END IF;

  -- 3. Resolve target internal user_id from public_id
  SELECT p.id INTO v_target_user_id
  FROM public.profiles p
  WHERE p.public_id = p_target_public_id;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: Target user does not exist';
  END IF;

  -- 4. Prevent self-moderation
  IF v_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'CANNOT_MODERATE_SELF: Moderators cannot apply moderation actions to their own account';
  END IF;

  -- 5. Verify target membership in caller's organization
  SELECT om.role, om.status INTO v_target_role, v_target_status
  FROM public.organization_members om
  WHERE om.organization_id = v_caller_org_id
    AND om.user_id = v_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TARGET_NOT_IN_ORGANIZATION: Target user is not a member of your organization';
  END IF;

  -- 6. Role hierarchy defense: only admins can take action against admins
  IF v_target_role = 'admin' AND v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'INSUFFICIENT_PRIVILEGES: Only administrators can take action against organization administrators';
  END IF;

  -- 7. Execute status transitions
  IF p_action_type = 'suspend_user' THEN
    IF v_target_status = 'suspended' THEN
      RAISE EXCEPTION 'ALREADY_SUSPENDED: Target user is already suspended';
    END IF;

    UPDATE public.organization_members
    SET status = 'suspended',
        updated_at = timezone('utc'::text, now())
    WHERE organization_id = v_caller_org_id
      AND user_id = v_target_user_id;

  ELSIF p_action_type = 'reactivate_user' THEN
    IF v_target_status = 'active' THEN
      RAISE EXCEPTION 'ALREADY_ACTIVE: Target user is already active';
    END IF;

    UPDATE public.organization_members
    SET status = 'active',
        updated_at = timezone('utc'::text, now())
    WHERE organization_id = v_caller_org_id
      AND user_id = v_target_user_id;
  END IF;

  -- 8. If report_id provided, verify and resolve report
  IF p_report_id IS NOT NULL THEN
    UPDATE public.reports
    SET status = 'resolved',
        updated_at = timezone('utc'::text, now())
    WHERE id = p_report_id
      AND organization_id = v_caller_org_id
      AND reported_user_id = v_target_user_id;
  END IF;

  -- 9. Insert append-only audit record
  INSERT INTO public.moderation_actions (
    organization_id,
    report_id,
    moderator_id,
    target_user_id,
    action_type,
    reason,
    metadata
  ) VALUES (
    v_caller_org_id,
    p_report_id,
    v_caller_id,
    v_target_user_id,
    p_action_type,
    v_clean_reason,
    jsonb_build_object(
      'target_public_id', p_target_public_id,
      'previous_status', v_target_status,
      'new_status', CASE 
        WHEN p_action_type = 'suspend_user' THEN 'suspended'
        WHEN p_action_type = 'reactivate_user' THEN 'active'
        ELSE v_target_status
      END
    )
  ) RETURNING id INTO v_action_id;

  RETURN jsonb_build_object(
    'success', true,
    'action_id', v_action_id,
    'action_type', p_action_type,
    'target_public_id', p_target_public_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_moderation_action(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_moderation_action(UUID, TEXT, TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. Stored Procedure: get_moderation_actions
--    Returns auditable history of moderation actions in the caller's organization.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_moderation_actions(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  action_type TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ,
  report_id UUID,
  target_public_id UUID,
  target_username CITEXT,
  target_display_name TEXT,
  moderator_public_id UUID,
  moderator_username CITEXT,
  moderator_display_name TEXT,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_org_id UUID;
  v_limit INTEGER;
  v_offset INTEGER;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: No active authenticated session';
  END IF;

  SELECT om.organization_id INTO v_caller_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_caller_id
    AND om.role IN ('admin', 'moderator')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_org_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Caller is not an active moderator or administrator';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN QUERY
  SELECT
    ma.id,
    ma.action_type,
    ma.reason,
    ma.created_at,
    ma.report_id,
    target_p.public_id AS target_public_id,
    target_p.username AS target_username,
    target_p.display_name AS target_display_name,
    mod_p.public_id AS moderator_public_id,
    mod_p.username AS moderator_username,
    mod_p.display_name AS moderator_display_name,
    ma.metadata
  FROM public.moderation_actions ma
  JOIN public.profiles mod_p ON mod_p.id = ma.moderator_id
  LEFT JOIN public.profiles target_p ON target_p.id = ma.target_user_id
  WHERE ma.organization_id = v_caller_org_id
  ORDER BY ma.created_at DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_moderation_actions(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_moderation_actions(INTEGER, INTEGER) TO authenticated;


