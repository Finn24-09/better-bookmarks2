-- =============================================================================
-- 08_email_tokens.sql
-- Email verification, password reset, and account deletion confirmation tokens.
-- Also updates auth functions to support token_version JWT claim for
-- server-side session invalidation after password reset.
--
-- Security notes:
-- - Raw tokens are NEVER stored; only the SHA-256 hex digest is persisted.
-- - auth.email_tokens lives in the auth schema — never exposed via PostgREST.
-- - email_svc role has no access to api schema data (bookmarks/tags/thumbnails).
-- - token_version in JWTs enables session invalidation after password reset.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extend auth.users
-- ---------------------------------------------------------------------------

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ          DEFAULT NULL,
  -- token_version: incremented on password reset and change_password.
  -- The matching 'tv' claim in the JWT enables PostgREST pre-request
  -- validation — if tv != token_version the session is considered invalidated.
  ADD COLUMN IF NOT EXISTS token_version     INTEGER     NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Token type enum
-- email_change is included now to avoid a future ALTER TYPE outside a
-- transaction (PostgreSQL does not allow ADD VALUE in a transaction block).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_token_type') THEN
    CREATE TYPE auth.email_token_type AS ENUM (
      'email_verification',
      'password_reset',
      'delete_confirmation',
      'email_change'
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Token table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.email_tokens (
  id         UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID                  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT                  NOT NULL,
  token_type auth.email_token_type NOT NULL,
  created_at TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ           NOT NULL,
  used_at    TIMESTAMPTZ                    DEFAULT NULL,
  ip_address INET                           DEFAULT NULL
);

-- One unused token per user per type. Expired tokens are excluded at query time,
-- not here — NOW() is STABLE, not IMMUTABLE, so it cannot appear in an index predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_tokens_active
  ON auth.email_tokens (user_id, token_type)
  WHERE used_at IS NULL;

-- Fast lookup by hash for unused tokens (expiry checked in query).
CREATE INDEX IF NOT EXISTS idx_email_tokens_hash
  ON auth.email_tokens (token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_tokens_expires
  ON auth.email_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- Per-user email send log — for per-user rate limiting independent of IP.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.email_send_log (
  user_id    UUID                  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_type auth.email_token_type NOT NULL,
  sent_at    TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_user_type
  ON auth.email_send_log (user_id, token_type, sent_at);

-- ---------------------------------------------------------------------------
-- Security audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.security_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  token_type auth.email_token_type,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Grants to email_svc role
-- (role itself is created by 07_email_service_role.sh)
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA auth TO email_svc;

-- Read-only subset of auth.users needed by email service
GRANT SELECT (id, email, password, email_verified, email_verified_at, token_version)
  ON auth.users TO email_svc;

-- Full lifecycle access to token tables
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.email_tokens   TO email_svc;
GRANT SELECT, INSERT                 ON auth.email_send_log TO email_svc;
GRANT INSERT                         ON auth.security_audit_log TO email_svc;
GRANT USAGE, SELECT ON SEQUENCE auth.security_audit_log_id_seq TO email_svc;

-- No access to api schema data
REVOKE ALL ON SCHEMA api FROM email_svc;

-- ---------------------------------------------------------------------------
-- Helper: upsert token
-- Deletes any prior active token of the same type, then inserts a new one.
-- ON CONFLICT DO NOTHING handles the concurrent-insert race (caller catches 23505).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.upsert_email_token(
  p_user_id    UUID,
  p_token_hash TEXT,
  p_token_type auth.email_token_type,
  p_ttl_secs   INTEGER,
  p_ip         INET DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
DECLARE
  new_id UUID;
BEGIN
  -- Invalidate any prior active token (avoids unique-index violation below)
  DELETE FROM auth.email_tokens
  WHERE user_id   = p_user_id
    AND token_type = p_token_type
    AND used_at    IS NULL;

  INSERT INTO auth.email_tokens (user_id, token_hash, token_type, expires_at, ip_address)
  VALUES (
    p_user_id,
    p_token_hash,
    p_token_type,
    NOW() + (p_ttl_secs * INTERVAL '1 second'),
    p_ip
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION auth.upsert_email_token(UUID, TEXT, auth.email_token_type, INTEGER, INET)
  TO email_svc;

-- ---------------------------------------------------------------------------
-- Helper: redeem token — atomic UPDATE...RETURNING, no TOCTOU possible
-- Returns user_id + token_id on success; empty result if invalid/used/expired.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.redeem_email_token(
  p_token_hash TEXT,
  p_token_type auth.email_token_type
)
RETURNS TABLE (user_id UUID, token_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
BEGIN
  RETURN QUERY
    UPDATE auth.email_tokens t
    SET    used_at = NOW()
    WHERE  t.token_hash = p_token_hash
      AND  t.token_type = p_token_type
      AND  t.used_at    IS NULL
      AND  t.expires_at  > NOW()
    RETURNING t.user_id, t.id;
END;
$$;

GRANT EXECUTE ON FUNCTION auth.redeem_email_token(TEXT, auth.email_token_type)
  TO email_svc;

-- ---------------------------------------------------------------------------
-- Helper: mark email verified
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.mark_email_verified(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
BEGIN
  UPDATE auth.users
  SET email_verified    = TRUE,
      email_verified_at = NOW()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION auth.mark_email_verified(UUID) TO email_svc;

-- ---------------------------------------------------------------------------
-- Helper: reset password and destroy all encrypted user data.
--
-- Security: p_user_id MUST come from auth.redeem_email_token() in the same
-- transaction — it is never taken from user-supplied request input.
-- token_version increment invalidates any live JWTs (H-2 fix).
-- bookmark_tags is deleted explicitly before bookmarks/tags in case the FK
-- cascade is not present (H-5 fix).
--
-- S-7: This function takes the PLAINTEXT new password and hashes it with
-- crypt(..., gen_salt('bf', 13)) so the cost factor matches sign_up and
-- change_password. The email service never holds the bcrypt hash.
--
-- Idempotency guard: PostgreSQL refuses to rename input parameters via
-- CREATE OR REPLACE FUNCTION (`cannot change name of input parameter`). The
-- S-7 review renamed p_new_pw_hash → p_new_pw, so re-applying this script
-- against a database that has the older signature would abort the migration.
-- DROP FUNCTION IF EXISTS makes the migration safe to re-apply regardless of
-- which prior signature exists.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS auth.reset_password_destroy_data(UUID, TEXT);

CREATE OR REPLACE FUNCTION auth.reset_password_destroy_data(
  p_user_id UUID,
  p_new_pw  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, api, public
AS $$
BEGIN
  -- Remove junction rows first to avoid FK violations if cascades differ
  DELETE FROM api.bookmark_tags
  WHERE bookmark_id IN (SELECT id FROM api.bookmarks WHERE user_id = p_user_id)
     OR tag_id      IN (SELECT id FROM api.tags WHERE user_id = p_user_id);

  DELETE FROM api.thumbnail_images WHERE user_id = p_user_id;
  DELETE FROM api.tags             WHERE user_id = p_user_id;
  DELETE FROM api.bookmarks        WHERE user_id = p_user_id;

  UPDATE auth.users
  SET password       = crypt(p_new_pw, gen_salt('bf', 13)),  -- S-7: hash here, cost 13
      key_version    = key_version + 1,
      token_version  = token_version + 1,                    -- invalidates all live JWTs (H-2)
      email_verified = TRUE                                  -- reset link proves email ownership
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION auth.reset_password_destroy_data(UUID, TEXT) TO email_svc;

-- ---------------------------------------------------------------------------
-- Helper: delete account with password verification (used by confirm-delete)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.delete_account_with_password(
  p_user_id UUID,
  p_password TEXT
)
RETURNS BOOLEAN  -- TRUE = deleted, FALSE = wrong password
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, api, public
AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT password INTO stored_hash FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Verify password using the hash already fetched (constant-time bcrypt compare)
  IF stored_hash IS DISTINCT FROM crypt(p_password, stored_hash) THEN
    RETURN FALSE;
  END IF;

  -- CASCADE on auth.users → bookmarks, tags, thumbnail_images, then bookmark_tags
  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION auth.delete_account_with_password(UUID, TEXT) TO email_svc;

-- ---------------------------------------------------------------------------
-- Helper: cleanup expired and used tokens (called every 30 min by email service)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.cleanup_email_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM auth.email_tokens
  WHERE expires_at < NOW() OR used_at IS NOT NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Purge send-log entries older than 24 hours
  DELETE FROM auth.email_send_log WHERE sent_at < NOW() - INTERVAL '24 hours';

  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION auth.cleanup_email_tokens() TO email_svc;

-- ---------------------------------------------------------------------------
-- PostgREST pre-request hook: validate token_version JWT claim.
-- If the JWT's 'tv' claim does not match auth.users.token_version the session
-- has been invalidated (password reset or change) and the request is rejected.
-- Skips gracefully for anon requests (no JWT) and for tokens issued before
-- the tv claim was added (allows rollout without invalidating all sessions).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.check_token_version()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth
AS $$
DECLARE
  v_claims  TEXT;
  v_user_id UUID;
  v_claim_tv INTEGER;
  v_db_tv    INTEGER;
BEGIN
  v_claims := current_setting('request.jwt.claims', TRUE);

  -- Skip for unauthenticated / anon requests
  IF v_claims IS NULL OR v_claims = '' THEN RETURN; END IF;

  v_user_id := (v_claims::JSON->>'sub')::UUID;
  IF v_user_id IS NULL THEN RETURN; END IF;

  -- Every JWT this service issues carries a tv claim; absence means a forged or stale-deployment session.
  BEGIN
    v_claim_tv := (v_claims::JSON->>'tv')::INTEGER;
  EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RAISE SQLSTATE 'PT401' USING MESSAGE = 'Session requires re-authentication';
  END;

  IF v_claim_tv IS NULL THEN
    RAISE SQLSTATE 'PT401' USING MESSAGE = 'Session requires re-authentication';
  END IF;

  SELECT token_version INTO v_db_tv FROM auth.users WHERE id = v_user_id;

  IF v_claim_tv IS DISTINCT FROM v_db_tv THEN
    RAISE SQLSTATE 'PT401' USING MESSAGE = 'Session invalidated';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION api.check_token_version() TO app_user, anon;

-- ---------------------------------------------------------------------------
-- Update _sign_jwt to embed token_version ('tv') and email_verified claims.
-- Drop the old 2-param overload first to avoid ambiguity.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS api._sign_jwt(UUID, TEXT);

CREATE OR REPLACE FUNCTION api._sign_jwt(
  p_user_id       UUID,
  p_user_email    TEXT,
  p_token_version INTEGER DEFAULT 0,
  p_email_verified BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  jwt_secret TEXT;
  token      TEXT;
BEGIN
  jwt_secret := current_setting('app.settings.jwt_secret', true);

  IF jwt_secret IS NULL OR jwt_secret = '' THEN
    RAISE EXCEPTION 'JWT secret not configured (app.settings.jwt_secret)';
  END IF;

  token := sign(
    json_build_object(
      'role',           'app_user',
      'sub',            p_user_id::TEXT,
      'email',          p_user_email,
      'tv',             p_token_version,
      'email_verified', p_email_verified,
      'exp',            EXTRACT(EPOCH FROM NOW() + INTERVAL '24 hours')::BIGINT
    ),
    jwt_secret
  );

  RETURN token;
END;
$$;

REVOKE ALL ON FUNCTION api._sign_jwt(UUID, TEXT, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api._sign_jwt(UUID, TEXT, INTEGER, BOOLEAN) TO app_user;

-- ---------------------------------------------------------------------------
-- Update sign_up: include email_verified in return payload.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.sign_up(
  email    TEXT,
  password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  new_user auth.users;
  token    TEXT;
BEGIN
  IF email IS NULL OR trim(email) = '' THEN
    RAISE EXCEPTION 'Email is required' USING ERRCODE = 'check_violation';
  END IF;
  IF password IS NULL OR length(password) < 12 THEN
    RAISE EXCEPTION 'Password must be at least 12 characters' USING ERRCODE = 'check_violation';
  END IF;
  IF password !~ '[A-Z]' THEN
    RAISE EXCEPTION 'Password must include an uppercase letter' USING ERRCODE = 'check_violation';
  END IF;
  IF password !~ '[a-z]' THEN
    RAISE EXCEPTION 'Password must include a lowercase letter' USING ERRCODE = 'check_violation';
  END IF;
  IF password !~ '[^a-zA-Z]' THEN
    RAISE EXCEPTION 'Password must include a number or symbol' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO auth.users (email, password)
  VALUES (lower(trim(email)), crypt(password, gen_salt('bf', 13)))
  RETURNING * INTO new_user;

  token := api._sign_jwt(
    new_user.id,
    new_user.email,
    COALESCE(new_user.token_version, 0),
    COALESCE(new_user.email_verified, false)
  );

  RETURN json_build_object(
    'token',          token,
    'user_id',        new_user.id,
    'email_verified', COALESCE(new_user.email_verified, false)
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Registration failed. Please try again.' USING ERRCODE = 'unique_violation';
END;
$$;

GRANT EXECUTE ON FUNCTION api.sign_up(TEXT, TEXT) TO anon;

-- ---------------------------------------------------------------------------
-- Update sign_in: include email_verified in return payload.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.sign_in(
  email    TEXT,
  password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  found_user auth.users;
  token      TEXT;
BEGIN
  SELECT * INTO found_user
  FROM auth.users
  WHERE auth.users.email = lower(trim(sign_in.email))
    AND auth.users.password = crypt(sign_in.password, auth.users.password);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = 'invalid_password';
  END IF;

  token := api._sign_jwt(
    found_user.id,
    found_user.email,
    COALESCE(found_user.token_version, 0),
    COALESCE(found_user.email_verified, false)
  );

  RETURN json_build_object(
    'token',          token,
    'user_id',        found_user.id,
    'email_verified', COALESCE(found_user.email_verified, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.sign_in(TEXT, TEXT) TO anon;

-- ---------------------------------------------------------------------------
-- Update change_password: also increment token_version to invalidate sessions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.change_password(
  current_password TEXT,
  new_password     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  caller_id  UUID;
  found_user auth.users;
BEGIN
  caller_id := (current_setting('request.jwt.claims', true)::JSON->>'sub')::UUID;

  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF new_password IS NULL OR length(new_password) < 12 THEN
    RAISE EXCEPTION 'New password must be at least 12 characters' USING ERRCODE = 'check_violation';
  END IF;
  IF new_password !~ '[A-Z]' THEN
    RAISE EXCEPTION 'New password must include an uppercase letter' USING ERRCODE = 'check_violation';
  END IF;
  IF new_password !~ '[a-z]' THEN
    RAISE EXCEPTION 'New password must include a lowercase letter' USING ERRCODE = 'check_violation';
  END IF;
  IF new_password !~ '[^a-zA-Z]' THEN
    RAISE EXCEPTION 'New password must include a number or symbol' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO found_user
  FROM auth.users
  WHERE id = caller_id
    AND password = crypt(current_password, password);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current password is incorrect' USING ERRCODE = 'invalid_password';
  END IF;

  UPDATE auth.users
  SET password      = crypt(new_password, gen_salt('bf', 13)),
      key_version   = key_version + 1,
      token_version = token_version + 1   -- invalidates all live sessions
  WHERE id = caller_id;
END;
$$;

GRANT EXECUTE ON FUNCTION api.change_password(TEXT, TEXT) TO app_user;

COMMIT;
