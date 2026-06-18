#!/usr/bin/env bash
set -euo pipefail

# This Worker is single-stage shared infrastructure pinned to the prod stage.
# `nx affected -t deploy` also runs on deploy-preview PRs, so in CI only main
# may touch the shared deployment; everywhere else the target is a no-op.
if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "Skipping: nx-r2-cache-worker is shared prod infrastructure; CI deploys it from main only."
  exit 0
fi

exec "$@"
