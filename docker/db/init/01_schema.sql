-- =============================================================================
-- Schema, roles, tables, and views
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
-- auth: internal tables never exposed via PostgREST
-- api:  tables exposed via PostgREST

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS api;

-- ---------------------------------------------------------------------------
-- Database roles
-- anon:      unauthenticated callers (can only call sign_up / sign_in RPCs)
-- app_user:  authenticated callers (set by PostgREST after JWT verification)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- Grant usage on schemas
GRANT USAGE ON SCHEMA api TO anon, app_user;
GRANT USAGE ON SCHEMA auth TO app_user;

-- ---------------------------------------------------------------------------
-- auth.users
-- Internal user table — NEVER exposed via PostgREST (schema = auth, not api)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  -- bcrypt hash (work factor 12) — irreversible one-way hash with built-in salt
  password    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- api.tags
-- Encrypted tag names (AES-256-GCM) with HMAC for uniqueness enforcement
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api.tags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- AES-256-GCM encrypted tag name; base64(iv || ciphertext)
  name_enc    TEXT        NOT NULL,
  -- HMAC-SHA256(plaintext_name, user_id) — deterministic, allows DB uniqueness
  -- without storing or processing the plaintext
  name_hmac   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tags_user_name_unique UNIQUE (user_id, name_hmac)
);

-- ---------------------------------------------------------------------------
-- api.bookmarks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api.bookmarks (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- All content fields are AES-256-GCM encrypted; base64(iv || ciphertext)
  title_enc           TEXT        NOT NULL,
  url_enc             TEXT        NOT NULL,
  thumbnail_url_enc   TEXT,       -- nullable; future file uploads store URL here
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- api.bookmark_tags  (junction table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api.bookmark_tags (
  bookmark_id  UUID  NOT NULL REFERENCES api.bookmarks(id) ON DELETE CASCADE,
  tag_id       UUID  NOT NULL REFERENCES api.tags(id)      ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- api.bookmarks_with_tags  (view)
-- Returns each bookmark with an array of its associated tag_ids so the
-- frontend can fetch bookmarks + their tag associations in one request.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW api.bookmarks_with_tags AS
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
    ) AS tag_ids
  FROM api.bookmarks b
  LEFT JOIN api.bookmark_tags bt ON bt.bookmark_id = b.id
  GROUP BY b.id;

-- ---------------------------------------------------------------------------
-- Grant table/view permissions to roles
-- ---------------------------------------------------------------------------

-- app_user can do full CRUD on their own rows (enforced by RLS below)
GRANT SELECT, INSERT, UPDATE, DELETE ON api.tags          TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.bookmarks     TO app_user;
GRANT SELECT, INSERT, DELETE         ON api.bookmark_tags TO app_user;
GRANT SELECT                         ON api.bookmarks_with_tags TO app_user;

-- anon cannot access data tables — only the auth RPC functions
REVOKE ALL ON api.tags          FROM anon;
REVOKE ALL ON api.bookmarks     FROM anon;
REVOKE ALL ON api.bookmark_tags FROM anon;
REVOKE ALL ON api.bookmarks_with_tags FROM anon;
