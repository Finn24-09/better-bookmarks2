-- Enable extensions required by the application
-- pgcrypto: bcrypt password hashing + gen_random_uuid()
-- pgjwt: JWT signing inside PostgreSQL functions
-- pgtap: unit testing framework (only used in 05_tests.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgjwt;

-- pgtap is only present in the dev image target; skip silently in production
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgtap') THEN
    CREATE EXTENSION IF NOT EXISTS pgtap;
  END IF;
END;
$$;
