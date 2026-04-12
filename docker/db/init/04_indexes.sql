-- =============================================================================
-- Performance indexes
-- =============================================================================

-- bookmarks: primary access pattern is "all bookmarks for a user, newest first"
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created
  ON api.bookmarks (user_id, created_at DESC);

-- tags: primary access pattern is "all tags for a user"
CREATE INDEX IF NOT EXISTS idx_tags_user_id
  ON api.tags (user_id);

-- bookmark_tags: join from bookmark to tags and vice versa
CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag_id
  ON api.bookmark_tags (tag_id);

-- users: email lookups during sign-in
-- (already covered by the UNIQUE constraint index on email, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_users_email
  ON auth.users (lower(email));
