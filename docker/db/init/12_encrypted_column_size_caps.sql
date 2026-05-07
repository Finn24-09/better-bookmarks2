-- =============================================================================
-- Server-side length caps on application-encrypted columns.
--
-- Defense-in-depth: the frontend caps tag names client-side
-- (MAX_TAG_LENGTH = 100 in src/lib/tags.ts) and the JSON / CSV importers cap
-- title, url, filename, and thumbnail bytes (src/lib/importJson.ts,
-- src/lib/csv.ts), but the interactive bookmark form does NOT length-cap
-- title or URL, and a malicious or compromised client can bypass any
-- client-side cap and POST/PATCH a multi-megabyte ciphertext directly
-- through PostgREST. RLS still confines the impact to the attacker's own
-- account, but the unbounded write surface lets one compromised session
-- bloat that user's storage indefinitely. These CHECK constraints bound
-- the ciphertext size at the database layer.
--
-- Each ceiling is sized to the worst-case AES-GCM ciphertext for the
-- corresponding plaintext cap, expanded by base64 (≈1.34x), with at least
-- 1.5x extra headroom. The math per column: plaintext_bytes (UTF-8 worst case
-- = 4 B/char) + 12 B IV + 16 B GCM tag, then base64 (4 × ceil(N/3)).
--
--   tags.name_enc                       4 KiB  | 100-char MAX_TAG_LENGTH
--   bookmarks.title_enc                 8 KiB  | 500-char MAX_TITLE_LENGTH (importJson)
--   bookmarks.url_enc                  16 KiB  | 2000-char MAX_URL_LENGTH (importJson)
--   bookmarks.thumbnail_url_enc        16 KiB  | same shape as url_enc
--   thumbnail_images.original_name_enc  4 KiB  | 255-char filename slice
--   thumbnail_images.data_enc           4 MiB  | ~2.1x above Nginx client_max_body_size 2M
--
-- The interactive bookmark form does NOT length-cap title or URL client-side;
-- for that path the DB caps are the only ceiling. data_enc's 4 MiB cap sits
-- above the Nginx body limit so no currently-storeable row fails validation,
-- while still bounding the DB-layer DoS surface for any future operator who
-- bypasses Nginx.
--
-- Migration shape:
--  1. ADD CONSTRAINT ... NOT VALID  → enforced on new writes immediately,
--     skips existing-row scan so a populated upgrade DB doesn't lock.
--  2. VALIDATE CONSTRAINT           → walks existing rows under a weak lock.
-- Both steps are idempotent (DO-block + pg_constraint check) so re-running
-- the file on a fresh bootstrap is a no-op.
--
-- Out of scope (per issue #23): name_hmac (fixed length by construction),
-- per-user row count quotas, write-rate limiting.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADD CONSTRAINT ... NOT VALID
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
END
$$;

-- ---------------------------------------------------------------------------
-- 2. VALIDATE CONSTRAINT
--
-- VALIDATE on an already-validated constraint is a documented no-op in
-- PostgreSQL (pg_constraint.convalidated is checked first), so the bare
-- statements below are themselves idempotent — no DO-block guard needed.
-- ---------------------------------------------------------------------------

ALTER TABLE api.tags             VALIDATE CONSTRAINT tags_name_enc_size_cap;
ALTER TABLE api.bookmarks        VALIDATE CONSTRAINT bookmarks_title_enc_size_cap;
ALTER TABLE api.bookmarks        VALIDATE CONSTRAINT bookmarks_url_enc_size_cap;
ALTER TABLE api.bookmarks        VALIDATE CONSTRAINT bookmarks_thumbnail_url_enc_size_cap;
ALTER TABLE api.thumbnail_images VALIDATE CONSTRAINT thumbnail_images_original_name_enc_size_cap;
ALTER TABLE api.thumbnail_images VALIDATE CONSTRAINT thumbnail_images_data_enc_size_cap;
