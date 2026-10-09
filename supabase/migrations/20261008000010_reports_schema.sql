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
