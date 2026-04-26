#!/bin/bash
# Create the email_svc database role with a password from the environment.
# This script runs during first-time DB initialisation (Docker entrypoint).
# EMAIL_DB_PASSWORD must be present in the .env file passed to the db container.

set -euo pipefail

: "${EMAIL_DB_PASSWORD:?ERROR: EMAIL_DB_PASSWORD must be set in .env}"

# Escape single-quote characters in the password for safe SQL literal embedding.
escaped_pw="${EMAIL_DB_PASSWORD//\'/\'\'}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'email_svc') THEN
    CREATE ROLE email_svc WITH LOGIN PASSWORD '${escaped_pw}';
  ELSE
    ALTER ROLE email_svc WITH PASSWORD '${escaped_pw}';
  END IF;
END;
\$\$;
SQL
