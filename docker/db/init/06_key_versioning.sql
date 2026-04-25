-- =============================================================================
-- Key versioning: tracks per-record encryption key version so that a partial
-- key rotation (interrupted before change_password commits) can be detected
-- and resumed on the next login.
--
-- Design:
--  - key_version on auth.users is the authoritative "committed" version.
--    change_password increments it atomically with the password hash update.
--  - key_version on every encrypted table tracks which key version encrypted
--    that row. Normal state: all rows match auth.users.key_version.
--  - rotation_status() RPC returns the user's key_version and whether any
--    encrypted row has a different version (indicating a partial rotation).
--  - On partial rotation: RecoveryModal fetches raw rows, identifies stale
--    (key_version < targetVersion) vs done (key_version === targetVersion),
--    re-encrypts only stale rows, then calls change_password to commit.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add key_version to all encrypted tables (DEFAULT 1 for existing rows)
-- ---------------------------------------------------------------------------

ALTER TABLE auth.users
  ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE api.bookmarks
  ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE api.tags
  ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE api.thumbnail_images
  ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 2. Rebuild bookmarks_with_tags view to expose key_version fields
--
-- NOTE: CREATE OR REPLACE VIEW requires existing columns stay in their original
-- order. key_version and thumbnail_key_version are appended at the end.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW api.bookmarks_with_tags
  WITH (security_invoker = true)
AS
  SELECT
    b.id,
    b.user_id,
    b.title_enc,
    b.url_enc,
    b.thumbnail_url_enc,
    b.created_at,
    b.updated_at,
    COALESCE(
      array_agg(bt.tag_id) FILTER (WHERE bt.tag_id IS NOT NULL),
      '{}'::UUID[]
    ) AS tag_ids,
    b.thumbnail_file_id,
    ti.original_name_enc   AS thumbnail_original_name_enc,
    b.key_version,
    ti.key_version         AS thumbnail_key_version
  FROM api.bookmarks b
  LEFT JOIN api.bookmark_tags bt    ON bt.bookmark_id = b.id
  LEFT JOIN api.thumbnail_images ti ON ti.id = b.thumbnail_file_id
  GROUP BY b.id, ti.original_name_enc, b.key_version, ti.key_version;

-- ---------------------------------------------------------------------------
-- 3. rotation_status() RPC
--    Called on every login (no args needed — identity comes from JWT).
--    Returns { key_version: N, has_stale_records: bool }.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.rotation_status()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  caller_id    UUID;
  user_version INTEGER;
  has_stale    BOOLEAN;
BEGIN
  caller_id := (current_setting('request.jwt.claims', true)::JSON->>'sub')::UUID;

  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT key_version INTO user_version
  FROM auth.users
  WHERE id = caller_id;

  -- Check for any row whose key_version differs from the user's committed version.
  -- LIMIT 1 short-circuits as soon as one mismatch is found.
  SELECT EXISTS (
    SELECT 1 FROM api.bookmarks
    WHERE user_id = caller_id AND key_version <> user_version
    UNION ALL
    SELECT 1 FROM api.tags
    WHERE user_id = caller_id AND key_version <> user_version
    UNION ALL
    SELECT 1 FROM api.thumbnail_images
    WHERE user_id = caller_id AND key_version <> user_version
    LIMIT 1
  ) INTO has_stale;

  RETURN json_build_object(
    'key_version',        user_version,
    'has_stale_records',  has_stale
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.rotation_status() TO app_user;

-- ---------------------------------------------------------------------------
-- 4. Replace change_password to also increment auth.users.key_version
--    This makes the password-hash update and version increment atomic.
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
  caller_id   UUID;
  found_user  auth.users;
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

  -- Increment key_version atomically with the password hash update.
  -- This is the commit point of a key rotation: after this succeeds, all
  -- records should already be at the new key_version. If any are not,
  -- rotation_status() will detect them on next login.
  UPDATE auth.users
  SET password    = crypt(new_password, gen_salt('bf', 13)),
      key_version = key_version + 1
  WHERE id = caller_id;
END;
$$;

GRANT EXECUTE ON FUNCTION api.change_password(TEXT, TEXT) TO app_user;
