# Monorepo Cutover Operating Note

This note defines the target shape for a production replacement repository that maintainers can
adopt as the new home for `alchemy-effect`, `distilled`, and `cloudflare-tools`.

The current `codex/monorepo-clean-history` branch is the production-shaped rebuild. It starts from
the real `alchemy-run/alchemy-effect` `main` commit, moves Alchemy into `projects/alchemy` with a
normal rename commit, and imports Distilled and Cloudflare Tools with deterministic prefix-rewritten
histories.

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
the old repository history under the final path. For Alchemy specifically, the branch must keep the
original upstream commits as ancestors so GitHub compares it as ahead of `alchemy-run/main`, not as a
separate unrelated history.

## Why Rebuild Instead Of Patch

The first linear-history attempt prefix-rewrote Alchemy itself. That made the file history look
clean, but it changed every Alchemy commit SHA. GitHub therefore had no common Alchemy commit
identity to compare against and reported the branch as both far ahead and far behind upstream.

The production branch should preserve Alchemy commit identities and only rewrite the histories that
come from separate repositories. That gives both properties maintainers need:

- GitHub sees the branch as ahead-only from `alchemy-run/alchemy-effect:main`.
- Distilled and Cloudflare Tools files live at their final paths for their imported history.

## Expected GitHub Compare Count

GitHub should show the clean branch as `0 behind` the current `alchemy-run/alchemy-effect:main`,
but the `ahead` count will be large. That is expected: it includes the complete prefixed histories
for Distilled and Cloudflare Tools, not just the hand-written monorepo migration commits.

The exact numbers will change as source repositories receive new commits, are re-synced, or receive
additional cutover documentation commits. The desired topology is stable: no commits behind upstream
Alchemy, with the ahead count mostly explained by imported repository history. To inspect the
current split, compare the full ahead count with the first-parent cutover commits:

```bash
git rev-list --left-right --count origin/main...HEAD
git rev-list --count origin/main..HEAD --first-parent
```

## What The Unified Build Surfaced

The monorepo build caught integration issues that were easy to miss while the repositories resolved
their toolchains separately:

- Alchemy's current Cloudflare SDK types and Effect's stricter `catchTag` signature disagree on a
  few runtime Cloudflare error tags (`InvalidZoneIdentifier`, `ZonePurged`). The production branch
  keeps the runtime behavior and switches those handlers to `Effect.catch` with explicit `_tag`
  checks, re-failing unknown errors.
- Cloudflare Tools' `tsdown` declaration build was resolving `rolldown-plugin-dts` against the
  root TypeScript 7 RC package, while that plugin's JavaScript TypeScript path supports TypeScript
  5/6. The production branch moves the Cloudflare Tools declaration builds to
  `dts: { tsgo: true }`, matching the Oddlynew monorepo standard and avoiding a root TypeScript
  downgrade.
- Downstream consumers such as the Nx R2 cache Worker fail immediately if Cloudflare Tools
  declarations are not emitted. That is useful signal: an integration PR touching Alchemy and
  Cloudflare Tools now proves the affected dependency chain in one workspace.

## Branch Strategy

Keep the earlier prototype branches as references only:

```text
codex/monorepo-production-migration
codex/monorepo-linear-history
```

Use the clean rebuild branch for the replacement path:

```text
codex/monorepo-clean-history
```

The new branch should be force-updatable while it is being prepared. Do not open it as the final PR
until the history import, monorepo infrastructure, sync procedure, and release dry-runs are all
verified.

## Rebuild Procedure

Use source mirrors plus fresh filtered clones. Treat filtered clones as disposable:
`git-filter-repo` rewrites history and may remove remotes as a safety measure, so do not use a
filtered clone as the long-lived upstream checkout.

Example shape:

```bash
# source mirrors
git clone --mirror git@github.com:alchemy-run/alchemy-effect.git /tmp/alchemy-effect-source.git
git clone --mirror git@github.com:alchemy-run/distilled.git /tmp/distilled-source.git
git clone --mirror git@github.com:alchemy-run/cloudflare-tools.git /tmp/cloudflare-tools-source.git

# filtered working histories for imported repositories only
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
git clone /tmp/alchemy-effect-source.git /tmp/alchemy-monorepo-clean
cd /tmp/alchemy-monorepo-clean

git switch -c codex/monorepo-clean-history origin/main

mkdir -p projects/alchemy
git ls-tree -z --name-only HEAD |
  while IFS= read -r -d '' entry; do
    git mv "$entry" projects/alchemy/
  done
git commit -m "refactor(alchemy): move source into project folder"

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
2. For Alchemy, merge the upstream branch directly into `codex/monorepo-clean-history`.
3. For Distilled and Cloudflare Tools, re-run the same prefix rewrite into the same final path, then
   merge the rewritten branch into `codex/monorepo-clean-history`.
4. Resolve conflicts only where the monorepo branch and upstream both touched the same files.
5. Move the imported baseline tags (`distilled-v0.25.2`, `cloudflare-tools-v0.11.2`) to the new
   final cutover commit.
6. Run affected validation and release dry-runs.

For Alchemy, preserve the upstream remote and merge normally:

```bash
git fetch origin main
git merge origin/main
```

Git's rename detection should carry root-path changes into `projects/alchemy/...`. If upstream and
the monorepo branch both edited the same file, resolve the conflict at the final monorepo path.

For Distilled, re-run the deterministic prefix rewrite. For example:

```bash
git -C /tmp/distilled-source.git fetch origin main

rm -rf /tmp/distilled-prefix
git clone /tmp/distilled-source.git /tmp/distilled-prefix
git -C /tmp/distilled-prefix filter-repo --to-subdirectory-filter projects/distilled

cd /tmp/alchemy-monorepo-clean
git fetch distilled-prefix
git merge distilled-prefix/main
```

Because the rewrite is deterministic, previously imported commits should stay common ancestors and
only new upstream commits should be merged. If that does not hold, stop and inspect the rewrite
inputs before continuing.

After any resync, keep the imported release baselines on the latest final cutover commit:

```bash
git tag -f -a distilled-v0.25.2 HEAD -m "distilled monorepo baseline 0.25.2"
git tag -f -a cloudflare-tools-v0.11.2 HEAD -m "cloudflare-tools monorepo baseline 0.11.2"
```

Do this before running release dry-runs. Otherwise Nx will treat the migration-sync commits
themselves as unreleased package history for Distilled or Cloudflare Tools.

## Release Baselines

The replacement repository should preserve current release lines:

```text
alchemy:          2.0.0-beta.57 -> 2.0.0-beta.58
distilled:        0.25.2        -> 0.25.3
cloudflare-tools: 0.11.2        -> 0.11.3
```

The cutover branch should carry baseline tags that match the new release groups:

```text
v2.0.0-beta.57
distilled-v0.25.2
cloudflare-tools-v0.11.2
```

For imported repositories, create the namespaced baseline tags on the final monorepo cutover commit,
not on the old standalone release commit. A tag on the pre-merge imported side leaves the unrelated
Alchemy side of the merge outside the tag ancestry, which makes Nx's changelog range include the
whole Alchemy history. A cutover baseline tag says: "this merged monorepo state is the published
0.25.2 / 0.11.2 baseline; only commits after this point belong in the next changelog."

```bash
git tag -a distilled-v0.25.2 HEAD -m "distilled monorepo baseline 0.25.2"
git tag -a cloudflare-tools-v0.11.2 HEAD -m "cloudflare-tools monorepo baseline 0.11.2"
```

The existing Alchemy `v2.0.0-beta.57` tag already works when the replacement is based on the
current `alchemy-effect` repository. If maintainers create a brand-new repository instead of
cutting over the existing one, push that Alchemy tag as well.

Do not use `--first-release` for the imported groups during production cutover. It is useful for a
brand-new release group with no meaningful prior baseline, but here it produces a synthetic
changelog from too much merged history.

## Acceptance Checks

The cutover branch is ready to show as a replacement repository when all of these are true:

- `git merge-base --is-ancestor origin/main HEAD` succeeds.
- `git rev-list --left-right --count origin/main...HEAD` prints `0 <ahead-count>`.
- `git log --follow -- projects/distilled/packages/core/package.json` walks into Distilled release
  history.
- `git log --follow -- projects/cloudflare-tools/packages/cloudflare-runtime/package.json` walks into
  Cloudflare-tools release history.
- `git log --follow -- projects/alchemy/packages/alchemy/package.json` walks into Alchemy release
  history.
- `bun nx show projects` succeeds.
- `bun nx affected -t build --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"` succeeds.
- `bun nx affected -t typecheck --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"` succeeds.
- `bun nx affected -t lint --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"` succeeds.
- Release dry-runs continue the existing release lines:

```bash
bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=alchemy-node-utils --dry-run --skip-publish
bun nx release patch --groups=distilled --dry-run --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --skip-publish
```

- A newly landed upstream commit from Distilled or Cloudflare-tools can be synced through the
  documented prefix-rewrite flow.

## Maintainer Cutover Runbook

Use this only after the branch topology and validation checks pass:

1. Announce a short write freeze on `alchemy-effect`, `distilled`, and `cloudflare-tools`.
2. Fetch each source repository and perform one final sync into `codex/monorepo-clean-history`.
3. Create or move the imported-group baseline tags onto the final cutover commit:
   `distilled-v0.25.2` and `cloudflare-tools-v0.11.2`.
4. Re-run the topology, history, Nx, and release dry-run checks above.
5. Decide whether the replacement lives in the existing `alchemy-effect` repository or a new repo.
6. Configure repository settings before opening the branch for normal work:
   - default branch target;
   - branch protection and required checks for the Nx validation workflow;
   - Actions permissions for `contents: write` and OIDC;
   - repository/environment secrets for npm trusted publishing, Cloudflare, Doppler, and Nx R2
     cache;
   - repository variables for the Nx cache Worker URL and any deployment account IDs.
7. Configure npm trusted publishing for each public package against the final GitHub repository and
   `release` workflow.
8. Push the clean branch and the exact baseline tags only; do not bulk-push imported generic tags.
9. Make the branch the default branch only after the final validation run passes.
10. Keep the old standalone Distilled and Cloudflare Tools repositories read-only until the first
   monorepo release succeeds, then archive or redirect them.

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
