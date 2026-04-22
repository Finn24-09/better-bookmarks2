-- =============================================================================
-- Row Level Security (RLS)
--
-- Every table in the api schema has RLS enabled. The current user's ID is
-- extracted from the verified JWT claim 'sub' that PostgREST sets via the
-- request.jwt.claims GUC.
--
-- This guarantees that even if the API layer has a bug and issues the wrong
-- query, the database will never return or mutate another user's rows.
-- =============================================================================

-- Helper: extract the authenticated caller's UUID from the JWT claim.
-- Returns NULL if no JWT is present (anon requests).
--
-- MUST be VOLATILE: PostgreSQL's docs warn that STABLE/IMMUTABLE functions in
-- RLS policies may be evaluated at plan time and embedded as a constant in
-- generic prepared-statement plans. After any user makes their first request,
-- PostgreSQL would cache that user's UUID in the plan and return it for ALL
-- subsequent users — breaking multi-user isolation entirely.
CREATE OR REPLACE FUNCTION api.current_user_id()
RETURNS UUID
LANGUAGE sql
VOLATILE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::JSON->>'sub',
    ''
  )::UUID;
$$;

GRANT EXECUTE ON FUNCTION api.current_user_id() TO app_user, anon;

-- ---------------------------------------------------------------------------
-- api.tags
-- ---------------------------------------------------------------------------
ALTER TABLE api.tags ENABLE ROW LEVEL SECURITY;

-- SELECT: user can only see their own tags
CREATE POLICY tags_select ON api.tags
  FOR SELECT TO app_user
  USING (user_id = api.current_user_id());

-- INSERT: user can only insert rows with their own user_id
CREATE POLICY tags_insert ON api.tags
  FOR INSERT TO app_user
  WITH CHECK (user_id = api.current_user_id());

-- UPDATE: user can only update their own tags
CREATE POLICY tags_update ON api.tags
  FOR UPDATE TO app_user
  USING  (user_id = api.current_user_id())
  WITH CHECK (user_id = api.current_user_id());

-- DELETE: user can only delete their own tags
CREATE POLICY tags_delete ON api.tags
  FOR DELETE TO app_user
  USING (user_id = api.current_user_id());

-- ---------------------------------------------------------------------------
-- api.bookmarks
-- ---------------------------------------------------------------------------
ALTER TABLE api.bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookmarks_select ON api.bookmarks
  FOR SELECT TO app_user
  USING (user_id = api.current_user_id());

CREATE POLICY bookmarks_insert ON api.bookmarks
  FOR INSERT TO app_user
  WITH CHECK (user_id = api.current_user_id());

CREATE POLICY bookmarks_update ON api.bookmarks
  FOR UPDATE TO app_user
  USING  (user_id = api.current_user_id())
  WITH CHECK (user_id = api.current_user_id());

CREATE POLICY bookmarks_delete ON api.bookmarks
  FOR DELETE TO app_user
  USING (user_id = api.current_user_id());

-- ---------------------------------------------------------------------------
-- api.bookmark_tags
-- Users can only manage junction rows for bookmarks they own.
-- ---------------------------------------------------------------------------
ALTER TABLE api.bookmark_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookmark_tags_select ON api.bookmark_tags
  FOR SELECT TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM api.bookmarks b
      WHERE b.id = bookmark_id
        AND b.user_id = api.current_user_id()
    )
  );

CREATE POLICY bookmark_tags_insert ON api.bookmark_tags
  FOR INSERT TO app_user
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM api.bookmarks b
      WHERE b.id = bookmark_id
        AND b.user_id = api.current_user_id()
    )
  );

CREATE POLICY bookmark_tags_delete ON api.bookmark_tags
  FOR DELETE TO app_user
  USING (
    EXISTS (
      SELECT 1 FROM api.bookmarks b
      WHERE b.id = bookmark_id
        AND b.user_id = api.current_user_id()
    )
  );
