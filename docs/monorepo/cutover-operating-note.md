# Monorepo Cutover Operating Note

This note defines the target shape for a production replacement repository that maintainers can
adopt as the new home for `alchemy-effect`, `distilled`, and `cloudflare-tools`.

The current `codex/monorepo-production-migration` branch is a working prototype. The desired cutover
branch should be rebuilt from deterministic, prefix-rewritten histories so the result is also clean
as a long-term Git repository.

## Target Invariant

The replacement repository should behave as if each source repository had always lived at its final
monorepo path:

```text
projects/alchemy/...
projects/distilled/...
projects/cloudflare-tools/...
packages/...                 # shared monorepo infrastructure only
```

For imported product code, `git log --follow` and GitHub file history should naturally walk through
the old repository history under the final path. A maintainer should not need to know about temporary
import paths such as `distilled/` or `cloudflare-tools/`.

## Why Rebuild Instead Of Patch

The prototype imported repositories with subtree commits and then moved files into the final layout.
That preserves commit objects, but the file-history UX is not ideal: GitHub and ordinary
`git log --follow projects/distilled/...` do not always walk cleanly into the imported repository
history.

The production branch should instead rewrite each source repository into its final subdirectory
before merging it into the monorepo. That makes the final paths the only paths those files ever had
inside the replacement repository.

## Branch Strategy

Keep the prototype branch as a reference:

```text
codex/monorepo-production-migration
```

Create a new cutover branch for the clean history rebuild:

```text
codex/monorepo-linear-history
```

The new branch should be force-updatable while it is being prepared. Do not open it as the final PR
until the history import, monorepo infrastructure, sync procedure, and release dry-runs are all
verified.

## Rebuild Procedure

Use source mirrors plus fresh filtered clones. Treat filtered clones as disposable: `git
filter-repo` rewrites history and may remove remotes as a safety measure, so do not use a filtered
clone as the long-lived upstream checkout.

Example shape:

```bash
# source mirrors
git clone --mirror git@github.com:alchemy-run/alchemy-effect.git /tmp/alchemy-effect-source.git
git clone --mirror git@github.com:alchemy-run/distilled.git /tmp/distilled-source.git
git clone --mirror git@github.com:alchemy-run/cloudflare-tools.git /tmp/cloudflare-tools-source.git

# filtered working histories
git clone /tmp/alchemy-effect-source.git /tmp/alchemy-effect-prefix
git -C /tmp/alchemy-effect-prefix filter-repo --to-subdirectory-filter projects/alchemy

git clone /tmp/distilled-source.git /tmp/distilled-prefix
git -C /tmp/distilled-prefix filter-repo --to-subdirectory-filter projects/distilled

git clone /tmp/cloudflare-tools-source.git /tmp/cloudflare-tools-prefix
git -C /tmp/cloudflare-tools-prefix filter-repo --to-subdirectory-filter projects/cloudflare-tools
```

By default, import branch history first and create the release baseline tags after the final merge.
If full old tag history is imported, rename non-Alchemy tags with a deliberately reviewed mapping so
different repositories cannot collide on generic tags such as `v0.25.2`.

Then create the replacement branch by merging the rewritten histories:

```bash
git init /tmp/alchemy-monorepo-linear
cd /tmp/alchemy-monorepo-linear

git remote add alchemy-prefix /tmp/alchemy-effect-prefix
git fetch alchemy-prefix
git switch -c codex/monorepo-linear-history alchemy-prefix/main

git remote add distilled-prefix /tmp/distilled-prefix
git fetch distilled-prefix
git merge --allow-unrelated-histories distilled-prefix/main

git remote add cloudflare-tools-prefix /tmp/cloudflare-tools-prefix
git fetch cloudflare-tools-prefix
git merge --allow-unrelated-histories cloudflare-tools-prefix/main
```

After the histories are merged, apply the monorepo infrastructure from the prototype branch:

- root `package.json`, `bun.lock`, `nx.json`, `.github/`, and root docs;
- `packages/nx-*` plugins;
- `packages/oxlint-config`;
- `packages/typescript-config`;
- `packages/nx-r2-cache-worker`;
- package-local tsconfig, oxlint, Vitest 4, and build target fixes;
- release workflow and release-group configuration.

Prefer replaying coherent commits from the prototype branch where possible. If a cherry-pick is too
conflict-heavy because paths differ, port the final file contents intentionally and keep the commit
message scoped to the monorepo concern.

## Syncing New Upstream Commits During Migration

While the cutover branch is being prepared, source repositories may receive new commits. The sync
process must be deterministic and repeatable.

For each source repo:

1. Fetch the latest upstream branch.
2. Re-run the same prefix rewrite into the same final path.
3. Fetch that rewritten history into the monorepo cutover worktree.
4. Merge the rewritten branch into `codex/monorepo-linear-history`.
5. Resolve conflicts only where the monorepo branch and upstream both touched the same files.
6. Run affected validation and release dry-runs.

For Distilled, for example:

```bash
git -C /tmp/distilled-source.git fetch origin main

rm -rf /tmp/distilled-prefix
git clone /tmp/distilled-source.git /tmp/distilled-prefix
git -C /tmp/distilled-prefix filter-repo --to-subdirectory-filter projects/distilled

cd /tmp/alchemy-monorepo-linear
git fetch distilled-prefix
git merge distilled-prefix/main
```

Because the rewrite is deterministic, previously imported commits should stay common ancestors and
only new upstream commits should be merged. If that does not hold, stop and inspect the rewrite
inputs before continuing.

## Release Baselines

The replacement repository should preserve current release lines:

```text
alchemy:          2.0.0-beta.56 -> 2.0.0-beta.57
distilled:        0.25.2        -> 0.25.3
cloudflare-tools: 0.11.0        -> 0.11.1
```

The cutover branch should either import or create baseline tags that match the new release groups:

```text
v2.0.0-beta.56
distilled-v0.25.2
cloudflare-tools-v0.11.0
```

Those baselines preserve the release-line intent, but this branch still uses `--first-release` for
the first imported Distilled and Cloudflare Tools monorepo releases because Nx cannot derive their
previous changelog range from the imported standalone repository tags. After the first monorepo-native
`distilled-v*` and `cloudflare-tools-v*` tags exist, normal patch releases should omit
`--first-release`.

## Acceptance Checks

The cutover branch is ready to show as a replacement repository when all of these are true:

- `git log --follow -- projects/distilled/packages/core/package.json` walks into Distilled release
  history.
- `git log --follow -- projects/cloudflare-tools/packages/cloudflare-runtime/package.json` walks into
  Cloudflare-tools release history.
- `git log --follow -- projects/alchemy/packages/alchemy/package.json` walks into Alchemy release
  history.
- `bun nx show projects` succeeds.
- `.github/scripts/run-affected-production-target.ts build --parallel=6` succeeds.
- `.github/scripts/run-affected-production-target.ts typecheck --parallel=6` succeeds.
- `.github/scripts/run-affected-production-target.ts lint --parallel=6` succeeds.
- Release dry-runs continue the existing release lines:

```bash
bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=distilled --dry-run --first-release --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --first-release --skip-publish
```

- A newly landed upstream commit from Distilled or Cloudflare-tools can be synced through the
  documented prefix-rewrite flow.

## Non-Goals For The First Cutover

Do not block the replacement repository on unrelated cleanup:

- enabling every imported demo or live-service test as required CI;
- reformatting generated SDK output unless required for touched files;
- changing package names;
- changing release policy beyond preserving the current release lines;
- moving source code outside the final `projects/<product>/...` layout.

## Open Decisions

- Whether the final repository should live under the existing `alchemy-effect` repository or a new
  repository.
- Whether old standalone repositories are archived immediately after the first monorepo release or
  kept read-only for a transition period.
- Whether release baseline tags are imported from old repos or created as new monorepo tags during
  cutover.
- Whether `version.updateDependents` remains `"never"` for the first cutover or moves to `"auto"`
  after the release-tag policy is proven.
