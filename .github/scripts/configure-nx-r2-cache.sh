#!/usr/bin/env bash
set -euo pipefail

# Configure self-hosted Nx remote caching when CI has cache credentials.
# Main pushes write the trusted tier. PRs and branches write isolated branch
# tiers. Fork PRs usually run without secrets and fall back to local Nx cache.
sanitize_namespace() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-'
}

if [ "${GITHUB_EVENT_NAME:-}" = "push" ] && [ "${GITHUB_REF:-}" = "refs/heads/main" ]; then
  cache_server_url="${NX_R2_CACHE_SERVER_URL:?NX_R2_CACHE_SERVER_URL must be set for trusted cache writes}"
  scope="trusted"
  token="${NX_R2_CACHE_TRUSTED_TOKEN:?trusted cache writes require NX_R2_CACHE_TRUSTED_TOKEN}"
else
  if [ -z "${NX_R2_CACHE_SERVER_URL:-}" ] || [ -z "${NX_R2_CACHE_BRANCH_TOKEN:-}" ]; then
    echo "::notice::Nx remote cache disabled: cache credentials unavailable in this run."
    exit 0
  fi

  cache_server_url="${NX_R2_CACHE_SERVER_URL}"

  if [ -n "${PULL_REQUEST:-}" ]; then
    scope="branches/pr-${PULL_REQUEST}"
  elif [[ "${GITHUB_REF:-}" =~ ^refs/pull/([0-9]+)/ ]]; then
    scope="branches/pr-${BASH_REMATCH[1]}"
  else
    ref_name="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-manual}}"
    scope="branches/$(sanitize_namespace "$ref_name")"
  fi

  token="${NX_R2_CACHE_BRANCH_TOKEN}"
fi

cache_server_url="${cache_server_url%/}"

echo "::add-mask::${token}"

{
  echo "NX_SELF_HOSTED_REMOTE_CACHE_SERVER=${cache_server_url}/${scope}"
  echo "NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=${token}"
} >> "${GITHUB_ENV:?GITHUB_ENV must be set}"
