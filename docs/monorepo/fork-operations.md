# Monorepo Fork Operations

This note is the day-to-day operating guide for the Oddlynew Alchemy fork. It assumes this
repository is run as an active monorepo distribution of Alchemy, Distilled, and Cloudflare Tools
under the `@oddlynew/*` namespace.

For the branch model and periodic upstream sync process, see
[`dogfood-distribution.md`](./dogfood-distribution.md). For the clean-history import procedure, see
[`clean-history-operating-note.md`](./clean-history-operating-note.md). For the full architecture notes, see
[`migration.md`](./migration.md).

## Operating Model

Use the dogfood line as the active fork:

```text
main                           # future active dogfood branch
codex/monorepo-dogfood         # active dogfood branch until promotion
codex/monorepo-clean-history   # upstream sync and clean-history lane
```

Feature work should branch from dogfood/main. Upstream Alchemy, Distilled, and Cloudflare Tools
changes should land in `codex/monorepo-clean-history` first, then be merged into dogfood. That keeps
fork-specific package names, release tags, and publishing configuration isolated from the
upstream-sync lane.

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

Each real package, app, example, fixture, or infrastructure unit has its own `package.json` and Nx
project. Product-root aggregate package manifests were removed so the graph behaves like the
Oddlynew monorepo: every workspace project is something that can actually build, typecheck, lint, or
release.

Repo-level `docs/` is only for fork and migration operations. Alchemy's own deployable stacks live
as private apps under `projects/alchemy/apps/{github-secrets,nuke,otel,pr-package}` so the root stays
shared monorepo structure rather than product-owned code.

## Daily Validation

Use Bun through Nx. Avoid invoking tool binaries directly unless debugging a target implementation.

```bash
bun install --frozen-lockfile
bun nx show projects
```

For normal package work:

```bash
bun nx build <project>
bun nx typecheck <project>
bun nx lint <project>
bun nx test <project> --run
```

For branch-level validation, use the same production/package boundary as CI:

```bash
export NX_VALIDATION_EXCLUDE='@oddlynew/alchemy-example-*,@oddlynew/cloudflare-tools-fixture-*'

GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t build --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"
GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t typecheck --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"
GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t lint --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"
GOMAXPROCS=4 NX_DAEMON=false bun nx affected -t test --parallel=3 --exclude='*,!tag:test:ci'

bun oxfmt --check .
git diff --check
```

The excluded examples and fixtures remain in the Nx graph and can be run directly. They are not
part of the default production gate because not all of them are hermetic yet. CI test promotion is
tag-based: add `test:ci` to hermetic packages when they should join the required affected test gate.

## Deployable Stacks

Deployable Alchemy stacks are Nx projects. Avoid root-level deploy aliases; use the project target
directly so build dependencies, affected selection, and target metadata stay visible to Nx.

General form:

```bash
bun nx plan <project>
bun nx deploy <project>
bun nx destroy <project>
bun nx logs <project>
```

Use environment variables to select credentials and stages:

```bash
doppler run --project alchemy-effect-fork --config prd -- env STAGE=prod ALCHEMY_PROFILE=prod bun nx deploy @oddlynew/alchemy-otel
doppler run --project alchemy-effect-fork --config prd -- env ALCHEMY_PROFILE=admin bun nx deploy @oddlynew/alchemy-github-secrets
doppler run --project alchemy-effect-fork --config prd -- env STAGE=prod ALCHEMY_PROFILE=prod bun nx deploy @oddlynew/alchemy-website
DOPPLER_CONFIG=prd bun nx deploy nx-r2-cache-worker
```

`@oddlynew/alchemy-github-secrets` is a private bootstrap stack. It writes GitHub Actions secrets
and variables for this fork, including the Doppler token, CI Cloudflare account/token values, PR
package publishing token, and AWS OIDC role metadata. Because it can mint or publish privileged CI
credentials, run it intentionally with the `admin` Alchemy profile rather than through broad affected
deployment.

`bun nx affected -t deploy` is technically available, but it should not be the default production
operator path. Use affected targets for validation and, where useful, protected preview planning.
Production infrastructure deploys should remain explicit project selections or protected workflow
jobs that use affected only as their selector.

The CI deploy job bootstraps the Cloudflare state store before running `nx deploy`. Alchemy's
regular deploy path intentionally does not auto-bootstrap in CI, so a new Cloudflare account must
either run `alchemy cloudflare bootstrap` once or rely on the protected main deploy job to run that
idempotent bootstrap step with the configured GitHub environment secrets.

The production website custom domain is fork-specific. Set the GitHub Actions variable
`ALCHEMY_WEBSITE_DOMAIN` only after the configured Cloudflare account owns the parent zone. Leave it
unset to deploy the Worker without a custom domain. `ALCHEMY_WEBSITE_WORKER_NAME` is also optional
and only needed when adopting an existing production Worker name.

## Release Operations

`nx.json` models four public release groups:

- `alchemy`: `@oddlynew/alchemy`, `@oddlynew/alchemy-better-auth`,
  `@oddlynew/alchemy-pr-package`
- `alchemy-node-utils`: `@oddlynew/alchemy-node-utils`
- `distilled`: the public `@oddlynew/distilled-*` provider packages
- `cloudflare-tools`: the public Cloudflare runtime, Vite plugin, and Rolldown plugin packages

Dry-run the groups before publishing:

```bash
bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=alchemy-node-utils --dry-run --skip-publish
bun nx release patch --groups=distilled --dry-run --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --skip-publish
```

Current continuation lines:

```text
@oddlynew/alchemy:               2.0.0-beta.57 -> 2.0.0-beta.58
@oddlynew/alchemy-node-utils:    0.0.5         -> 0.0.6
@oddlynew/distilled group:       0.26.1        -> 0.26.2
@oddlynew/cloudflare-tools group: 0.11.2       -> 0.11.3
```

The dogfood release groups require scoped monorepo baseline tags on commits that represent each
group's latest published release:

```bash
git tag -a "@oddlynew/alchemy@2.0.0-beta.57" HEAD -m "oddlynew alchemy dogfood baseline 2.0.0-beta.57"
git tag -a "@oddlynew/alchemy-node-utils@0.0.5" HEAD -m "oddlynew alchemy-node-utils dogfood baseline 0.0.5"
git tag -a "@oddlynew/distilled@0.26.1" HEAD -m "oddlynew distilled dogfood baseline 0.26.1"
git tag -a "@oddlynew/cloudflare-tools@0.11.2" HEAD -m "oddlynew cloudflare tools dogfood baseline 0.11.2"
```

`@oddlynew/distilled@...` and `@oddlynew/cloudflare-tools@...` are release-group tags, not
aggregate npm packages. They keep Nx's changelog range focused on commits after the latest published
state. Do not place these tags only on old imported-side release commits; after merging unrelated
histories, that can make Nx include unrelated Alchemy history in the changelog range.

The GitHub `release` workflow publishes npm `latest` through a daily release train from protected
`main`. It also exposes manual `workflow_dispatch` for dry-runs and hotfix releases. Non-dry
releases are refused outside `main`, the workflow verifies the matching dogfood baseline tag, skips
groups with no relevant changes unless `force` is set, runs each package's build before publish, and
pushes the release commit and tags.

## Remote Cache

Local Nx caching works with no secrets. Remote cache is opt-in through environment variables so fork
PRs and local checkouts remain safe by default.

The repo includes a self-hosted Worker/R2 implementation at `packages/nx-r2-cache-worker` and CI
wiring in `.github/scripts/configure-nx-r2-cache.sh`.

```bash
bun nx plan nx-r2-cache-worker
bun nx deploy nx-r2-cache-worker
```

The dogfood fork uses Doppler project `alchemy-effect-fork`. The real production config is `prd`.
Keep the cache Worker secrets in Doppler and let deployment commands inject them from there. For
local inspection or manual tooling, `bun download:env:prd` writes an uncommitted `.env.prd` file; it
is a convenience file, not the source of truth.

CI cache variables:

- `NX_R2_CACHE_SERVER_URL` as a repository variable;
- `NX_R2_CACHE_BRANCH_TOKEN` as a repository secret available to PR/branch CI;
- `NX_R2_CACHE_TRUSTED_TOKEN` as an environment secret available only to protected `main` pushes.

If a cache deployment is stuck in `replaced` state after moving accounts, do not run a broad state
clear or destroy. The old replacement edge can point at a Worker in the previous Cloudflare account,
which makes destroy fail on that account's delete endpoint. Inspect the cache stack only, then clear
and redeploy only that stack/stage:

```bash
doppler run --project alchemy-effect-fork --config prd -- \
  bun alchemy state get packages/nx-r2-cache-worker/alchemy.run.ts \
    --stack nx-r2-cache-worker \
    --stage prod \
    --fqn NxR2CacheWorker

doppler run --project alchemy-effect-fork --config prd -- \
  bun alchemy state clear packages/nx-r2-cache-worker/alchemy.run.ts \
    --stack nx-r2-cache-worker \
    --stage prod \
    --yes

DOPPLER_CONFIG=prd bun nx deploy nx-r2-cache-worker
```

After the repair, `DOPPLER_CONFIG=prd bun nx plan nx-r2-cache-worker` should report only noops.
Delete any orphaned cache Worker from the current account only after confirming it is not the Worker
recorded in state.

The cache topology is two-tier:

| Tier         | Written by                    | Read by                                 | Purpose                         |
| ------------ | ----------------------------- | --------------------------------------- | ------------------------------- |
| `trusted`    | protected `main` CI           | everyone through trusted fall-through   | artifacts allowed to ship       |
| `branches/*` | PR CI and developer branches  | that branch namespace plus trusted miss | fast untrusted iteration        |

This avoids untrusted PRs writing to the cache namespace used by production builds. If cache
credentials are missing, CI prints a notice and uses only local Nx cache.

## Upstream Sync

Run upstream sync through the clean-history lane first:

```bash
git switch codex/monorepo-clean-history
# sync Alchemy normally and re-import Distilled/Cloudflare Tools through prefix rewrites
# run clean-history validation

git switch main # or codex/monorepo-dogfood until promotion
git merge codex/monorepo-clean-history
# preserve @oddlynew/* package identity while keeping upstream source changes
```

Full sync details live in [`dogfood-distribution.md`](./dogfood-distribution.md) and the
prefix-rewrite procedure lives in
[`clean-history-operating-note.md`](./clean-history-operating-note.md).

## Current Gaps

The fork is operational, but these areas are still deliberate hardening follow-ups:

- required CI does not yet run all affected hermetic package tests;
- live-provider tests need explicit credentials and should stay out of normal PR paths until each is
  scoped;
- first real npm publish still needs provenance verification in the `@oddlynew` scope;
- no PR preview package publishing path is configured; use the daily/manual `latest` train for npm
  distribution.
