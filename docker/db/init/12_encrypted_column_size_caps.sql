-- =============================================================================
-- Server-side length caps on application-encrypted columns.
--
-- Defense-in-depth: the frontend caps every plaintext field client-side
-- (MAX_TAG_LENGTH in src/lib/tags.ts; MAX_TITLE_LENGTH and MAX_URL_LENGTH
-- in src/lib/bookmarks.ts, consumed by BookmarkFormModal.tsx and the
-- JSON / CSV importers in src/lib/importJson.ts and src/lib/csv.ts), but
-- a malicious or compromised client can bypass any client-side cap and
-- POST/PATCH a multi-megabyte ciphertext directly through PostgREST.
-- RLS still confines the impact to the attacker's own account, but the
-- unbounded write surface lets one compromised session bloat that user's
-- storage indefinitely. These CHECK constraints bound the ciphertext size
-- at the database layer — the authoritative gate for any client that
-- ignores or bypasses the frontend validators.
--
-- Five of the six ceilings are sized to the worst-case AES-GCM ciphertext
-- for the corresponding plaintext cap, expanded by base64 (≈1.34x), with at
-- least 1.5x headroom. The math per text-field column: plaintext_bytes (UTF-8
-- worst case = 4 B/char) + 12 B IV + 16 B GCM tag, then base64 (4 × ceil(N/3)).
-- thumbnail_images.data_enc is binary, not character-bounded — its 4 MiB
-- ceiling is sized against the Nginx 2 MiB body cap (~2.1x headroom) so any
-- legitimately uploaded thumbnail validates and the DB-layer cap purely
-- backstops a hypothetical bypass of the network limit.
--
--   tags.name_enc                       4 KiB  | 100-char MAX_TAG_LENGTH
--   bookmarks.title_enc                 8 KiB  | 500-char MAX_TITLE_LENGTH (importJson)
--   bookmarks.url_enc                  16 KiB  | 2000-char MAX_URL_LENGTH (importJson)
--   bookmarks.thumbnail_url_enc        16 KiB  | same shape as url_enc
--   thumbnail_images.original_name_enc  4 KiB  | 255-char filename slice
--   thumbnail_images.data_enc           4 MiB  | ~2.1x above Nginx client_max_body_size 2M
--
-- The interactive bookmark form length-caps title and URL client-side via
-- react-hook-form maxLength validators (BookmarkFormModal.tsx); the DB caps
-- below are the authoritative gate for any client that bypasses the form.
-- data_enc's 4 MiB cap sits above the Nginx 2 MiB body limit so no
-- currently-storeable row fails validation, while still bounding the
-- DB-layer DoS surface for any future operator who bypasses Nginx.
--
-- Migration shape:
--  1. ADD CONSTRAINT ... NOT VALID  → enforced on new writes immediately,
--     skips existing-row scan so a populated upgrade DB doesn't lock. Each
--     constraint wrapped in its own DO-block + pg_constraint guard so a
--     transient failure on one (e.g. lock timeout) doesn't roll back the
--     others; idempotent across re-runs.
--  2. VALIDATE CONSTRAINT           → walks existing rows under a weak lock.
--     Wrapped per-constraint in a DO-block with EXCEPTION WHEN check_violation
--     so a single oversized legacy row emits a WARNING rather than aborting
--     the entire migration. Each block is independently idempotent: VALIDATE
--     on an already-validated constraint is a documented no-op, and a
--     constraint left NOT VALID is retried on the next file run.
--
-- Out of scope (per issue #23): name_hmac (fixed length by construction),
-- per-user row count quotas, write-rate limiting.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADD CONSTRAINT ... NOT VALID (per-constraint, idempotent)
--
-- Each constraint sits in its own DO-block guarded by a pg_constraint lookup,
-- so a transient failure on one (e.g. lock timeout, disk pressure) does not
-- roll back constraints that already succeeded earlier in the file. Re-running
-- the file picks up where the previous run left off.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'tags_name_enc_size_cap'
      AND n.nspname = 'api' AND t.relname = 'tags'
  ) THEN
    ALTER TABLE api.tags
      ADD CONSTRAINT tags_name_enc_size_cap
      CHECK (octet_length(name_enc) <= 4096) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'bookmarks_title_enc_size_cap'
      AND n.nspname = 'api' AND t.relname = 'bookmarks'
  ) THEN
    ALTER TABLE api.bookmarks
      ADD CONSTRAINT bookmarks_title_enc_size_cap
      CHECK (octet_length(title_enc) <= 8192) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'bookmarks_url_enc_size_cap'
      AND n.nspname = 'api' AND t.relname = 'bookmarks'
  ) THEN
    ALTER TABLE api.bookmarks
      ADD CONSTRAINT bookmarks_url_enc_size_cap
      CHECK (octet_length(url_enc) <= 16384) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'bookmarks_thumbnail_url_enc_size_cap'
      AND n.nspname = 'api' AND t.relname = 'bookmarks'
  ) THEN
    -- thumbnail_url_enc is the only nullable encrypted column, but no NULL
    -- guard is needed: octet_length(NULL) is NULL, and a CHECK that evaluates
    -- to NULL passes (constraints reject only on FALSE). Keeping the
    -- expression uniform with the other five constraints makes auditing easier.
    ALTER TABLE api.bookmarks
      ADD CONSTRAINT bookmarks_thumbnail_url_enc_size_cap
      CHECK (octet_length(thumbnail_url_enc) <= 16384) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'thumbnail_images_original_name_enc_size_cap'
      AND n.nspname = 'api' AND t.relname = 'thumbnail_images'
  ) THEN
    ALTER TABLE api.thumbnail_images
      ADD CONSTRAINT thumbnail_images_original_name_enc_size_cap
      CHECK (octet_length(original_name_enc) <= 4096) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'thumbnail_images_data_enc_size_cap'
      AND n.nspname = 'api' AND t.relname = 'thumbnail_images'
  ) THEN
    ALTER TABLE api.thumbnail_images
      ADD CONSTRAINT thumbnail_images_data_enc_size_cap
      CHECK (octet_length(data_enc) <= 4194304) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. VALIDATE CONSTRAINT (per-constraint, exception-tolerant)
--
-- Each block walks existing rows under a weak lock. On a populated upgrade
-- DB, if any pre-existing row violates a cap (e.g. a row written through a
-- non-cap-enforcing path or by direct SQL), a bare VALIDATE would raise
-- check_violation and abort the migration mid-way under ON_ERROR_STOP=1.
-- We catch the exception per-constraint so the operator sees a WARNING,
-- the file completes, and the constraint stays NOT VALID -- which still
-- enforces the cap on NEW writes; only the existing-row scan is skipped.
--
-- Each block also catches undefined_object so a partially-applied prior run
-- (where ADD CONSTRAINT failed for that constraint, leaving it absent when
-- VALIDATE attempts to run) emits a WARNING instead of aborting; the
-- operator can re-run the file to retry the ADD step.
--
-- VALIDATE on an already-validated constraint is a documented no-op
-- (pg_constraint.convalidated is checked first), so each block is itself
-- idempotent: re-running the file after data cleanup retries VALIDATE for
-- any constraint still NOT VALID.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE api.tags VALIDATE CONSTRAINT tags_name_enc_size_cap;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'tags_name_enc_size_cap left NOT VALID -- existing oversized name_enc row(s); clean up and re-run migration';
  WHEN undefined_object THEN
    RAISE WARNING 'tags_name_enc_size_cap not found at VALIDATE time -- ADD CONSTRAINT did not complete or constraint was dropped; re-run migration to retry';
END $$;

DO $$ BEGIN
  ALTER TABLE api.bookmarks VALIDATE CONSTRAINT bookmarks_title_enc_size_cap;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'bookmarks_title_enc_size_cap left NOT VALID -- existing oversized title_enc row(s); clean up and re-run migration';
  WHEN undefined_object THEN
    RAISE WARNING 'bookmarks_title_enc_size_cap not found at VALIDATE time -- ADD CONSTRAINT did not complete or constraint was dropped; re-run migration to retry';
END $$;

DO $$ BEGIN
  ALTER TABLE api.bookmarks VALIDATE CONSTRAINT bookmarks_url_enc_size_cap;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'bookmarks_url_enc_size_cap left NOT VALID -- existing oversized url_enc row(s); clean up and re-run migration';
  WHEN undefined_object THEN
    RAISE WARNING 'bookmarks_url_enc_size_cap not found at VALIDATE time -- ADD CONSTRAINT did not complete or constraint was dropped; re-run migration to retry';
END $$;

DO $$ BEGIN
  ALTER TABLE api.bookmarks VALIDATE CONSTRAINT bookmarks_thumbnail_url_enc_size_cap;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'bookmarks_thumbnail_url_enc_size_cap left NOT VALID -- existing oversized thumbnail_url_enc row(s); clean up and re-run migration';
  WHEN undefined_object THEN
    RAISE WARNING 'bookmarks_thumbnail_url_enc_size_cap not found at VALIDATE time -- ADD CONSTRAINT did not complete or constraint was dropped; re-run migration to retry';
END $$;

DO $$ BEGIN
  ALTER TABLE api.thumbnail_images VALIDATE CONSTRAINT thumbnail_images_original_name_enc_size_cap;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'thumbnail_images_original_name_enc_size_cap left NOT VALID -- existing oversized original_name_enc row(s); clean up and re-run migration';
  WHEN undefined_object THEN
    RAISE WARNING 'thumbnail_images_original_name_enc_size_cap not found at VALIDATE time -- ADD CONSTRAINT did not complete or constraint was dropped; re-run migration to retry';
END $$;

DO $$ BEGIN
  ALTER TABLE api.thumbnail_images VALIDATE CONSTRAINT thumbnail_images_data_enc_size_cap;
EXCEPTION
  WHEN check_violation THEN
    RAISE WARNING 'thumbnail_images_data_enc_size_cap left NOT VALID -- existing oversized data_enc row(s); clean up and re-run migration';
  WHEN undefined_object THEN
    RAISE WARNING 'thumbnail_images_data_enc_size_cap not found at VALIDATE time -- ADD CONSTRAINT did not complete or constraint was dropped; re-run migration to retry';
END $$;
