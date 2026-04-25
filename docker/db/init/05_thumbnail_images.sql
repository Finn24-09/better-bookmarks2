-- =============================================================================
-- Thumbnail image storage: encrypted binary blobs for uploaded thumbnails.
--
-- Design:
--  - Images are compressed client-side (max 480×270 px, JPEG 0.75) before
--    encryption, keeping stored sizes small (~40–100 KB as base64 text).
--  - All content is AES-256-GCM encrypted; the server never sees plaintext.
--  - A FK from api.bookmarks references this table; SET NULL on image delete
--    so the bookmark survives if an image is cleaned up independently.
--  - CASCADE on user_id FK ensures images are removed with the account.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- New table: api.thumbnail_images
-- ---------------------------------------------------------------------------

CREATE TABLE api.thumbnail_images (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- base64(iv || AES-256-GCM(imageBytes))
  data_enc          TEXT        NOT NULL,
  -- base64(iv || AES-256-GCM(originalFilename))
  original_name_enc TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Add thumbnail_file_id FK to api.bookmarks
-- ---------------------------------------------------------------------------

ALTER TABLE api.bookmarks
  ADD COLUMN thumbnail_file_id UUID
    REFERENCES api.thumbnail_images(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Recreate view to include new columns
-- ---------------------------------------------------------------------------

-- NOTE: CREATE OR REPLACE VIEW requires existing columns stay in their original
-- order; new columns may only be appended at the end. thumbnail_file_id and
-- thumbnail_original_name_enc are therefore placed after tag_ids.
-- security_invoker = true: see 01_schema.sql for explanation.
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
    ti.original_name_enc AS thumbnail_original_name_enc
  FROM api.bookmarks b
  LEFT JOIN api.bookmark_tags bt ON bt.bookmark_id = b.id
  LEFT JOIN api.thumbnail_images ti ON ti.id = b.thumbnail_file_id
  GROUP BY b.id, ti.original_name_enc;

-- ---------------------------------------------------------------------------
-- RLS for api.thumbnail_images
-- ---------------------------------------------------------------------------

ALTER TABLE api.thumbnail_images ENABLE ROW LEVEL SECURITY;

-- Users may only read their own images
CREATE POLICY thumb_select ON api.thumbnail_images
  FOR SELECT TO app_user
  USING (user_id = api.current_user_id());

-- Users may only insert rows for themselves
CREATE POLICY thumb_insert ON api.thumbnail_images
  FOR INSERT TO app_user
  WITH CHECK (user_id = api.current_user_id());

-- Users may delete their own images
CREATE POLICY thumb_delete ON api.thumbnail_images
  FOR DELETE TO app_user
  USING (user_id = api.current_user_id());

-- UPDATE policy: required for key rotation (reencryptThumbnail PATCHes data_enc + original_name_enc).
-- Users may only update their own images.
CREATE POLICY thumb_update ON api.thumbnail_images
  FOR UPDATE TO app_user
  USING  (user_id = api.current_user_id())
  WITH CHECK (user_id = api.current_user_id());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON api.thumbnail_images TO app_user;
REVOKE ALL ON api.thumbnail_images FROM anon;
