# Dogfood Deviance Audit

Last audited: 2026-06-19.

This note records where the Oddlynew dogfood monorepo intentionally differs from the Oddlynew
monorepo baseline, where the difference is transitional, and what was cleaned up. The purpose is to
make the branch easy to review: a maintainer should be able to tell which choices are part of the
target architecture and which ones are follow-up work.

## Current Verdict

There is no known structural blocker after the current cleanup pass. The repo has a coherent Nx
project graph, package identities are under the `@oddlynew` namespace, CI runs affected
build/typecheck/lint with the R2 cache hook, and release groups are modeled in Nx.

The main remaining operational gap is test promotion. CI currently runs the new
`nx-r2-cache-worker` tests, but it does not yet require affected hermetic package tests for Alchemy,
Distilled, or Cloudflare Tools. That is deliberate for the initial dogfood branch because many
imported tests exercise live provider APIs, but it is the highest-value next hardening step.

## Warranted Deviations

These are intentional differences from the Oddlynew app monorepo.

| Area | Decision | Reason |
| --- | --- | --- |
| Product layout | Use `projects/alchemy`, `projects/distilled`, and `projects/cloudflare-tools`. | The source repos are the product ownership boundary. Keeping their roots visible preserves history and makes upstream sync manageable. |
| Root packages | Keep shared repo infrastructure in root `packages/`. | The Nx plugins, cache worker, shared TypeScript config, and shared oxlint config are true cross-product infrastructure. |
| Release shape | Keep separate Nx release groups for Alchemy, alchemy-node-utils, Distilled, and Cloudflare Tools. | The upstream repos already have separate version lines. Dogfood publishing should prove grouped releases without forcing one global version. |
| Large runner | Use `ubuntu-large` for CI and release. | Distilled generated SDK builds, especially GCP, exceed the margin of the default runner. The project-level build targets still limit concurrency where needed. |
| Fork PR safety | Keep CI on `pull_request`, with GitHub fork-workflow approval protecting larger runner cost. | The workflow executes PR code, so `pull_request_target` would be the wrong trust model for validation. |
| Production affected exclude | Exclude aggregate roots, website, examples, and fixtures from production affected build/typecheck/lint. | Those projects remain in the graph and can be run directly, but they are not all hermetic production package gates yet. |
| Distilled `project.json` build overrides | Keep generated SDK package build targets explicit. | Some generated packages need serialized or file-by-file emit behavior that is not yet generic enough for inference. |
| `pr-package.yml` upstream workflow | Keep the pinned `alchemy-run/actions` reusable workflow for now. | It is an external dependency, not executable inline repo code. Forking it is only necessary when dogfood independence matters more than staying close to upstream. |
| Historical docs links | Leave old blog/changelog links pointing at upstream unless they are current dogfood instructions. | Historical release notes should keep pointing to the original issues and PRs; rewriting them would distort provenance. |

## Cleanups Completed

This audit fixed stale residue that would make the dogfood branch look less coherent than it is.

- Pinned release workflow Bun to `1.3.13` and moved release to `ubuntu-large`.
- Removed duplicate dogfood package names from `bunfig.toml`.
- Made `bunfig.toml` explicit about hoisted installs, npm registry, dev/optional dependencies, and
  the 72-hour release-age guard.
- Changed root format scripts and agent docs to use `oxfmt .`, matching CI's full-repo check.
- Moved root dev-tool dependencies away from `latest` specs and through the workspace catalog.
- Normalized package repository metadata to `https://github.com/oddlynew/alchemy-effect`.
- Added missing repository metadata for `@oddlynew/alchemy-node-utils`.
- Updated visible root README install/badge identity to `@oddlynew/alchemy`.
- Removed stale references to the deleted `.github/scripts/run-affected-production-target.ts`
  helper from Distilled and Cloudflare Tools docs.
- Changed the Distilled SDK generator default repository URL to the Oddlynew fork.
- Fixed `@oddlynew/alchemy-nx-tsgo-plugin` typecheck inference to run
  `bun tsgo --build --emitDeclarationOnly` instead of `tsgo --noEmit -p tsconfig.json`. The old
  command could pass on solution-style `tsconfig.json` files with `files: []`.

## Transitional Differences

These should not block dogfooding, but they should be revisited before presenting the branch as a
fully polished long-term replacement.

| Area | Current state | Target state |
| --- | --- | --- |
| Tests in CI | Only cache-worker tests are required in CI. | Promote affected hermetic package tests into CI, then add opt-in live-provider jobs for credentialed environments. |
| Oxlint hygiene plugins | `@oddlynew/alchemy-oxlint-config` does not yet include Oddlynew's custom workspace-hygiene plugins. | Port the plugins once generated/imported code exceptions are known, then ratchet rules package by package. |
| TypeScript config strictness | Shared config is cleaner than the imported repos, but still less strict than Oddlynew's mature baseline. | Tighten after imported package drift is resolved, not during the structural migration. |
| Example and fixture targets | Examples and Cloudflare Tools fixtures still keep package-local scripts and are excluded from production CI. | Decide which examples are hermetic smoke tests, then infer or model them as first-class Nx targets. |
| Root Alchemy smoke test | `test/smoke.test.ts` remains at the repository root. | Either keep it documented as cross-product smoke infrastructure or move it under `projects/alchemy` with a dedicated Nx target. |
| Website links | Current marketing/docs pages still contain upstream GitHub links in many places. | For a public Oddlynew distribution website, update current navigation and install docs while preserving historical release-note links. |
| Distilled explicit build targets | Generated packages use many small `project.json` files. | If the pattern stabilizes, move it into the custom Nx plugin so package roots stay script-first. |
| Release automation | Release is manual `workflow_dispatch`. | After the first successful dogfood publish, switch to automatic release from protected `main` if the team wants Oddlynew-style always-release behavior. |

## Follow-Up Verification

Use this loop after changing any of the transitional areas:

```bash
bun install --frozen-lockfile
bun nx show projects
NX_DAEMON=false bun nx build nx-tsgo-plugin --skipSync --outputStyle=static
NX_DAEMON=false bun nx typecheck nx-tsgo-plugin --skipSync --outputStyle=static
bun oxfmt --check .
git diff --check
```

For CI-shape validation, use the same affected commands as the workflow:

```bash
export NX_PRODUCTION_EXCLUDE="@oddlynew/distilled,@oddlynew/cloudflare-tools,@oddlynew/alchemy-website,@oddlynew/alchemy-example-*,@oddlynew/cloudflare-tools-fixture-*"
bun nx affected -t build --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t typecheck --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t lint --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
```
