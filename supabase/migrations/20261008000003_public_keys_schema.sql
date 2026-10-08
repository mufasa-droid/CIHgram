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
