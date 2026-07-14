#!/usr/bin/env bash
# Stop: run the test suite so a turn never finishes with failing tests. Exit 2 to
# block stopping and surface failures. Respects stop_hook_active to avoid loops.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$DIR/lib.sh"

PAYLOAD="$(cat)"
ACTIVE="$(json_field "$PAYLOAD" stop_hook_active)"
[ "$ACTIVE" = "true" ] && exit 0

setup_node

if ! OUT="$(pnpm test 2>&1)"; then
  echo "Tests are failing — resolve before finishing:" >&2
  echo "$OUT" | tail -40 >&2
  exit 2
fi
exit 0
