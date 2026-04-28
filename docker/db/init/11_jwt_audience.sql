-- =============================================================================
-- 11_jwt_audience.sql
-- Add an `aud` (audience) claim to every JWT minted by api._sign_jwt so that
-- tokens issued for the app session can be cryptographically scoped to the
-- intended consumer. Specifically, the email service (services/email/) needs
-- a way to reject any JWT that PostgREST minted for itself but which is
-- replayed against the email service's privileged routes — they share the
-- HS256 signing secret, so without an audience claim a session token is
-- indistinguishable from a token meant for the email API.
--
-- Why a new file rather than editing 08_email_tokens.sql:
-- The init scripts in docker/db/init/ are versioned incrementally (07, 08,
-- 09, 10 already exist; this is 11). Each migration is committed independently
-- and applied in lexical order by the postgres:16-alpine entrypoint on fresh
-- init. Re-touching 08 would muddy the audit trail of what changed when, and
-- would re-issue the function under the same migration version even though
-- the semantics changed in a follow-up.
--
-- Compatibility on the PostgREST side:
-- PostgREST does NOT enforce `PGRST_JWT_AUD` in our compose file (no env
-- var set), so an extra `aud` claim is silently ignored by PostgREST itself.
-- Tokens minted with `aud='email-svc'` continue to authenticate every
-- existing PostgREST RPC and table call — no behavior change there.
--
-- Compatibility on the email-service side:
-- services/email/src/jwt.ts strictly verifies `aud == 'email-svc'`. Once
-- this migration is applied, every freshly minted JWT carries the right
-- audience and is accepted by both PostgREST and the email service.
--
-- DEPLOYMENT NOTE — forced re-login window (mirrors the tv=0 precedent in
-- 08_email_tokens.sql):
-- JWTs that were already in flight when this migration is applied have NO
-- `aud` claim. They will continue to pass PostgREST verification (PostgREST
-- ignores `aud` here) but will FAIL strict verification at the email
-- service. A user whose JWT was issued before the deploy and who hits
-- /resend-verification, /request-delete, /confirm-delete, or
-- /notify-password-change inside the JWT's 24-hour TTL will see a 401 and
-- must re-authenticate. After that the new JWT carries `aud=email-svc` and
-- everything works. This is the same shape of one-time forced re-login as
-- the tv=0 rollout window — it self-heals within 24 hours and is the
-- intended outcome. Do NOT respond by rolling this back.
--
-- This migration is otherwise a pure no-op for any user whose JWT was
-- minted after the deploy.
-- =============================================================================

BEGIN;

-- Re-create api._sign_jwt with an extra `aud` claim. Signature is unchanged
-- (UUID, TEXT, INTEGER, BOOLEAN), so CREATE OR REPLACE updates the function
-- in place without disturbing existing grants. The REVOKE/GRANT pair is
-- re-issued defensively below in case this migration is ever applied
-- against a fresh database where the prior 08-defined function has been
-- replaced wholesale rather than altered.

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
      'aud',            'email-svc',
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

COMMIT;
