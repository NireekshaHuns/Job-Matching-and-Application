#!/usr/bin/env bash
# PreToolUse guardrail. Blocks (exit 2):
#   - writing/editing .env or other secret files (.env.example is allowed)
#   - `rm -rf` style recursive force deletes
#   - force-pushing to main
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$DIR/lib.sh"

PAYLOAD="$(cat)"
TOOL="$(json_field "$PAYLOAD" tool_name)"

block() {
  echo "BLOCKED by guardrail: $1" >&2
  exit 2
}

case "$TOOL" in
  Write | Edit | MultiEdit)
    FILE="$(json_field "$PAYLOAD" tool_input.file_path)"
    base="$(basename "$FILE")"
    # Allow the committed template; block real env / secret files.
    if [ "$base" != ".env.example" ]; then
      case "$base" in
        .env | .env.* | *.pem | *.key | id_rsa | id_ed25519 | *.p12 | *.pfx)
          block "attempt to write secret file '$base'. Put secrets in .env (git-ignored), not tracked files."
          ;;
      esac
    fi
    ;;
  Bash)
    CMD="$(json_field "$PAYLOAD" tool_input.command)"
    # Recursive force delete.
    if printf '%s' "$CMD" | grep -Eq 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-r[[:space:]]+-f|-f[[:space:]]+-r)'; then
      block "'rm -rf' detected. Delete specific paths deliberately instead."
    fi
    # Force-push to main.
    if printf '%s' "$CMD" | grep -Eq 'git[[:space:]]+push' \
      && printf '%s' "$CMD" | grep -Eq '(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$)|\+main)' \
      && printf '%s' "$CMD" | grep -Eq '(^|[[:space:]])main([[:space:]]|$|:)'; then
      block "force-push to main. Never force-push the default branch."
    fi
    # Writing secrets into tracked files via shell redirection.
    if printf '%s' "$CMD" | grep -Eq '>[[:space:]]*\.env([[:space:]]|$)|>[[:space:]]*\.env\.(local|production|development)'; then
      block "writing to a .env file via shell. Edit .env manually; keep it git-ignored."
    fi
    ;;
esac
exit 0
