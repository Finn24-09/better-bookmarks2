-- =============================================================================
-- pgTAP unit tests for Better Bookmarks 2
--
-- Run with:   docker compose run --rm test
--
-- Rules applied throughout:
--  1. Never call a volatile function inside a WHERE clause of a multi-row
--     table scan — PostgreSQL calls volatile functions once per row.
--  2. Data-modifying CTEs (INSERT/UPDATE/DELETE) must be at the TOP LEVEL
--     of a query, not nested inside a subquery expression like ok(...).
--  3. Use the two-step approach (separate SELECT statements) when a function
--     must execute first and then a subsequent query verifies the effect.
--  4. RLS tests must use SET LOCAL ROLE app_user so policies are enforced.
--     JWT claims must be set BEFORE the role switch (superuser reads auth.users).
-- =============================================================================

SELECT set_config('app.settings.jwt_secret', 'test-secret-must-be-at-least-32-chars-long!', false);

BEGIN;

SELECT plan(21);

-- Helper: catch an expected exception and compare the message.
CREATE OR REPLACE FUNCTION _expect_error(sql TEXT, expected_msg TEXT, description TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE actual TEXT := '';
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN actual := SQLERRM;
  END;
  RETURN is(actual, expected_msg, description);
END;
$$;

-- ===========================================================================
-- sign_up
-- ===========================================================================

SELECT ok(
  (SELECT r->>'token' IS NOT NULL FROM (SELECT api.sign_up('alice@test.com', 'password123') r) t),
  'sign_up: returns a non-null token'
);

SELECT ok(
  (SELECT r->>'user_id' IS NOT NULL FROM (SELECT api.sign_up('bob@test.com', 'password123') r) t),
  'sign_up: returns a non-null user_id'
);

-- Email normalisation: sign_up runs first, then verify the stored email.
-- Two separate statements — avoids the volatile-function-in-WHERE-clause
-- issue where PostgreSQL would call sign_up once per existing row.
SELECT ok(
  (SELECT r->>'user_id' IS NOT NULL FROM (SELECT api.sign_up('CAROL@TEST.COM', 'password123') r) t),
  'sign_up: CAROL@TEST.COM accepted'
);
SELECT ok(
  (SELECT count(*) = 1 FROM auth.users WHERE email = 'carol@test.com'),
  'sign_up: email normalised to lowercase'
);

SELECT _expect_error(
  $q$ SELECT api.sign_up('alice@test.com', 'duplicate') $q$,
  'Email already registered',
  'sign_up: duplicate email raises error'
);

SELECT _expect_error(
  $q$ SELECT api.sign_up('x@test.com', 'abc') $q$,
  'Password must be at least 8 characters',
  'sign_up: password too short raises error'
);

-- ===========================================================================
-- sign_in
-- ===========================================================================

SELECT ok(
  (SELECT r->>'token' IS NOT NULL FROM (SELECT api.sign_in('alice@test.com', 'password123') r) t),
  'sign_in: correct credentials return a token'
);

SELECT _expect_error(
  $q$ SELECT api.sign_in('alice@test.com', 'wrongpassword') $q$,
  'Invalid email or password',
  'sign_in: wrong password raises error'
);

SELECT _expect_error(
  $q$ SELECT api.sign_in('nobody@test.com', 'password123') $q$,
  'Invalid email or password',
  'sign_in: unknown email raises same error (no enumeration)'
);

SELECT ok(
  (SELECT password LIKE '$2a$%' FROM auth.users WHERE email = 'alice@test.com'),
  'password is stored as bcrypt hash'
);

-- ===========================================================================
-- Row Level Security
--
-- Strategy: insert test data as the superuser (no RLS), then switch to
-- app_user so policies are actually enforced. JWT claims must be set BEFORE
-- the role switch because app_user cannot read auth.users directly.
-- ===========================================================================

-- Setup: Alice inserts a bookmark. Running as superuser bypasses RLS — that
-- is intentional here (we are setting up state, not testing the write path).
INSERT INTO api.bookmarks (user_id, title_enc, url_enc)
SELECT id, 'enc_t', 'enc_u' FROM auth.users WHERE email = 'alice@test.com';

-- --- Test 11: Bob cannot see Alice's bookmark ---
-- Set Bob's claims while still superuser (needs auth.users access).
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub',  (SELECT id::TEXT FROM auth.users WHERE email = 'bob@test.com'),
    'role', 'app_user'
  )::TEXT, true);

-- Switch to app_user → RLS policies are now enforced.
SET LOCAL ROLE app_user;
SELECT ok(
  (SELECT count(*) = 0 FROM api.bookmarks),
  'RLS: Bob cannot see Alice''s bookmarks'
);
RESET ROLE;  -- back to superuser

-- --- Test 12: Alice can see her own bookmark ---
-- Overwrite JWT claims with Alice's ID (still superuser, so auth.users is readable).
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub',  (SELECT id::TEXT FROM auth.users WHERE email = 'alice@test.com'),
    'role', 'app_user'
  )::TEXT, true);

SET LOCAL ROLE app_user;
SELECT ok(
  (SELECT count(*) = 1 FROM api.bookmarks),
  'RLS: Alice can see her own bookmark'
);
RESET ROLE;  -- back to superuser

-- ===========================================================================
-- Tag uniqueness
-- ===========================================================================

WITH _t AS (
  INSERT INTO api.tags (user_id, name_enc, name_hmac)
  SELECT id, 'enc', 'hmac_x' FROM auth.users WHERE email = 'alice@test.com'
  RETURNING id
)
SELECT ok((SELECT count(*) = 1 FROM _t), 'tags: first insert with unique hmac succeeds');

SELECT _expect_error(
  $q$ INSERT INTO api.tags (user_id, name_enc, name_hmac)
      SELECT id, 'enc2', 'hmac_x' FROM auth.users WHERE email = 'alice@test.com' $q$,
  'duplicate key value violates unique constraint "tags_user_name_unique"',
  'tags: duplicate (user_id, name_hmac) raises unique_violation'
);

-- ===========================================================================
-- delete_account: verify cascade to bookmarks and tags
-- Use three separate statements (same transaction) to guarantee ordering:
-- set session → call delete → verify. Avoids CTE lazy-evaluation issues.
-- ===========================================================================

-- 1. Set Carol's session JWT claims
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id::TEXT FROM auth.users WHERE email = 'carol@test.com'),
                    'role', 'app_user')::TEXT, true);

-- 2. Delete Carol's account (password123 was used during sign_up in test 3)
SELECT api.delete_account('password123');

-- 3. Verify carol no longer exists
SELECT ok(
  NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'carol@test.com'),
  'delete_account: removes user and cascades to all data'
);

-- ===========================================================================
-- thumbnail_images: table existence, RLS, FK, cascade
-- ===========================================================================

-- --- Test 16: thumbnail_images table exists ---
SELECT ok(
  (SELECT count(*) = 1
     FROM information_schema.tables
    WHERE table_schema = 'api'
      AND table_name   = 'thumbnail_images'),
  'thumbnail_images table exists in api schema'
);

-- --- Test 17: thumbnail_file_id column exists on bookmarks ---
SELECT ok(
  (SELECT count(*) = 1
     FROM information_schema.columns
    WHERE table_schema = 'api'
      AND table_name   = 'bookmarks'
      AND column_name  = 'thumbnail_file_id'),
  'bookmarks.thumbnail_file_id column exists'
);

-- Setup: insert a thumbnail_images row for Alice as superuser.
INSERT INTO api.thumbnail_images (user_id, data_enc, original_name_enc)
SELECT id, 'fake_data_enc', 'fake_name_enc'
  FROM auth.users WHERE email = 'alice@test.com';

-- --- Test 18: Bob cannot SELECT Alice's thumbnail image ---
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub',  (SELECT id::TEXT FROM auth.users WHERE email = 'bob@test.com'),
    'role', 'app_user'
  )::TEXT, true);

SET LOCAL ROLE app_user;
SELECT ok(
  (SELECT count(*) = 0 FROM api.thumbnail_images),
  'RLS: Bob cannot see Alice''s thumbnail images'
);
RESET ROLE;

-- --- Test 19: Alice can SELECT her own thumbnail image ---
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub',  (SELECT id::TEXT FROM auth.users WHERE email = 'alice@test.com'),
    'role', 'app_user'
  )::TEXT, true);

SET LOCAL ROLE app_user;
SELECT ok(
  (SELECT count(*) = 1 FROM api.thumbnail_images),
  'RLS: Alice can see her own thumbnail image'
);
RESET ROLE;

-- --- Test 20: Bob cannot INSERT a thumbnail image owned by Alice ---
SELECT _expect_error(
  format(
    $q$ SET LOCAL ROLE app_user;
        SET LOCAL request.jwt.claims = %L;
        INSERT INTO api.thumbnail_images (user_id, data_enc, original_name_enc)
        VALUES (%L::UUID, 'bad_data', 'bad_name') $q$,
    json_build_object(
      'sub',  (SELECT id::TEXT FROM auth.users WHERE email = 'bob@test.com'),
      'role', 'app_user'
    )::TEXT,
    (SELECT id FROM auth.users WHERE email = 'alice@test.com')
  ),
  'new row violates row-level security policy for table "thumbnail_images"',
  'RLS: Bob cannot INSERT thumbnail image with Alice''s user_id'
);

-- --- Test 21: Deleting Alice's account cascades to thumbnail_images ---
-- Alice's account and thumbnail image were inserted above; delete_account
-- removes her from auth.users, which cascades to thumbnail_images.
SELECT set_config('request.jwt.claims',
  json_build_object(
    'sub',  (SELECT id::TEXT FROM auth.users WHERE email = 'alice@test.com'),
    'role', 'app_user'
  )::TEXT, true);

SELECT api.delete_account('password123');

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM api.thumbnail_images ti
    JOIN auth.users u ON u.id = ti.user_id
    WHERE u.email = 'alice@test.com'
  ),
  'cascade: deleting user removes their thumbnail_images rows'
);

SELECT * FROM finish();

ROLLBACK;
