-- =============================================================================
-- 11_jwt_audience.sql
-- Add an `aud` (audience) claim to every JWT minted by api._sign_jwt so that
-- tokens issued for the app session can be cryptographically scoped to the
-- intended consumer. Since this migration was first introduced, a second
-- sibling service (services/metadata-fetcher/) joined the email service. Both
-- share the HS256 signing secret with PostgREST, so without an audience claim
-- a session token is indistinguishable from a token meant for either API.
--
-- The mint emits an ARRAY `aud=['email-svc','metadata-svc']` so the same
-- token authenticates both backends. `jose` 6 verification treats a string
-- requested audience as set-membership against an array claim, so the email
-- service (audience: 'email-svc') and metadata-fetcher (audience:
-- 'metadata-svc') both accept the same token.
--
-- Why a single in-place file rather than a new docker/db/migrations/ tree:
-- this file lives in docker/db/init/ which is mounted read-only into the
-- running db container at /docker-entrypoint-initdb.d/. Fresh-volume
-- installs run it during init; existing volumes can re-apply it without
-- inventing a new migration tooling story by running:
--
--   docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -f /docker-entrypoint-initdb.d/11_jwt_audience.sql
--
-- BEGIN; CREATE OR REPLACE FUNCTION; COMMIT; is atomic at the catalog level
-- (PostgreSQL takes an AccessExclusiveLock on the function's pg_proc row),
-- so the migration is idempotent and safe to re-run any number of times.
--
-- Compatibility on the PostgREST side:
-- PostgREST does NOT enforce `PGRST_JWT_AUD` in our compose file (no env
-- var set), so an extra `aud` claim is silently ignored by PostgREST itself.
-- Tokens minted with the audience array continue to authenticate every
-- existing PostgREST RPC and table call — no behavior change there.
--
-- Compatibility on the per-service backends:
-- services/email/src/jwt.ts strictly verifies `aud == 'email-svc'`.
-- services/metadata-fetcher/src/jwt.ts strictly verifies `aud == 'metadata-svc'`.
-- jose 6's audience claim check is set-membership: a string audience passes
-- against an array claim that contains it. Confirmed by a regression test in
-- services/email/src/jwt.test.ts that asserts an array-claim token verifies
-- under audience: 'email-svc'.
--
-- DEPLOYMENT NOTE — NO forced re-login window:
-- The previous version of this migration introduced a forced re-login window
-- because it added an `aud` claim from scratch and pre-deploy in-flight tokens
-- had no `aud`. That window has already been paid; this revision (adding
-- `metadata-svc` to the existing array) is a pure no-op for the email service
-- (jose set-membership over `email-svc` continues to pass) and for the
-- metadata-fetcher (it has no traffic until this migration AND the new Nginx
-- route AND the new container are all deployed — the metadata-fetcher rejects
-- any traffic that arrives before the migration takes effect).
--
-- This migration is otherwise a pure no-op for any user whose JWT was
-- minted after the deploy.
-- =============================================================================

BEGIN;

-- Re-create api._sign_jwt with a multi-audience `aud` array claim. Signature
-- is unchanged (UUID, TEXT, INTEGER, BOOLEAN), so CREATE OR REPLACE updates
-- the function in place without disturbing existing grants. The REVOKE/GRANT
-- pair is re-issued defensively below in case this migration is ever applied
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
      'aud',            json_build_array('email-svc', 'metadata-svc'),
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
