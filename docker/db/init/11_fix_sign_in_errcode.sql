BEGIN;

-- Forward migration: fix the errcode used by api.sign_in() when credentials are
-- invalid. Previously the function raised with ERRCODE = 'invalid_password'
-- (SQLSTATE 28P01), which PostgREST maps to HTTP 403. The frontend (src/lib/api.ts)
-- intentionally masks 401/403 with generic messages to prevent DB schema leakage,
-- so the user-facing string "Invalid email or password" was being replaced with
-- "You do not have permission to perform this action." in the login toast.
--
-- Switching to ERRCODE = 'check_violation' (SQLSTATE 23514 → HTTP 400) puts this
-- raise on the auth-RPC 400 relay path in api.ts, which surfaces body.message to
-- the toast — matching the pattern already used by every other user-facing
-- validation in 02_auth_functions.sql (e.g. "Email is required", "Password must
-- include an uppercase letter").
--
-- Only api.sign_in is changed. change_password and delete_account_with_password
-- continue to use 'invalid_password' because their callers are already
-- authenticated and a 403 is semantically correct for those flows.
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
    -- Return same error for unknown email and wrong password (no enumeration).
    -- check_violation → HTTP 400 → relayed to user by api.ts auth-RPC path.
    RAISE EXCEPTION 'Invalid email or password' USING ERRCODE = 'check_violation';
  END IF;

  token := api._sign_jwt(found_user.id, found_user.email);

  RETURN json_build_object(
    'token',   token,
    'user_id', found_user.id
  );
END;
$$;

COMMIT;
