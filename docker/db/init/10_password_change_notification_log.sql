-- =============================================================================
-- 10_password_change_notification_log.sql
-- Adds the 'password_change_notification' value to auth.email_token_type so
-- the per-user cooldown for the password-change notification email (sent by
-- POST /api/email/notify-password-change) can write to auth.email_send_log
-- with a discriminating token_type. The notification itself does not produce
-- an auth.email_tokens row — there is no redeemable token — but reusing the
-- existing email_send_log table for cooldown bookkeeping requires the enum
-- value to exist.
--
-- Why this lives in its own migration:
-- PostgreSQL refuses to use an ENUM value in the same transaction that adds
-- it (`unsafe use of new value of enum type`). The ALTER TYPE ... ADD VALUE
-- below is therefore wrapped in its own BEGIN/COMMIT and the new value is
-- not referenced anywhere else in this file. Routes that consume the new
-- value run in later sessions, after this migration has committed.
-- =============================================================================

BEGIN;

ALTER TYPE auth.email_token_type ADD VALUE IF NOT EXISTS 'password_change_notification';

COMMIT;
