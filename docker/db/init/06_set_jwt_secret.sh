#!/bin/bash
# Sets the JWT secret as a database-level GUC so PostgreSQL functions
# (sign_up, sign_in) can access it via current_setting('app.settings.jwt_secret').
# This script runs after SQL init scripts because it is alphabetically last.
set -euo pipefail

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname   "$POSTGRES_DB" \
     <<-EOSQL
  ALTER DATABASE "${POSTGRES_DB}" SET app.settings.jwt_secret = '${PGRST_JWT_SECRET}';
EOSQL

echo "JWT secret configured for database ${POSTGRES_DB}"
