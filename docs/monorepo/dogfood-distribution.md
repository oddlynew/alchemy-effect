# Oddlynew Dogfood Distribution

This note defines the fork track for using the monorepo as an Oddlynew-owned distribution of
Alchemy, Distilled, and Cloudflare Tools. It is intentionally separate from
[`cutover-operating-note.md`](./cutover-operating-note.md), which describes the clean upstream
replacement branch.

## Branch Roles

Keep two branches with different promises:

```text
codex/monorepo-clean-history   # upstream adoption candidate
codex/monorepo-dogfood         # Oddlynew-owned fork distribution
```

The clean branch should stay easy for Alchemy maintainers to evaluate. It keeps upstream package
names, upstream release lines, imported histories, and monorepo infrastructure. It should not carry
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

Dogfood release tags are scoped to the fork identities:

- `@oddlynew/alchemy@<version>`
- `@oddlynew/alchemy-node-utils@<version>`
- `@oddlynew/distilled@<version>`
- `@oddlynew/cloudflare-tools@<version>`

The dogfood branch may start with a manual `workflow_dispatch` release while credentials, npm
scope ownership, and npm provenance attestations are being proven. Once the first real release is
reliable, prefer automatic release from the protected dogfood `main` branch after CI succeeds.

Required credentials for the full loop:

- npm publishing for the `@oddlynew` scope, preferably through GitHub Actions trusted publishing;
- release bot credentials for pushing version/changelog commits and tags;
- `NX_R2_CACHE_SERVER_URL`, `NX_R2_CACHE_BRANCH_TOKEN`, and `NX_R2_CACHE_TRUSTED_TOKEN`;
- Cloudflare account credentials for the cache Worker and any live Alchemy validation stacks;
- provider-specific test credentials only for tests that are deliberately promoted into required CI.

## Relationship To Clean History

The dogfood branch should keep taking updates from `codex/monorepo-clean-history`. That branch is
the clean upstream-sync point. The expected flow is:

```bash
git switch codex/monorepo-clean-history
# sync upstream Alchemy, Distilled, and Cloudflare Tools
# run cutover acceptance checks

git switch codex/monorepo-dogfood
git merge codex/monorepo-clean-history
# resolve fork-namespace conflicts in the dogfood branch
# run dogfood CI/release dry-runs
```

This keeps the maintainer candidate branch unpolluted while still letting the dogfood branch move
fast, publish real packages, and accumulate real cross-repo feature work.

## What To Show Maintainers

Use both branches in the conversation:

- clean branch: "Here is the adoption-ready monorepo with your package names and history intact."
- dogfood branch: "Here is the same architecture running as an active fork with CI, cache, releases,
  Cloudflare validation, and real feature velocity."

That gives maintainers a low-risk migration path and a concrete proof that the monorepo shape is not
only tidy, but operationally faster.
