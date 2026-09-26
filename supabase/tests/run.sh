#!/usr/bin/env bash
# Runs every migration, in order, and the checks against a scratch Postgres (never production).
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/run.sh
# Locally: any Postgres 15+ works. The shim stands in for Supabase's auth schema.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to a scratch database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/local-auth-shim.sql
for m in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$m"
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/foundation.sql | grep -q 'ALL FOUNDATION CHECKS PASSED'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/rooms.sql | grep -q 'ALL ROOM CHECKS PASSED'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/field_test.sql | grep -q 'ALL FIELD TEST CHECKS PASSED'
echo "sql: all foundation, room and field-test checks passed"
