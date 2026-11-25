-- Only drops the schemas in a test database (its name contains "test", e.g. circle_test),
-- so running the tests against a normal dev database can't wipe it.
DO $$ BEGIN IF current_database() ~* 'test' THEN DROP SCHEMA IF EXISTS tymly CASCADE; DROP SCHEMA IF EXISTS tymly_test CASCADE; END IF; END $$;
