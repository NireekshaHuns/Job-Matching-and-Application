#!/usr/bin/env bash
# Shared helpers for Claude Code hooks. Sourced by the other hook scripts.

# Make Node 20 / pnpm resolve even in a non-interactive hook shell.
setup_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true
  nvm use >/dev/null 2>&1 || true
}

# Read a top-level string field from the hook's JSON stdin payload.
# Usage: json_field '<raw json>' tool_input.file_path
json_field() {
  local json="$1" path="$2"
  printf '%s' "$json" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      try {
        const obj = JSON.parse(d);
        const val = process.argv[1].split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
        process.stdout.write(val == null ? "" : String(val));
      } catch {
        process.stdout.write("");
      }
    });
  ' "$path" 2>/dev/null
}
