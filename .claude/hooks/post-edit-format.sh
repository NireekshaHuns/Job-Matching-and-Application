#!/usr/bin/env bash
# PostToolUse (Edit|Write): Prettier-format the edited .ts/.tsx file, then typecheck
# the project. A typecheck failure exits 2 so the error is surfaced back to Claude.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$DIR/lib.sh"

PAYLOAD="$(cat)"
FILE="$(json_field "$PAYLOAD" tool_input.file_path)"

# Only act on TypeScript sources.
case "$FILE" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

setup_node

[ -f "$FILE" ] && pnpm exec prettier --write "$FILE" >/dev/null 2>&1

if ! OUT="$(pnpm typecheck 2>&1)"; then
  echo "Typecheck failed after editing $FILE:" >&2
  echo "$OUT" | tail -30 >&2
  exit 2
fi
exit 0
