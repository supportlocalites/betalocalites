#!/usr/bin/env bash
# Builds Supabase's open-source sign-in server (github.com/supabase/auth) for the admin
# access tests (tests/e2e). Test-only: never deployed; the live site uses Supabase's own.
# Pinned to one commit (master, 22 September 2026) through Go's public module mirror.
# Usage: bash scripts/e2e/build-auth-server.sh .e2e/auth-server
set -euo pipefail
VERSION=v1.11.1-0.20260922104245-ce9a8eee0cc0 # supabase/auth commit ce9a8eee
OUT="$(realpath -m "${1:-.e2e/auth-server}")"
if [ -x "$OUT" ]; then echo "Sign-in test server already built."; exit 0; fi
mkdir -p "$(dirname "$OUT")"
WORK="$(mktemp -d)"
go mod download -json "github.com/supabase/auth@$VERSION" > "$WORK/download.json"
SRC="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).Dir)" "$WORK/download.json")"
cp -r "$SRC" "$WORK/src"
chmod -R u+w "$WORK/src"
cd "$WORK/src"
# The module download leaves out a small folder its go.mod points at; use the upstream package.
sed -i 's#^replace github.com/joho/godotenv => ./internal/forks/godotenv#// &#' go.mod
go get github.com/joho/godotenv@v1.5.1
go build -o "$OUT" .
echo "Built $OUT"
