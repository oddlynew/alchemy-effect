# Monorepo Migration

For the short maintainer-facing case, see [`maintainer-summary.md`](./maintainer-summary.md).
For the clean replacement-repository cutover procedure, see
[`cutover-operating-note.md`](./cutover-operating-note.md).
For the Oddlynew-owned fork distribution track, see
[`dogfood-distribution.md`](./dogfood-distribution.md).

This branch models `alchemy-effect`, `distilled`, and `cloudflare-tools` as one Bun/Nx workspace
using the same high-level shape as the Oddlynew monorepo: shared packages remain
at the root, while product-owned code lives under `projects/<product>/...`.

## Source Layout

The root `packages/` directory is reserved for shared packages used across products and repository
infrastructure:

```text
packages/
├── alchemy-node-utils
├── nx-alchemy-plugin
├── nx-oxlint-plugin
├── nx-r2-cache-worker
├── nx-tsdown-plugin
├── nx-tsgo-plugin
├── oxlint-config
└── typescript-config
```

Product code is grouped by product/repo:

projects/
├── alchemy/
│   ├── apps/
│   │   ├── github-secrets
│   │   ├── nuke
│   │   ├── otel
│   │   ├── pr-package
│   │   └── website
│   ├── examples/
│   └── packages/
│       ├── alchemy
│       ├── better-auth
│       └── pr-package
├── distilled/
│   ├── www/
│   │   └── distilled.cloud
│   └── packages/
│       └── ...
└── cloudflare-tools/
    ├── fixtures/
    └── packages/
        ├── tools/
        ├── vendor/
        ├── cloudflare-runtime
        ├── cloudflare-vite-plugin
        └── cloudflare-rolldown-plugin
```

Each package root remains an Nx project through its `package.json`. For example:

| Package root                                                     | Nx project name                                | Release group       |
| ---------------------------------------------------------------- | ---------------------------------------------- | ------------------- |
| `projects/alchemy/apps/otel`                                     | `alchemy-otel`                                 | private, no release |
| `projects/alchemy/packages/alchemy`                              | `@oddlynew/alchemy`                           | `alchemy`           |
| `packages/alchemy-node-utils`                                            | `@oddlynew/alchemy-node-utils`                        | `alchemy-node-utils`        |
| `projects/distilled/packages/stripe`                             | `@oddlynew/distilled-stripe`                      | `distilled`         |
| `projects/cloudflare-tools/packages/cloudflare-vite-plugin`       | `@oddlynew/distilled-cloudflare-vite-plugin`      | `cloudflare-tools`  |
| `projects/cloudflare-tools/packages/tools/test`                  | `@oddlynew/distilled-test-utils`                  | private, no release |

This lets Nx answer the important questions while the filesystem also communicates ownership:

- which packages are affected by a PR;
- which dependencies must build before a target package;
- which tasks can reuse local or remote cache artifacts;
- which package versions and changelogs must change together.

## Inferred Targets

The repo includes private Nx plugins under `packages/nx-*-plugin`:

- `@oddlynew/alchemy-nx-tsdown-plugin` adds `build` when a project has `tsdown.config.ts`.
- `@oddlynew/alchemy-nx-tsgo-plugin` adds `typecheck` when a project has `tsconfig.json` and no existing
  `typecheck` package script or project target.
- `@oddlynew/alchemy-nx-oxlint-plugin` adds `lint` when a project has local oxlint config, has
  `tsconfig.json` for the default type-aware mode, and has no existing `lint` package script or
  project target.
- `@oddlynew/alchemy-nx-alchemy-plugin` adds `dev`, `deploy`, `destroy`, and `plan` when a project has
  `alchemy.run.ts`.

That keeps package `package.json` files focused on package behavior while Nx owns orchestration.
For this migration branch, lockfile changes intentionally mark all projects affected. Nx's smarter
`projectsAffectedByDependencyUpdates: "auto"` mode currently trips over this merged `bun.lock`
shape, and the safe fallback is to rebuild broadly when dependencies change.

Useful commands:

```bash
bun nx show projects
bun nx graph
bun nx show projects --affected --files=projects/distilled/packages/stripe/src/index.ts
bun nx run @oddlynew/distilled-cloudflare-vite-plugin:build
```

## Shared Config

The branch follows the Oddlynew config pattern by putting shared lint and TypeScript presets in
root packages:

- `@oddlynew/alchemy-oxlint-config`
- `@oddlynew/alchemy-typescript-config`

Product/package TypeScript configs extend named package presets such as
`@oddlynew/alchemy-typescript-config/node.json` or `@oddlynew/alchemy-typescript-config/bun.json`. The root
`tsconfig.base.json`, `tsconfig.scripts.json`, product-local `tsconfig.base.json` files, and
example-local config bases are intentionally removed. Package-local `tsconfig*.json` files own their
runtime and project-reference boundaries directly.

Shared lint rules are imported from TypeScript oxlint config files:

- `oxlint.config.ts`
- `projects/distilled/oxlint.config.ts`
- `projects/cloudflare-tools/oxlint.config.ts`

That replaces the previous scattered `.oxlintrc.json` files and makes project-specific exceptions
explicit in code. Product-specific overrides live at `projects/<product>/oxlint.config.ts`.

The shared package intentionally exposes two presets:

- `@oddlynew/alchemy-oxlint-config/base-config` mirrors the minimal root/Distilled rules from the
  standalone repos.
- `@oddlynew/alchemy-oxlint-config/effect-config` mirrors the stricter Cloudflare-tools Effect-style
  rules, while keeping category-level type-aware checks as warnings/off by default like Oddlynew's
  baseline.

That preserves current generated-code behavior while still giving maintainers one package to evolve
when they want stricter linting across the merged workspace.

## Validation Scope

CI runs Nx affected checks for production/package projects, not every demo surface. `build`,
`typecheck`, and `lint` validation use direct `bun nx affected` commands with
`NX_PRODUCTION_EXCLUDE` to skip aggregate and non-hermetic project-name patterns:

- `@oddlynew/distilled`
- `@oddlynew/cloudflare-tools`
- `@oddlynew/alchemy-website`
- `@oddlynew/alchemy-example-*`
- `@oddlynew/cloudflare-tools-fixture-*`

Those projects still appear in the Nx graph and can be run directly. The exclusion belongs in the
workflow rather than a wrapper script so the branch keeps the Oddlynew-style `bun nx affected`
surface while making the temporary CI boundary visible. Test suites are also not promoted wholesale
yet: several imported package tests exercise live external services and require provider secrets.
Distilled's test syntax has been updated for Vitest 4, and the branch explicitly runs the new
`nx-r2-cache-worker` tests in CI because that package is new repo infrastructure. Broader package
tests can be promoted into the required CI gate once each target is hermetic.

The generated Distilled SDK provider packages keep their package-level `build` scripts for direct
human use, but each provider has a small `project.json` build target so Nx runs `tsgo -b` directly
instead of through `bun run build`. The monorepo CI exposed an Nx/Bun package-script
process-lifecycle edge where `nx:run-script` could finish the build graph successfully and still
exit 130 after GitHub cleaned up an orphan Bun script process.

Generated Distilled provider builds set Nx `parallelism: false`. Nx still runs the affected
production build with `--parallel=3`, but the very large generated SDK emits do not run alongside
other tasks on the same hosted Linux runner. That keeps the resource constraint on the projects
that need it instead of serializing the whole workflow.

Distilled's existing `check` scripts still include `oxfmt --check src`, but the imported generated
AWS/GCP clients have pre-existing formatter drift. The migration CI therefore runs `lint`
instead of `check`; a future baseline cleanup can format generated clients and promote `check` once
that diff is reviewed separately.

The unified build also intentionally surfaces cross-repo toolchain drift. In the standalone
Cloudflare Tools repository, declaration builds could resolve a local TypeScript/toolchain shape
independently from Alchemy. In the monorepo, the shared root exposed that `rolldown-plugin-dts`
cannot use its JavaScript TypeScript path against the TypeScript 7 RC package. The branch fixes that
by using `dts: { tsgo: true }` for the Cloudflare Tools `tsdown` declaration builds, which matches
Oddlynew's package build standard and keeps the workspace on the modern TypeScript/native-preview
path. The same verification run caught typed Alchemy handlers whose `catchTag` lists included
runtime Cloudflare error tags that the generated SDK error unions do not currently declare; those
handlers now use `Effect.catch` and re-fail unknown errors.

## Release Groups

`nx.json` models the three public release surfaces separately:

- `alchemy`: `@oddlynew/alchemy`, `@oddlynew/alchemy-better-auth`, `@oddlynew/alchemy-pr-package`
- `alchemy-node-utils`: the shared `@oddlynew/alchemy-node-utils` package used by Alchemy and Cloudflare Tools
- `distilled`: the public `@oddlynew/distilled-*` provider packages from `distilled`
- `cloudflare-tools`: the public Cloudflare runtime, Vite plugin, and Rolldown plugin packages

Each group is fixed-versioned internally, matching the current repos. A release of the Alchemy group
or the Cloudflare-tools group can therefore bump every package in that group from conventional
commits and create matching per-project changelog entries.

Cross-group dependent bumps are intentionally disabled in this branch with
`version.updateDependents: "never"`. Nx can model dependent bumps across release groups, but the
current Alchemy tag history plus the unscoped `alchemy` package name exposes an Nx 23 RC resolver
edge case when a Cloudflare-tools release tries to pull `alchemy` in as a dependent. The safe
cutover is to first land fixed release groups, then switch `updateDependents` to `"auto"` after the
tag policy is finalized or the resolver issue is fixed.

Nx release is configured for conventional commits and per-project changelogs:

```bash
bun nx release prerelease --groups=alchemy --dry-run --preid beta --skip-publish
bun nx release patch --groups=alchemy-node-utils --dry-run --skip-publish
bun nx release patch --groups=distilled --dry-run --skip-publish
bun nx release patch --groups=cloudflare-tools --dry-run --skip-publish
```

Those commands already preview package version bumps and changelog entries from the merged commit
history. They intentionally mirror the current release lines: `@oddlynew/alchemy` continues from
`2.0.0-beta.57` to `2.0.0-beta.58`, `@oddlynew/alchemy-node-utils` continues from `0.0.5` to `0.0.6`,
`@oddlynew/distilled` continues from `0.25.2` to `0.25.3`, and `@oddlynew/cloudflare-tools`
continues from `0.11.2` to `0.11.3`.

The dogfood release groups require monorepo baseline tags at the fork-namespace commit:

```bash
git tag -a "@oddlynew/alchemy@2.0.0-beta.57" HEAD -m "oddlynew alchemy dogfood baseline 2.0.0-beta.57"
git tag -a "@oddlynew/alchemy-node-utils@0.0.5" HEAD -m "oddlynew alchemy-node-utils dogfood baseline 0.0.5"
git tag -a "@oddlynew/distilled@0.25.2" HEAD -m "oddlynew distilled dogfood baseline 0.25.2"
git tag -a "@oddlynew/cloudflare-tools@0.11.2" HEAD -m "oddlynew cloudflare tools dogfood baseline 0.11.2"
```

Those tags keep the first monorepo-native patch release clean. Placing the tags on the old imported
release commits is not enough after merging unrelated histories: Nx would still include the
Alchemy-side history in the changelog range. `--first-release` is therefore not the production
cutover path; it should be reserved for intentionally new release groups without a prior baseline.

Removing `--dry-run` and `--skip-publish` is the production publish step once npm/GitHub release
credentials are intentionally wired for the monorepo.

The `release` GitHub workflow exposes the same release groups as a manual workflow dispatch. It
defaults to dry-run, chooses the same continuation specifier by group unless maintainers override it,
and refuses normal releases if the matching dogfood baseline tag is missing. Non-dry
releases are refused unless the workflow is dispatched from `main`; when they do run, the workflow
passes `--yes` to Nx release, publishes through each package's `nx-release-publish` target after its
`build` target has produced publishable `lib` / `dist` artifacts, and pushes the release
commit/tags.

## Remote Cache

Local Nx caching works with no secrets. Remote cache is opt-in through environment variables so
fork PRs and local checkouts remain safe by default.

This branch includes a self-hosted Worker/R2 implementation at `packages/nx-r2-cache-worker` and
the CI wiring in `.github/scripts/configure-nx-r2-cache.sh`. The Worker is intentionally a root
infrastructure package, uses the local `alchemy` workspace package, and can be managed through Nx:

```bash
bun nx plan nx-r2-cache-worker
bun nx deploy nx-r2-cache-worker
```

The CI cache wiring expects:

- `NX_R2_CACHE_SERVER_URL` as a repository variable;
- `NX_R2_CACHE_BRANCH_TOKEN` as a repository secret available to PR/branch CI;
- `NX_R2_CACHE_TRUSTED_TOKEN` as an environment secret available only to protected `main` pushes.

The script exports Nx's self-hosted cache variables:

- `NX_SELF_HOSTED_REMOTE_CACHE_SERVER`
- `NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN`

The intended cache topology is two-tier:

| Tier        | Written by                   | Read by                                | Purpose                         |
| ----------- | ---------------------------- | -------------------------------------- | ------------------------------- |
| `trusted`   | protected `main` CI          | everyone through trusted fall-through  | artifacts allowed to ship       |
| `branches/*` | PR CI and developer branches | that branch namespace plus trusted miss | fast untrusted iteration        |

This avoids the dangerous shape where untrusted PRs can poison the same cache namespace used by
production builds. If cache credentials are missing, CI prints a notice and uses only local Nx
cache.

The Worker owns two EU R2 buckets:

- `alchemy-run-nx-cache-trusted`, with a 90 day lifecycle.
- `alchemy-run-nx-cache-branches`, with a 30 day lifecycle.

The Worker requires `NX_R2_CACHE_TRUSTED_TOKEN` and `NX_R2_CACHE_BRANCH_TOKEN` in the Doppler
`alchemy-v2` production config before deployment. After deployment, set
`NX_R2_CACHE_SERVER_URL` to the Worker URL. The branch token can write only under
`/branches/<namespace>`; the trusted token can write only under `/trusted`.

## Cutover Plan

1. Land the monorepo branch without changing publish ownership.
2. Run `bun install` and verify `bun nx show projects` in CI.
3. Deploy `nx-r2-cache-worker`, add cache variables and secrets, then confirm PR runs use branch
   cache and `main` uses trusted cache.
4. Run affected builds on integration PRs that touch both `alchemy` and `distilled`.
5. Create or update the imported-group baseline tags on the final cutover commit.
6. Run the Nx release dry-runs for all three groups and approve the generated version/changelog
   plan.
7. Remove `--dry-run` / `--skip-publish` from the chosen release command when npm/GitHub
   credentials are intentionally wired for the monorepo.
8. Archive or redirect the old standalone repos after the first monorepo release succeeds.
