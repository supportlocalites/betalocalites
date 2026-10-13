#!/usr/bin/env bash
# Our own nightly database backup (runbook F §5). Exports everything Localites keeps (the
# public schema) and the sign-in accounts (auth), notes what was in it (manifest.json),
# and locks both in one file with BACKUP_PASSPHRASE (AES-256). Nothing readable is kept.
#   DATABASE_ADMIN_URL  the database, as its admin (a GitHub secret)
#   BACKUP_PASSPHRASE   the lock (a GitHub secret; the product owner keeps a copy)
#   $1                  the folder to put the locked file in
# Prints the locked file's path, and writes the server's major version to $1/pg-major.
set -euo pipefail
out=${1:?folder for the backup}
: "${DATABASE_ADMIN_URL:?}" "${BACKUP_PASSPHRASE:?}"
# Supabase's pooler on 6543 hands each statement to any connection; a backup needs one
# connection throughout, which the same pooler gives on 5432.
url=${DATABASE_ADMIN_URL/:6543\//:5432/}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
q() { psql "$url" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

major=$(q "select current_setting('server_version_num')::int / 10000")
started=$(q "select to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
latest_before=$(q "select coalesce(to_char(max(created_at) at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'), '') from public.audit_log")

pg_dump "$url" --format=custom --no-owner --schema=public --schema=auth --file="$work/database.dump"

# What the copy should hold, for the restore check: rows per table (just after the export),
# the extensions and roles it needs, and the newest audit entry from before it began.
q "select json_build_object(
     'startedAt', '$started',
     'finishedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
     'serverVersion', current_setting('server_version'),
     'latestAuditBefore', nullif('$latest_before', ''),
     'extensions', (select json_agg(json_build_object('name', e.extname, 'schema', n.nspname) order by e.extname)
                    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
                    where e.extname <> 'plpgsql'),
     'roles', (select json_agg(rolname order by rolname) from pg_roles where rolname !~ '^pg_'),
     -- The 10 most recently changed published businesses, each as a fingerprint of the whole
     -- row: after restoring, each must come back exactly (unless it changed during the export).
     'businesses', (select json_agg(json_build_object('id', v.id, 'fingerprint', md5(row_to_json(v)::text)))
                    from (select * from public.vendor where listing_status = 'published'
                          order by updated_at desc limit 10) v),
     'rows', (select json_object_agg(t.table_schema || '.' || t.table_name,
                (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', t.table_schema, t.table_name),
                 false, true, '')))[1]::text::bigint order by t.table_schema, t.table_name)
              from information_schema.tables t
              where t.table_schema in ('public', 'auth') and t.table_type = 'BASE TABLE'))" > "$work/manifest.json"

name="localites-backup-${started//:/}.tar.gpg"
tar -C "$work" -cf - database.dump manifest.json |
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
    --output "$out/$name" 3<<<"$BACKUP_PASSPHRASE"
echo "$major" > "$out/pg-major"
# Early warning: 30 nights must fit in GitHub's free 500 MB of stored files.
size=$(stat -c %s "$out/$name")
if (( size > 12 * 1024 * 1024 )); then
  echo "::warning::This backup is $(( size / 1024 / 1024 )) MB: 30 nights may no longer fit GitHub's free storage. Tell the product owner (runbook F §5)." >&2
fi
echo "$out/$name"
