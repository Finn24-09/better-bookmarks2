-- =============================================================================
-- Stamp new encrypted records with the owner's committed key_version (#135).
--
-- 06_key_versioning.sql added key_version to the three encrypted tables with a
-- constant DEFAULT 1 and nothing overrode it: the frontend deliberately never
-- sends key_version on create, because it is rotation-integrity state rather
-- than user data. Every row inserted after an account's auth.users.key_version
-- had advanced past 1 was therefore born mislabelled as pre-rotation
-- ciphertext, api.rotation_status() reported has_stale_records on every
-- subsequent login, and App.tsx pinned the whole session to RecoveryModal with
-- no dismiss path. Completing that recovery increments key_version again, so
-- the next record recreated the trap; the only other exit is the
-- forgot-password flow, and auth.reset_password_destroy_data() deletes the
-- user's entire library.
--
-- The ciphertext was never damaged — a mislabelled row is encrypted with the
-- account's current key and only the version label is wrong. That is what
-- makes the backfill below a metadata-only repair.
--
-- Invariant encoded here: key_version records WHICH KEY encrypted this row, so
-- a row created now must carry the owner's currently committed key_version,
-- resolved server-side from the verified JWT and never taken from the body.
--
-- Idempotent and safe to re-run. /docker-entrypoint-initdb.d/ executes only on
-- an empty volume, so existing deployments apply this by hand:
--   docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -f /docker-entrypoint-initdb.d/13_key_version_stamp.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Trigger function
--
-- Lives in auth rather than api: PostgREST exposes every function in its
-- configured schema (api) as an RPC endpoint, and a SECURITY DEFINER helper
-- that reads auth.users has no business being reachable over HTTP.
--
-- SECURITY DEFINER is required — 01_schema.sql grants app_user USAGE on the
-- auth schema but no SELECT on auth.users. search_path is pinned so the
-- definer's rights cannot be redirected through an attacker-created schema.
--
-- The claims guard mirrors api.check_token_version (08_email_tokens.sql) because
-- PostgREST sets request.jwt.claims to the empty string on anonymous requests,
-- and ''::JSON raises invalid_text_representation.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.stamp_key_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, api, public
AS $$
DECLARE
  v_claims       TEXT;
  caller_id      UUID;
  caller_version INTEGER;
BEGIN
  v_claims := current_setting('request.jwt.claims', TRUE);

  -- No verified JWT: not a PostgREST request. Superuser maintenance paths
  -- (pg_restore data loads, operator repairs) keep the value they supplied.
  -- An application INSERT can never reach this branch: the RLS WITH CHECK on
  -- all three tables is `user_id = api.current_user_id()`, which is NULL — and
  -- therefore not true — without claims, so the row would be rejected anyway.
  IF v_claims IS NULL OR v_claims = '' THEN
    RETURN NEW;
  END IF;

  caller_id := (v_claims::JSON->>'sub')::UUID;
  IF caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.key_version INTO caller_version
  FROM auth.users u
  WHERE u.id = caller_id;

  -- Overwrite unconditionally rather than filling in only when the client
  -- omitted the column: key_version is rotation-integrity state and a client
  -- must not be able to choose it. Any value in the POST body is discarded.
  --
  -- Left untouched when the caller has no auth.users row, so a NOT NULL
  -- violation never masks the real error — the FK on user_id (REFERENCES
  -- auth.users(id)) rejects that row a moment later.
  IF caller_version IS NOT NULL THEN
    NEW.key_version := caller_version;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger functions are invoked by the trigger machinery, never called
-- directly, so no role needs EXECUTE. Revoking from PUBLIC keeps a SECURITY
-- DEFINER function that reads auth.users off every role's reachable surface.
REVOKE ALL ON FUNCTION auth.stamp_key_version() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. BEFORE INSERT triggers
--
-- INSERT only, deliberately. UPDATE is how a key rotation commits:
-- reencryptBookmark, reencryptTag and the thumbnail PATCH in
-- ChangePasswordModal / RecoveryModal each send key_version = targetVersion
-- explicitly, and a trigger on UPDATE would overwrite exactly that.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS bookmarks_stamp_key_version ON api.bookmarks;
CREATE TRIGGER bookmarks_stamp_key_version
  BEFORE INSERT ON api.bookmarks
  FOR EACH ROW EXECUTE FUNCTION auth.stamp_key_version();

DROP TRIGGER IF EXISTS tags_stamp_key_version ON api.tags;
CREATE TRIGGER tags_stamp_key_version
  BEFORE INSERT ON api.tags
  FOR EACH ROW EXECUTE FUNCTION auth.stamp_key_version();

DROP TRIGGER IF EXISTS thumbnail_images_stamp_key_version ON api.thumbnail_images;
CREATE TRIGGER thumbnail_images_stamp_key_version
  BEFORE INSERT ON api.thumbnail_images
  FOR EACH ROW EXECUTE FUNCTION auth.stamp_key_version();

-- ---------------------------------------------------------------------------
-- 3. Repair records the pre-fix code already mislabelled
--
-- Only rows BEHIND the owner's committed version are restamped, and the
-- distinction matters:
--
--  * BEHIND can only come from this bug. Every completed rotation
--    (ChangePasswordModal, RecoveryModal) re-encrypts and restamps every row
--    the account owns before change_password commits, so nothing is left
--    behind at commit time. Such a row is encrypted with the account's current
--    key and only its label is wrong — this UPDATE touches no ciphertext.
--
--  * AHEAD is the genuine interrupted-rotation signal: ciphertext already
--    re-encrypted under the new key while change_password never committed.
--    Restamping those would hide real stale ciphertext from rotation_status()
--    and strand it with no recovery path, so they are deliberately untouched
--    and RecoveryModal still fires for the accounts that need it.
--
-- Exposed as a function rather than inline SQL so the pgTAP suite exercises
-- the shipped code instead of a copy of it, and so operators can re-run it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.backfill_key_version()
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  n_bookmarks INTEGER;
  n_tags      INTEGER;
  n_thumbs    INTEGER;
BEGIN
  UPDATE api.bookmarks b
  SET key_version = u.key_version
  FROM auth.users u
  WHERE u.id = b.user_id
    AND b.key_version < u.key_version;
  GET DIAGNOSTICS n_bookmarks = ROW_COUNT;

  UPDATE api.tags t
  SET key_version = u.key_version
  FROM auth.users u
  WHERE u.id = t.user_id
    AND t.key_version < u.key_version;
  GET DIAGNOSTICS n_tags = ROW_COUNT;

  UPDATE api.thumbnail_images ti
  SET key_version = u.key_version
  FROM auth.users u
  WHERE u.id = ti.user_id
    AND ti.key_version < u.key_version;
  GET DIAGNOSTICS n_thumbs = ROW_COUNT;

  RETURN json_build_object(
    'bookmarks',        n_bookmarks,
    'tags',             n_tags,
    'thumbnail_images', n_thumbs
  );
END;
$$;

-- Not SECURITY DEFINER: this runs as the migration's superuser, and no
-- application role should ever be able to rewrite rotation state in bulk.
REVOKE ALL ON FUNCTION auth.backfill_key_version() FROM PUBLIC;

DO $$
DECLARE
  result JSON;
BEGIN
  result := auth.backfill_key_version();
  RAISE NOTICE 'key_version backfill: % bookmarks, % tags, % thumbnail_images restamped',
    result->>'bookmarks', result->>'tags', result->>'thumbnail_images';
END;
$$;

COMMIT;
