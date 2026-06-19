# Monorepo Maintainer Summary

This branch models `alchemy-effect`, `distilled`, and `cloudflare-tools` as one Bun/Nx workspace.
The goal is not only to put repositories in one checkout, but to make cross-repository changes
reviewable, testable, cacheable, and releasable as one coherent system.

For the clean replacement-repository cutover procedure, see
[`cutover-operating-note.md`](./cutover-operating-note.md).
For the separate Oddlynew dogfood fork track, see
[`dogfood-distribution.md`](./dogfood-distribution.md).

## What Gets Better

Pull requests that currently span multiple repositories can become one branch with one project
graph. Nx can answer which packages changed, which dependencies must build first, and which checks
can reuse cache artifacts.

The branch also brings over the repo infrastructure that made the Oddlynew monorepo practical:

- shared `@oddlynew/alchemy-typescript-config` presets instead of root/product-local config bases;
- shared `@oddlynew/alchemy-oxlint-config` presets with product-local overrides only where needed;
- inferred `build`, `typecheck`, `lint`, and Alchemy lifecycle targets through private Nx plugins;
- a workspace-owned `@oddlynew/alchemy-node-utils` utility package instead of depending on the upstream
  `@alchemy.run` package scope;
- a self-hosted Nx remote cache Worker backed by R2;
- fixed Nx release groups for `alchemy`, `distilled`, and `cloudflare-tools`;
- a manual release workflow that runs those Nx release groups and defaults to dry-run.

That means an integration PR touching `alchemy` and a Distilled provider can build and test the
affected graph in one place. It also means release automation can bump versions and write package
changelogs from the same commit history. Publishing still depends on the normal npm/GitHub
credentials, but the version and changelog plan is already dry-runnable in this branch.

## Try It In A Fork

A small branch can show the value without touching infrastructure:

```bash
bun install
git switch -c sample/alchemy-distilled-change

# Make any small source edit in one Alchemy package and one Distilled provider.
$EDITOR projects/alchemy/packages/alchemy/src/index.ts
$EDITOR projects/distilled/packages/stripe/src/index.ts

bun nx show projects --affected \
  --files=projects/alchemy/packages/alchemy/src/index.ts,projects/distilled/packages/stripe/src/index.ts

export NX_PRODUCTION_EXCLUDE='@oddlynew/distilled,@oddlynew/cloudflare-tools,@oddlynew/alchemy-website,@oddlynew/alchemy-example-*,@oddlynew/cloudflare-tools-fixture-*'
bun nx affected -t build --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t typecheck --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t lint --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"

bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=alchemy-node-utils --dry-run --skip-publish
bun nx release patch --groups=distilled --dry-run --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --skip-publish
```

That gives a concrete before/after story for the old multi-repo workflow: one PR, one affected
graph, one cached validation path, and one release plan.

The GitHub `release` workflow uses the same release groups. It defaults to dry-run and uses
continuation defaults by group: `alchemy` continues the beta prerelease line, while `alchemy-node-utils`,
`distilled`, and `cloudflare-tools` continue stable patch releases. Dogfood releases require scoped
monorepo baseline tags such as `@oddlynew/distilled@0.25.2` and
`@oddlynew/cloudflare-tools@0.11.2` on the fork-namespace commit, so the first monorepo patch
release produces a clean version-bump range instead of replaying imported history. Disabling dry-run
is the explicit approval for the workflow to publish, and the workflow refuses non-dry releases from
any branch other than `main`.

## Source Layout

Root `packages/` is reserved for shared packages and monorepo infrastructure:

- `alchemy-node-utils`
- `nx-alchemy-plugin`
- `nx-oxlint-plugin`
- `nx-r2-cache-worker`
- `nx-tsdown-plugin`
- `nx-tsgo-plugin`
- `oxlint-config`
- `typescript-config`

Product-owned code lives under `projects/<product>/...`:

- `projects/alchemy/...`
- `projects/distilled/...`
- `projects/cloudflare-tools/...`

This keeps ownership visible in the filesystem while still letting Nx model cross-product
dependencies.

Repo-level `docs/` is only for maintainer and migration notes. Alchemy's own deployable stacks live
as private apps under `projects/alchemy/apps/{github-secrets,nuke,otel,pr-package}` so root remains
shared monorepo structure rather than product-owned code.

## History

Alchemy history is intact in the normal Git sense. The branch starts from the Alchemy repository, and
the Alchemy package was moved into `projects/alchemy/packages/alchemy`. For example:

```bash
git log --follow -- projects/alchemy/packages/alchemy/src/index.ts
```

continues through the original Alchemy commits.

Distilled and Cloudflare-tools history is also intact in the practical file-history sense. This
linear-history branch was rebuilt by prefix-rewriting the source repositories into their final paths
before merging them. That means commands such as:

```bash
git log --follow -- projects/distilled/packages/stripe/package.json
git log --follow -- projects/cloudflare-tools/packages/cloudflare-runtime/package.json
```

walk directly into each original repository's release history without a temporary subtree path.

## Verified Locally

The current branch has been checked with the production/package path rather than every demo surface:

```bash
bun nx build nx-r2-cache-worker
bun nx typecheck nx-r2-cache-worker
bun nx test nx-r2-cache-worker
bun nx lint nx-r2-cache-worker
export NX_PRODUCTION_EXCLUDE='@oddlynew/distilled,@oddlynew/cloudflare-tools,@oddlynew/alchemy-website,@oddlynew/alchemy-example-*,@oddlynew/cloudflare-tools-fixture-*'
bun nx affected -t build --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t typecheck --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t lint --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
git diff --check
bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=alchemy-node-utils --dry-run --skip-publish
bun nx release patch --groups=distilled --dry-run --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --skip-publish
```

The release dry-runs complete without writing files. The imported release groups resolve their
current versions from monorepo baseline tags on the cutover commit, then continue as normal patch
releases.

## Remaining Operational Work

The R2 cache Worker is in the repo and tested, but the remote cache has not been proven through a
real CI run yet. The production rollout still needs:

- `NX_R2_CACHE_TRUSTED_TOKEN` and `NX_R2_CACHE_BRANCH_TOKEN` in Doppler;
- `bun nx deploy nx-r2-cache-worker`;
- `NX_R2_CACHE_SERVER_URL` in GitHub repository variables;
- one PR CI run proving branch cache writes;
- one protected `main` run proving trusted cache writes.

The branch also intentionally keeps non-hermetic demo and generated surfaces out of required CI.
Imported package tests are not enabled wholesale yet either: many exercise live external services and
require provider secrets. The migration updates Distilled tests for Vitest 4 syntax, but the new
`nx-r2-cache-worker` tests are the only required test gate because that package is new repo
infrastructure. Broader package tests can be promoted later after each target is made hermetic.
