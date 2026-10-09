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
