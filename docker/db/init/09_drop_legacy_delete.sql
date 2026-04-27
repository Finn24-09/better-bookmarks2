BEGIN;

-- Historical: a previous schema version exposed api.delete_account(TEXT) as a
-- PostgREST RPC that let any authenticated user delete their own account
-- with just a password — no email-token confirmation. The email-confirmed
-- flow (POST /api/email/confirm-delete, redeems an email token, then calls
-- auth.delete_account_with_password() which is granted only to email_svc) is
-- now the sole permitted deletion path.
--
-- This script is the safety net: on a fresh volume the legacy function never
-- gets created, so the DROP IF EXISTS is a no-op. On an existing volume that
-- predates this file, it removes the legacy function and its grant. Use
-- DROP ... IF EXISTS (which also drops dependent grants) so the script is
-- idempotent regardless of whether the function is present.
DROP FUNCTION IF EXISTS api.delete_account(TEXT);

COMMIT;
