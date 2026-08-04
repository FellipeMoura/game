-- One-off bootstrap of the bestiary database on the shared Postgres 16
-- instance that already serves quartzo (port 5434).
--
-- On the sysnode VPS the Postgres runs inside a Docker container and the
-- host has neither the `postgres` OS user nor a `psql` client. Pipe this
-- file into the container via `docker exec`:
--
--   PG_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)
--   PG_PASSWORD=$(grep '^DATABASE_URL=' .env | sed 's|.*://bestiary_app:\([^@]*\)@.*|\1|')
--   sed "s|CHANGE_ME_BEFORE_RUNNING|$PG_PASSWORD|" infra/postgres/init-bestiary.sql \
--     | docker exec -i "$PG_CONTAINER" psql -U postgres
--
-- If a future VPS has Postgres native to the OS:
--   sudo -u postgres psql -f infra/postgres/init-bestiary.sql
--
-- Idempotent: `IF NOT EXISTS` on role and database, `REVOKE`/`GRANT` are
-- naturally re-runnable. Change the password *before* running (or edit
-- the role in a second statement immediately after).

-- Application role — deliberately weak set of powers. This is the isolation
-- boundary that keeps a compromised bestiary from reaching quartzo_prod.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bestiary_app') THEN
        CREATE ROLE bestiary_app
            WITH LOGIN
            PASSWORD 'CHANGE_ME_BEFORE_RUNNING'
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION;
    END IF;
END
$$;

-- Database owned by the app role — the migration tool (drizzle-kit) uses
-- the same connection, so it needs to be able to CREATE/ALTER schema
-- objects inside this DB (which the OWNER can do). It still cannot touch
-- other databases on the cluster because it lacks superuser.
SELECT 'CREATE DATABASE bestiary_prod OWNER bestiary_app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bestiary_prod')
\gexec

-- Belt and suspenders: revoke the implicit CONNECT that PUBLIC has, then
-- grant it back only to our app role.
REVOKE ALL ON DATABASE bestiary_prod FROM PUBLIC;
GRANT CONNECT ON DATABASE bestiary_prod TO bestiary_app;

-- Sanity check when you re-run this file: should print bestiary_app as
-- the sole non-default grantee.
-- \l+ bestiary_prod
