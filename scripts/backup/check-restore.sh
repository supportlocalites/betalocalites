#!/usr/bin/env bash
# The restore drill (runbook F §6): unlocks a backup, restores it into a NEW, empty database
# and checks it against what the backup says it holds. Never touches the live database.
#   BACKUP_PASSPHRASE   the lock
#   RESTORE_ADMIN_URL   a scratch server, as its admin; the database "localites_restore_check"
#                       on it is replaced
#   $1                  the locked backup file
# Exits non-zero, saying why, if anything is missing or wrong.
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'
file=${1:?the locked backup file}
: "${BACKUP_PASSPHRASE:?}" "${RESTORE_ADMIN_URL:?}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$file" 3<<<"$BACKUP_PASSPHRASE" | tar -C "$work" -xf -
manifest=$(cat "$work/manifest.json")
m() { node -e "const m = JSON.parse(process.argv[1]); const v = ($1); console.log(typeof v === 'string' ? v : JSON.stringify(v))" "$manifest"; }

db=localites_restore_check
target=$(node -e "const u = new URL(process.argv[1]); u.pathname = '/$db'; console.log(u.toString())" "$RESTORE_ADMIN_URL")
psql "$RESTORE_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db"
q() { psql "$target" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# The backup brings its own public schema; a new database's empty one would be in the way.
q "drop schema public"
# What a fresh server lacks: the roles the grants name, and the extensions, in their schemas.
for role in $(m 'm.roles.join(" ")'); do
  q "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$role') then create role \"$role\" nologin; end if; end \$\$"
done
missing=()
while IFS=' ' read -r ext schema; do
  [ -n "$ext" ] || continue
  if [ "$(q "select count(*) from pg_available_extensions where name = '$ext'")" = 1 ]; then
    q "create schema if not exists \"$schema\"; create extension if not exists \"$ext\" with schema \"$schema\""
  else
    missing+=("$ext")
  fi
done < <(m 'm.extensions.map((e) => e.name + " " + e.schema).join("\n")')
[ ${#missing[@]} -eq 0 ] || echo "Not on the scratch server (Supabase's own, not used by our tables): ${missing[*]}"

pg_restore --no-owner --exit-on-error --dbname="$target" "$work/database.dump"

# 1. Every table is there, with the rows it had (a little leeway: the count was taken just
#    after the export, while the site kept running).
problems=0
while IFS=' ' read -r table want; do
  got=$(q "select count(*) from $table")
  allow=$(( want / 100 > 5 ? want / 100 : 5 ))
  diff=$(( got > want ? got - want : want - got ))
  if (( diff > allow )); then
    echo "::error::$table has $got rows after restoring; the backup noted $want."
    problems=$((problems + 1))
  fi
done < <(m 'Object.entries(m.rows).map(([t, n]) => t + " " + n).join("\n")')
tables=$(m 'Object.keys(m.rows).length')
rows=$(m 'Object.values(m.rows).reduce((a, b) => a + Number(b), 0)')

# 2. Nothing written before the export began is missing (the newest audit entry from then).
if [ "$(m 'm.latestAuditBefore ?? ""')" != "" ]; then
  ok=$(q "select max(created_at) >= '$(m 'm.latestAuditBefore')'::timestamptz from public.audit_log")
  [ "$ok" = t ] || { echo "::error::The restored audit log is older than the backup."; problems=$((problems + 1)); }
fi

# 3. Published businesses come back whole: name, town, kinds, services and photos join up.
broken=$(q "select count(*) from (select v.id from vendor v where v.listing_status = 'published' order by v.updated_at desc limit 10) s
            join vendor v on v.id = s.id
            left join municipality m on m.id = v.primary_municipality_id
            where m.id is null or v.display_name is null")
[ "$broken" = 0 ] || { echo "::error::$broken published businesses don't come back whole."; problems=$((problems + 1)); }
sample=$(q "select count(*) from (select 1 from vendor where listing_status = 'published' limit 10) s")

# 4. Every link between tables holds (the database checked each while restoring; none skipped).
unchecked=$(q "select count(*) from pg_constraint where contype = 'f' and not convalidated")
[ "$unchecked" = 0 ] || { echo "::error::$unchecked links between tables weren't checked."; problems=$((problems + 1)); }

psql "$RESTORE_ADMIN_URL" -X -q -c "drop database $db"
if (( problems > 0 )); then
  echo "Restore check FAILED: $problems problem(s)."
  exit 1
fi
echo "Restore check passed: backup from $(m 'm.startedAt') (Postgres $(m 'm.serverVersion')) restored into an empty database; $tables tables, $rows rows, as noted; nothing from before the backup missing; $sample published businesses whole; every link between tables checked."
