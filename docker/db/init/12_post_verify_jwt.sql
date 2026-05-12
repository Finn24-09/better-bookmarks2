-- =============================================================================
-- 12_post_verify_jwt.sql
-- Post-verify JWT refresh: lets a user pick up a fresh `email_verified=true`
-- claim immediately after clicking the verification link, without forcing a
-- re-sign-in.
--
-- WHY THIS EXISTS
-- The JWT minted by api._sign_jwt carries `email_verified` as a claim
-- (11_jwt_audience.sql:94). At sign-in the claim is current, but it goes
-- stale in one direction: a user who verifies AFTER sign-in keeps a JWT
-- claiming `email_verified=false` until expiry (24h) or next sign-in. The
-- metadata-fetcher service (services/metadata-fetcher/) gates POST /title on
-- this claim and CANNOT consult the database — it lives on the dedicated
-- `metadata_net` Docker network with no L3 path to `db` (a deliberate SSRF
-- blast-radius cap; see docker-compose.yml). Without this refresh, a freshly
-- verified user would be wrongly blocked from auto-fill until expiry.
--
-- CARVE-OUT FROM THE 08_email_tokens.sql:505-510 INVARIANT
-- That comment says: "if a future RPC needs to gate behavior on verification,
-- enforce against auth.users.email_verified, NEVER the JWT claim." The
-- metadata-fetcher is the documented exception: it has no DB role and no L3
-- path to the database. Claim-based gating is the only option for that
-- service. This migration closes the staleness gap by providing a narrow,
-- bounded refresh path; all OTHER services and RPCs still follow the original
-- invariant and read auth.users.email_verified directly.
--
-- SECURITY MODEL — why this is NOT a general session-extension primitive
-- An attacker who steals a JWT cannot use this to refresh their session
-- forever because the mint refuses unless:
--   1. auth.users.email_verified IS TRUE — defensive precondition;
--      mark_email_verified is the only path that flips this.
--   2. auth.users.email_verified_at > NOW() - INTERVAL '5 minutes' — bounds
--      the mint to a small window after the verification event. Verification
--      is monotonic (email_verified can only go FALSE → TRUE once, see the
--      mark_email_verified guard below), and the underlying email token is
--      single-use (auth.redeem_email_token, 08_email_tokens.sql:180-191), so
--      the window is reached at most once per user per verification flow.
--
-- 5 minutes was chosen to cover a slow IMAP fetch plus the user tab-switching
-- back to the SPA. Shorter (1 min) would risk timing out legitimate users on
-- a slow mail client; longer (15 min) widens the refresh window without UX
-- benefit. The threat model accepts that a stolen JWT in flight at the
-- moment of verification can refresh once; that is no worse than the
-- attacker calling api.sign_in with stolen credentials and getting a fresh
-- 24h JWT directly.
--
-- ROLE PERMISSIONS
-- EXECUTE on auth.mint_post_verify_jwt is granted ONLY to email_svc. The
-- app_user role (PostgREST's authenticated role) cannot call it directly,
-- nor can anon. The grant pattern mirrors auth.mark_email_verified
-- (08_email_tokens.sql:214).
--
-- IDEMPOTENT — safe to re-apply with `docker compose exec db psql ... -f`.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Re-define auth.mark_email_verified so that email_verified_at is WRITE-ONCE.
--
-- The previous definition (08_email_tokens.sql:200-212) overwrote the
-- timestamp on every call, which would let a future code path that re-runs
-- mark_email_verified silently re-arm the 5-minute mint window below.
-- redeem_email_token is currently single-use, so the function is only
-- reachable once per token — but that is an emergent property of the calling
-- site, not a structural invariant of this function. The WHERE clause makes
-- the structural invariant explicit:
--
--   * First call (email_verified=FALSE): UPDATE applies → flips to TRUE and
--     records email_verified_at = NOW().
--   * Subsequent calls (email_verified=TRUE): UPDATE skips the row → no-op,
--     email_verified_at preserved.
--
-- Net effect: email_verified_at is the timestamp of the FIRST verification
-- event, monotonically. The 5-minute window check in mint_post_verify_jwt
-- below relies on this property.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.mark_email_verified(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
BEGIN
  UPDATE auth.users
  SET email_verified    = TRUE,
      email_verified_at = NOW()
  WHERE id = p_user_id
    AND email_verified IS FALSE;
END;
$$;

-- Grant is unchanged (re-issued defensively in case this migration runs
-- against a fresh schema where the prior 08 grant was lost).
GRANT EXECUTE ON FUNCTION auth.mark_email_verified(UUID) TO email_svc;

-- ---------------------------------------------------------------------------
-- auth.mint_post_verify_jwt(p_user_id UUID)
-- Returns: (token TEXT, email_verified BOOLEAN)
--
-- Mints a fresh JWT for the given user via api._sign_jwt, but ONLY if the
-- user's email_verified column is TRUE AND email_verified_at is within the
-- last 5 minutes. Otherwise raises check_violation.
--
-- FOR SHARE lock: prevents a hypothetical future schema where verification
-- could be reverted from racing with the precondition check. Verification is
-- currently monotonic, but the lock makes the invariant structural.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION auth.mint_post_verify_jwt(p_user_id UUID)
RETURNS TABLE(token TEXT, email_verified BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, api, public
AS $$
DECLARE
  v_email             TEXT;
  v_email_verified    BOOLEAN;
  v_email_verified_at TIMESTAMPTZ;
  v_token_version     INTEGER;
BEGIN
  SELECT u.email, u.email_verified, u.email_verified_at, u.token_version
  INTO   v_email, v_email_verified, v_email_verified_at, v_token_version
  FROM   auth.users u
  WHERE  u.id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_email_verified IS NOT TRUE THEN
    -- Defence-in-depth: email service only calls this AFTER mark_email_verified,
    -- so this branch should be unreachable in practice. If hit, it indicates a
    -- caller-ordering bug we want to surface loudly, not silently grant a token.
    RAISE EXCEPTION 'email not verified' USING ERRCODE = 'check_violation';
  END IF;

  IF v_email_verified_at IS NULL
     OR v_email_verified_at < NOW() - INTERVAL '5 minutes' THEN
    -- Outside the post-verify window. User must re-sign-in for a fresh claim.
    RAISE EXCEPTION 'verification window expired' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
    SELECT api._sign_jwt(p_user_id, v_email, v_token_version, TRUE) AS token,
           TRUE AS email_verified;
END;
$$;

REVOKE ALL ON FUNCTION auth.mint_post_verify_jwt(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.mint_post_verify_jwt(UUID) TO email_svc;

COMMIT;
