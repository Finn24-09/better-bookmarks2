BEGIN;

-- The email-confirmed deletion flow (POST /api/email/confirm-delete) is the only
-- permitted account deletion path. The direct PostgREST RPC allowed any authenticated
-- user to delete their account with just a password — no email confirmation required.
-- Revoking it closes the bypass; auth.delete_account_with_password() (SECURITY DEFINER,
-- called only by email_svc after token redemption) remains the sole deletion mechanism.
REVOKE EXECUTE ON FUNCTION api.delete_account(TEXT) FROM app_user;
DROP FUNCTION IF EXISTS api.delete_account(TEXT);

COMMIT;
