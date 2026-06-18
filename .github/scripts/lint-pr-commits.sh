#!/usr/bin/env bash
set -euo pipefail

base_sha="${1:?Usage: lint-pr-commits.sh <base-sha> <head-sha>}"
head_sha="${2:?Usage: lint-pr-commits.sh <base-sha> <head-sha>}"

commit_count="$(git rev-list --first-parent --count "${base_sha}..${head_sha}")"

if [ "${commit_count}" -eq 0 ]; then
  echo "No first-parent commits to lint."
  exit 0
fi

git rev-list --first-parent --reverse "${base_sha}..${head_sha}" | while read -r commit; do
  echo "Linting commit ${commit}"
  git log -1 --format=%B "${commit}" | bunx --bun commitlint --verbose
done
