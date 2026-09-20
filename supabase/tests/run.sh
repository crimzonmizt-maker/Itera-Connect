#!/usr/bin/env bash
# Runs the migration and the foundation checks against a scratch Postgres (never production).
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/run.sh
# Locally: any Postgres 15+ works. The shim stands in for Supabase's auth schema.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL to a scratch database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/local-auth-shim.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/20260920_foundation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/foundation.sql | grep -q 'ALL FOUNDATION CHECKS PASSED'
echo "sql: all foundation checks passed"
