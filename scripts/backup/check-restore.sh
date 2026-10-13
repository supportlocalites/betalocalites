#!/usr/bin/env bash
# The restore drill (runbook F §6): unlocks a backup, restores it into a NEW, empty database
# and checks it against what the backup says it holds. Never touches the live database.
#   BACKUP_PASSPHRASE   the lock
#   RESTORE_ADMIN_URL   a scratch server, as its admin; the database "localites_restore_check"
#                       on it is replaced
#   $1                  the locked backup file
# Exits non-zero, saying why, if anything is missing or wrong. Prints no row data.
set -euo pipefail
export PGOPTIONS='-c client_min_messages=warning'
file=${1:?the locked backup file}
: "${BACKUP_PASSPHRASE:?}" "${RESTORE_ADMIN_URL:?}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$file" 3<<<"$BACKUP_PASSPHRASE" | tar -C "$work" -xf -
dump="$work/database.dump"
manifest=$(cat "$work/manifest.json")
m() { node -e "const m = JSON.parse(process.argv[1]); const v = ($1); console.log(typeof v === 'string' ? v : JSON.stringify(v))" "$manifest"; }
fail() {
  echo "::error::$1"
  echo "Restore check FAILED: $1"
  exit 1
}

# What the backup says it holds, read up front so a damaged list stops the check here.
roles=$(m 'm.roles.join(" ")')
extensions=$(m 'm.extensions.map((e) => e.name + " " + e.schema).join("\n")')
noted=$(m 'Object.entries(m.rows).map(([t, n]) => t + " " + n).join("\n")')
businesses=$(m '(m.businesses ?? []).map((b) => b.id + " " + b.fingerprint).join("\n")')
started=$(m 'm.startedAt')
latest_before=$(m 'm.latestAuditBefore ?? ""')
[ -n "$noted" ] || fail "the backup lists no tables."

# Exact rows per table in the backup file itself (its data, counted line by line).
pg_restore --data-only --file=- "$dump" |
  awk '/^COPY /{t=$2; n=0; inside=1; next} inside && /^\\\.$/{print t, n; inside=0; next} inside{n++}' > "$work/in-file"
[ -s "$work/in-file" ] || fail "the backup file holds no table data."

db=localites_restore_check
target=$(node -e "const u = new URL(process.argv[1]); u.pathname = '/$db'; console.log(u.toString())" "$RESTORE_ADMIN_URL")
psql "$RESTORE_ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database if exists $db" -c "create database $db"
q() { psql "$target" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# What a fresh server lacks: the roles the grants name, and the extensions, in their schemas.
for role in $roles; do
  q "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$role') then create role \"$role\" nologin; end if; end \$\$"
done
missing=()
while IFS=' ' read -r ext schema; do
  [ -n "$ext" ] || continue
  if [ "$(q "select count(*) from pg_available_extensions where name = '$ext'")" = 1 ]; then
    q "create schema if not exists \"$schema\"; create extension if not exists \"$ext\" with schema \"$schema\" cascade"
  else
    missing+=("$ext")
  fi
done <<<"$extensions"
[ ${#missing[@]} -eq 0 ] || echo "Not on the scratch server (Supabase's own, not used by our tables): ${missing[*]}"

# Everything in the backup except creating the public schema, which every database already has.
pg_restore --list "$dump" | grep -v ' SCHEMA - public ' > "$work/contents"
# Errors are shown without their detail lines, which can quote stored values (emails, names).
if ! pg_restore --no-owner --exit-on-error --use-list="$work/contents" --dbname="$target" "$dump" 2> "$work/errors"; then
  grep -vE '^(DETAIL|CONTEXT|HINT|LINE [0-9]+):|^\s|Command was' "$work/errors" | head -5
  fail "the backup didn't restore."
fi

# 1. Every table came back with exactly the rows in the backup file, and the file has about
#    what the database held when the backup was taken (counted just after, while the site ran).
problems=0
while IFS=' ' read -r table want; do
  got=$(q "select count(*) from $table")
  [ "$got" = "$want" ] || { echo "::error::$table has $got rows after restoring; the backup file holds $want."; problems=$((problems + 1)); }
done < "$work/in-file"
while IFS=' ' read -r table noted_rows; do
  in_file=$(awk -v t="$table" '$1 == t {print $2}' "$work/in-file")
  in_file=${in_file:-0}
  allow=$(( noted_rows / 100 > 5 ? noted_rows / 100 : 5 ))
  diff=$(( in_file > noted_rows ? in_file - noted_rows : noted_rows - in_file ))
  (( diff <= allow )) || { echo "::error::$table: the backup file holds $in_file rows; the database had about $noted_rows."; problems=$((problems + 1)); }
done <<<"$noted"
tables=$(wc -l < "$work/in-file")
rows=$(awk '{s += $2} END {print s}' "$work/in-file")

# 2. Nothing written before the backup began is missing (the newest audit entry from then).
if [ -n "$latest_before" ]; then
  ok=$(q "select coalesce(max(created_at) >= '$latest_before'::timestamptz, false) from public.audit_log")
  [ "$ok" = t ] || { echo "::error::The restored audit log is older than the backup."; problems=$((problems + 1)); }
fi

# 3. The 10 most recently changed published businesses come back exactly, every detail of
#    each (any changed while the backup ran may differ, and are said so).
same=0
changed=0
while IFS=' ' read -r id fingerprint; do
  [ -n "$id" ] || continue
  now=$(q "select md5(row_to_json(v)::text) || ' ' || (v.updated_at >= '$started'::timestamptz) from public.vendor v where v.id = '$id'")
  if [ "${now%% *}" = "$fingerprint" ]; then
    same=$((same + 1))
  elif [ "${now##* }" = t ]; then
    changed=$((changed + 1))
  else
    echo "::error::A published business (id $id) didn't come back as it was."
    problems=$((problems + 1))
  fi
done <<<"$businesses"

# 4. Every link between tables holds (the database checked each while restoring; none skipped).
unchecked=$(q "select count(*) from pg_constraint where contype = 'f' and not convalidated")
[ "$unchecked" = 0 ] || { echo "::error::$unchecked links between tables weren't checked."; problems=$((problems + 1)); }

psql "$RESTORE_ADMIN_URL" -X -q -c "drop database $db"
(( problems == 0 )) || fail "$problems problem(s), listed above."
echo "Restore check passed: backup from $started (Postgres $(m 'm.serverVersion')) restored into an empty database; $tables tables and $rows rows, exactly as in the backup; nothing from before the backup missing; $same published businesses came back exactly$( ((changed)) && echo " ($changed changed while the backup ran)"); every link between tables checked."
