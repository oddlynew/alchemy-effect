# Oddlynew Dogfood Distribution

This note defines the fork track for using the monorepo as an Oddlynew-owned distribution of
Alchemy, Distilled, and Cloudflare Tools. It is intentionally separate from
[`clean-history-operating-note.md`](./clean-history-operating-note.md), which describes the
clean-history sync lane.

## Branch Roles

Keep two branches with different promises:

```text
codex/monorepo-clean-history   # upstream sync and clean-history lane
codex/monorepo-dogfood         # Oddlynew-owned fork distribution
```

After the Oddlynew fork is promoted, `main` should become the dogfood line. Until that happens,
`codex/monorepo-dogfood` plays the role that `main` will later play:

```text
main                           # future Oddlynew dogfood branch
codex/monorepo-clean-history   # upstream sync and clean-history lane
```

The clean branch should stay mechanically comparable to upstream. It keeps upstream package names,
upstream release lines, imported histories, and monorepo infrastructure. It should not carry
Oddlynew package names, dogfood feature work, or fork-specific publishing behavior.

The dogfood branch is allowed to diverge. It should prove the full cycle: one monorepo, one affected
graph, R2-backed Nx cache, CI, real Cloudflare-backed validation where useful, automatic release,
and packages published under an Oddlynew-controlled namespace.

## Package Identity

The dogfood branch should be a coherent fork, not a set of ad hoc npm aliases. Package manifests,
workspace dependencies, import specifiers, release groups, changelogs, and docs should converge on
`@oddlynew/*` package identities.

Initial public mapping:

| Upstream package                                      | Dogfood package                                  |
| ----------------------------------------------------- | ------------------------------------------------ |
| `alchemy`                                             | `@oddlynew/alchemy`                              |
| `@alchemy.run/better-auth`                            | `@oddlynew/alchemy-better-auth`                  |
| `@alchemy.run/pr-package`                             | `@oddlynew/alchemy-pr-package`                   |
| `@alchemy.run/node-utils`                             | `@oddlynew/alchemy-node-utils`                    |
| `@distilled.cloud/core`                               | `@oddlynew/distilled-core`                       |
| `@distilled.cloud/<provider>`                         | `@oddlynew/distilled-<provider>`                 |
| `@distilled.cloud/cloudflare-runtime`                 | `@oddlynew/distilled-cloudflare-runtime`         |
| `@distilled.cloud/cloudflare-vite-plugin`             | `@oddlynew/distilled-cloudflare-vite-plugin`     |
| `@distilled.cloud/cloudflare-rolldown-plugin`         | `@oddlynew/distilled-cloudflare-rolldown-plugin` |
| private Nx, config, and cache infra packages          | `@oddlynew/alchemy-nx-*` and `@oddlynew/alchemy-*-config` |

The `alchemy` CLI binary can remain named `alchemy`. The package identity changes; the command name
does not have to.

Do not rely on permanent npm alias dependencies such as
`"alchemy": "npm:@oddlynew/alchemy@..."` as the steady state. Aliases are acceptable as short
transition aids for downstream consumers, but the dogfood branch itself should import and depend on
the fork package names directly.

## Release Model

Steady-state dogfood releases should use Nx release directly. Do not add hand-published package
scripts, tarball staging scripts, or manifest rewrite scripts as the publishing path.

The target release loop is the Oddlynew shape:

1. CI validates the affected graph.
2. Deployment or live-provider checks run where a project requires them.
3. `bun nx release` computes versions from conventional commits.
4. Nx writes package changelogs and tags.
5. Nx publishes the public packages to npm with provenance enabled.

Dogfood release tags are scoped to the fork identities. `@oddlynew/distilled@...` and
`@oddlynew/cloudflare-tools@...` are release-group tags, not aggregate npm packages:

- `@oddlynew/alchemy@<version>`
- `@oddlynew/alchemy-node-utils@<version>`
- `@oddlynew/distilled@<version>`
- `@oddlynew/cloudflare-tools@<version>`

The dogfood branch publishes npm `latest` through one Nx release workflow. It runs as a daily train
from protected `main`, skips release groups with no relevant package changes since their last
dogfood tag, and keeps manual `workflow_dispatch` for dry-runs and hotfix releases.

Required credentials for the full loop:

- npm publishing for the `@oddlynew` scope, preferably through GitHub Actions trusted publishing;
- release bot credentials for pushing version/changelog commits and tags;
- `NX_R2_CACHE_SERVER_URL`, plus `NX_R2_CACHE_BRANCH_TOKEN` and
  `NX_R2_CACHE_TRUSTED_TOKEN` stored in Doppler project `alchemy-effect-fork`, config `prd`;
- Cloudflare account credentials for the cache Worker and any live Alchemy validation stacks;
- provider-specific test credentials only for tests that are deliberately promoted into required CI.

## Relationship To Clean History

The dogfood branch should keep taking updates from `codex/monorepo-clean-history`. That branch is
the clean upstream-sync point. The expected flow is:

```bash
git switch codex/monorepo-clean-history
# sync upstream Alchemy, Distilled, and Cloudflare Tools
# run clean-history acceptance checks

git switch codex/monorepo-dogfood
git merge codex/monorepo-clean-history
# resolve fork-namespace conflicts in the dogfood branch
# run dogfood CI/release dry-runs
```

This keeps the clean-history lane unpolluted while still letting the dogfood branch move
fast, publish real packages, and accumulate real cross-repo feature work.

## Periodic Upstream Sync

Treat upstream sync as a normal maintenance loop, not as a one-off migration step. The stable model
is two lanes:

- clean lane: imports upstream Alchemy, Distilled, and Cloudflare Tools, plus only monorepo
  infrastructure needed to preserve the monorepo shape;
- dogfood lane: merges the clean lane and carries Oddlynew package names, publishing configuration,
  CI hardening, and product work.

Do not sync upstream repositories directly into the dogfood lane. Always update
`codex/monorepo-clean-history` first, validate it, then merge that branch into dogfood. This keeps a
branch that can be compared against upstream without Oddlynew-specific product choices, and it gives
dogfood one clear integration point for upstream changes.

Recommended cadence:

- run the sync before starting any feature that is likely to touch upstream-owned files;
- run it again before publishing a dogfood release;
- run it whenever upstream Alchemy, Distilled, or Cloudflare Tools cuts a release that we want to
  consume;
- avoid letting dogfood drift for weeks if active upstream development is happening in the same
  files we are changing.

Clean-lane sync procedure:

```bash
git switch codex/monorepo-clean-history

# Alchemy keeps commit identity, so merge it normally.
git fetch origin main
git merge origin/main

# Distilled and Cloudflare Tools are re-imported through deterministic prefix rewrites.
# See clean-history-operating-note.md for the exact filter-repo commands.
git fetch distilled-prefix-latest main
git merge distilled-prefix-latest/main

git fetch cloudflare-tools-prefix-latest main
git merge cloudflare-tools-prefix-latest/main
```

After resolving conflicts on the clean lane, update imported release baseline tags only when the
new upstream commits represent already-published releases. If upstream includes unreleased commits,
keep the previous baseline before those commits so the next monorepo release includes them in the
changelog range.

Dogfood merge procedure:

```bash
git switch main # or codex/monorepo-dogfood until the fork is promoted
git merge codex/monorepo-clean-history
```

Expected dogfood conflicts are usually package identity conflicts: package names, workspace
dependencies, repository URLs, release-tag names, and imports that changed from upstream scopes to
`@oddlynew/*`. Resolve those in favor of the dogfood identity while preserving the upstream source
change that caused the conflict.

Run the dogfood verification before publishing or building features on top:

```bash
bun install --frozen-lockfile

export NX_VALIDATION_EXCLUDE='@oddlynew/alchemy-example-*,@oddlynew/cloudflare-tools-fixture-*'
GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t build --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"
GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t typecheck --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"
GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t lint --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"

bun oxfmt --check .
git diff --check

bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=alchemy-node-utils --dry-run --skip-publish
bun nx release patch --groups=distilled --dry-run --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --skip-publish
```

Feature work remains maintainable on top of this as long as it is layered on dogfood/topic branches.
When upstream advances, sync clean history again, merge it into dogfood, then rebase or merge feature
branches onto the updated dogfood lane. Conflict cost should stay proportional to real overlap: if
both upstream and dogfood edited the same final file, resolve it once in dogfood; unrelated
Oddlynew-only features should keep applying normally.

## Using The Two Branches

Use the branches for different operational jobs:

- clean branch: upstream sync, history import checks, and package-name-neutral architecture changes.
- dogfood branch: real fork work, `@oddlynew/*` package identity, CI, cache, releases, Cloudflare
  validation, and feature branches.

Keep this split even after dogfood becomes `main`. The clean branch is the durable upstream-sync
interface; dogfood/main is the branch that proves the fork works as a production monorepo.
