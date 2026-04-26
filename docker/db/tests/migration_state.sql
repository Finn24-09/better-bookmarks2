-- =============================================================================
-- pgTAP unit tests — migration applied state.
--
-- Run with:   docker compose run --rm test
--
-- These tests guard against the failure mode where a stale db_data volume
-- bypasses /docker-entrypoint-initdb.d (which only runs on an empty volume).
-- If any of these assertions fail, the running database is missing critical
-- schema introduced by 07_email_service_role.sh, 08_email_tokens.sql, or
-- 09_drop_legacy_delete.sql, and the user must run the recovery script
-- documented at scripts/recover_email_tokens_migration.sql.
--
-- Symptom of a stale volume: every PostgREST request (including the anonymous
-- /rpc/sign_up call) returns HTTP 404 with
--   {"code":"42883","message":"function api.check_token_version() does not exist"}
-- because PGRST_DB_PRE_REQUEST is configured to api.check_token_version and
-- the function does not exist.
--
-- These tests are pure schema introspection — no setup data needed, so they
-- run independently of tests.sql and stay green even if the main suite hits
-- an unrelated failure.
-- =============================================================================

BEGIN;

SELECT plan(8);

-- --- Test 1: api.check_token_version() exists ---
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'api'
      AND p.proname = 'check_token_version'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ),
  'migration: api.check_token_version() exists (PGRST_DB_PRE_REQUEST hook)'
);

-- --- Test 2: api.check_token_version() returns cleanly for anon (no JWT) ---
-- Empty/NULL claims → early RETURN. Emulates PostgREST invoking the hook for
-- anonymous /rpc/sign_up calls.
SELECT lives_ok(
  $q$ SELECT set_config('request.jwt.claims', '', true);
      SELECT api.check_token_version(); $q$,
  'migration: check_token_version() returns cleanly for anon (no JWT)'
);

-- --- Test 2a: tv-less JWT is rejected post-cutover (M-2) ---
SELECT throws_ok(
  $q$ SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"app_user"}', true);
      SELECT api.check_token_version(); $q$,
  'PT401',
  'Session requires re-authentication',
  'migration: check_token_version() rejects JWT without tv claim'
);

-- --- Test 2b: JWT with explicit null tv is rejected post-cutover (M-2) ---
SELECT throws_ok(
  $q$ SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","tv":null}', true);
      SELECT api.check_token_version(); $q$,
  'PT401',
  'Session requires re-authentication',
  'migration: check_token_version() rejects JWT with null tv claim'
);

-- --- Test 2c: claims missing sub continue to skip silently (regression guard) ---
SELECT lives_ok(
  $q$ SELECT set_config('request.jwt.claims', '{"tv":1}', true);
      SELECT api.check_token_version(); $q$,
  'migration: check_token_version() returns cleanly when sub claim is absent'
);

-- --- Test 3: auth.reset_password_destroy_data(UUID, TEXT) exists with email_svc grant ---
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth'
      AND p.proname = 'reset_password_destroy_data'
      AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_new_pw text'
      AND has_function_privilege('email_svc', p.oid, 'EXECUTE')
  ),
  'migration: auth.reset_password_destroy_data(UUID, TEXT) exists and is granted to email_svc'
);

-- --- Test 4: email_svc role exists (created by 07_email_service_role.sh) ---
SELECT ok(
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'email_svc'),
  'migration: email_svc role exists'
);

-- --- Test 5: api.delete_account(text) is gone (09_drop_legacy_delete.sql) ---
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'api'
      AND p.proname = 'delete_account'
  ),
  'migration: api.delete_account() removed (email-confirmed deletion is the only path)'
);

SELECT * FROM finish();

ROLLBACK;
