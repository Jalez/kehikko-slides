#!/usr/bin/env bash
#
# What a host runs to start this module: no arguments, foreground, `exec`.
#
#   - No arguments, because a registration names a directory and this script,
#     never a command line a host would hand to a shell.
#   - No port here. It is PREFERRED_PORT in manifest.ts, and `serves()` in
#     vite.config.ts acts on it: takes it when free, honours $PORT from a host,
#     and moves (rewriting the registration) when something else has it.
#   - `exec` in the foreground, so the pid a host holds is the one that stops it.
#
# It does not register. That is `bun run register`, a person's decision.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite
