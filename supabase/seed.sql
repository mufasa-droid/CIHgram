-- ==============================================================================
-- DEVELOPMENT SEED DATA ONLY (Local Development / Supabase CLI)
-- ==============================================================================
-- WARNING: DO NOT RUN THIS IN PRODUCTION.
-- In production, organizations must be provisioned with explicit verified enterprise domains.
-- This seed is used solely by `supabase db reset` for local development testing.
-- ==============================================================================

-- Seed default development organization with explicit development test domains.
-- All domains pass validate_allowed_domains check constraints.
INSERT INTO public.organizations (name, slug, allowed_domains)
VALUES (
  'CIH Platform (Development)',
  'cih-dev',
  ARRAY['gmail.com', 'example.com', 'test.com', 'cih.org']
)
ON CONFLICT (slug) DO UPDATE
SET allowed_domains = EXCLUDED.allowed_domains;
