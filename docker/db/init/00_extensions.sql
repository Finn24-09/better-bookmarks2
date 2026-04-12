-- Enable extensions required by the application
-- pgcrypto: bcrypt password hashing + gen_random_uuid()
-- pgjwt: JWT signing inside PostgreSQL functions
-- pgtap: unit testing framework (only used in 05_tests.sql)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgjwt;
CREATE EXTENSION IF NOT EXISTS pgtap;
