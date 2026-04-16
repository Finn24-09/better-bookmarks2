-- =============================================================================
-- Auth RPC functions exposed via PostgREST
--
-- All functions are created in the api schema so PostgREST exposes them
-- at POST /rpc/<function_name>.
--
-- Security: SECURITY DEFINER + explicit search_path prevents privilege
-- escalation. Functions that need auth.users access run as the owner
-- (superuser during init) but only expose the minimum needed data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: sign a JWT with the configured secret
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api._sign_jwt(
  user_id    UUID,
  user_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  jwt_secret TEXT;
  token      TEXT;
BEGIN
  -- Read the JWT secret injected by PostgREST at transaction start.
  -- PostgREST sets this GUC via PGRST_APP_SETTINGS_JWT_SECRET (the
  -- "Extra Configuration" feature); PGRST_JWT_SECRET alone does NOT
  -- make it available here. The init script 06_set_jwt_secret.sh is a
  -- belt-and-suspenders fallback for direct (non-PostgREST) connections.
  jwt_secret := current_setting('app.settings.jwt_secret', true);

  IF jwt_secret IS NULL OR jwt_secret = '' THEN
    RAISE EXCEPTION 'JWT secret not configured (app.settings.jwt_secret)';
  END IF;

  token := sign(
    json_build_object(
      'role',  'app_user',
      'sub',   user_id::TEXT,
      'email', user_email,
      -- Expire in 7 days
      'exp',   EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')::BIGINT
    ),
    jwt_secret
  );

  RETURN token;
END;
$$;

-- Only the DB owner (superuser) may call this internal helper
REVOKE ALL ON FUNCTION api._sign_jwt(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION api._sign_jwt(UUID, TEXT) TO app_user;


-- ---------------------------------------------------------------------------
-- sign_up(email, password) → { token, user_id }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.sign_up(
  email    TEXT,
  password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  new_user auth.users;
  token    TEXT;
BEGIN
  -- Validate inputs
  IF email IS NULL OR trim(email) = '' THEN
    RAISE EXCEPTION 'Email is required' USING ERRCODE = 'check_violation';
  END IF;
  IF password IS NULL OR length(password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters' USING ERRCODE = 'check_violation';
  END IF;

  -- Hash password with bcrypt, work factor 12 (irreversible)
  INSERT INTO auth.users (email, password)
  VALUES (lower(trim(email)), crypt(password, gen_salt('bf', 12)))
  RETURNING * INTO new_user;

  token := api._sign_jwt(new_user.id, new_user.email);

  RETURN json_build_object(
    'token',   token,
    'user_id', new_user.id
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Email already registered' USING ERRCODE = 'unique_violation';
END;
$$;

GRANT EXECUTE ON FUNCTION api.sign_up(TEXT, TEXT) TO anon;


-- ---------------------------------------------------------------------------
-- sign_in(email, password) → { token, user_id }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.sign_in(
  email    TEXT,
  password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  found_user auth.users;
  token      TEXT;
BEGIN
  -- Look up user and verify bcrypt hash in a single query.
  -- crypt(input, stored_hash) recomputes bcrypt with the stored salt and
  -- compares — constant-time, irreversible.
  SELECT * INTO found_user
  FROM auth.users
  WHERE auth.users.email = lower(trim(sign_in.email))
    AND auth.users.password = crypt(sign_in.password, auth.users.password);

  IF NOT FOUND THEN
    -- Return same error for unknown email and wrong password (no enumeration)
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = 'invalid_password';
  END IF;

  token := api._sign_jwt(found_user.id, found_user.email);

  RETURN json_build_object(
    'token',   token,
    'user_id', found_user.id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION api.sign_in(TEXT, TEXT) TO anon;


-- ---------------------------------------------------------------------------
-- change_password(current_password, new_password)
-- Requires a valid JWT (called by app_user role).
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
  -- PostgREST sets request.jwt.claims when JWT is verified
  caller_id := (current_setting('request.jwt.claims', true)::JSON->>'sub')::UUID;

  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF new_password IS NULL OR length(new_password) < 8 THEN
    RAISE EXCEPTION 'New password must be at least 8 characters' USING ERRCODE = 'check_violation';
  END IF;

  -- Verify current password
  SELECT * INTO found_user
  FROM auth.users
  WHERE id = caller_id
    AND password = crypt(current_password, password);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current password is incorrect' USING ERRCODE = 'invalid_password';
  END IF;

  -- Update with new bcrypt hash
  UPDATE auth.users
  SET password = crypt(new_password, gen_salt('bf', 12))
  WHERE id = caller_id;
END;
$$;

GRANT EXECUTE ON FUNCTION api.change_password(TEXT, TEXT) TO app_user;


-- ---------------------------------------------------------------------------
-- delete_account(password)
-- Permanently deletes the caller's account and all associated data
-- (CASCADE handles bookmarks, tags, bookmark_tags).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.delete_account(
  password TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, auth, public
AS $$
DECLARE
  caller_id  UUID;
  found_user auth.users;
BEGIN
  caller_id := (current_setting('request.jwt.claims', true)::JSON->>'sub')::UUID;

  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify password before destructive action
  SELECT * INTO found_user
  FROM auth.users
  WHERE id = caller_id
    AND auth.users.password = crypt(delete_account.password, auth.users.password);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Password is incorrect' USING ERRCODE = 'invalid_password';
  END IF;

  -- Delete user — ON DELETE CASCADE removes all bookmarks, tags, bookmark_tags
  DELETE FROM auth.users WHERE id = caller_id;
END;
$$;

GRANT EXECUTE ON FUNCTION api.delete_account(TEXT) TO app_user;
