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
