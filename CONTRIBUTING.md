# Contributing

This branch is the Oddlynew dogfood monorepo for Alchemy, Distilled, and Cloudflare Tools.

## First Run

```bash
bun install
bun nx show projects
```

Use the workspace-pinned Nx through Bun:

```bash
bun nx build <project>
bun nx typecheck <project>
bun nx lint <project>
bun nx test <project>
```

For broad production-package checks, use the same affected shape as CI:

```bash
export NX_PRODUCTION_EXCLUDE="@oddlynew/distilled,@oddlynew/cloudflare-tools,@oddlynew/alchemy-website,@oddlynew/alchemy-example-*,@oddlynew/cloudflare-tools-fixture-*"
bun nx affected -t build --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t typecheck --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
bun nx affected -t lint --parallel=3 --exclude="$NX_PRODUCTION_EXCLUDE"
```

## Maintainer Notes

- Agent and command guidance lives in [`AGENTS.md`](./AGENTS.md).
- Monorepo migration notes live in [`docs/monorepo/migration.md`](./docs/monorepo/migration.md).
- Current dogfood deviations and follow-ups live in
  [`docs/monorepo/deviance-audit.md`](./docs/monorepo/deviance-audit.md).
- Release dry-runs are documented in [`docs/monorepo/migration.md`](./docs/monorepo/migration.md#release-groups).

Run `bun oxfmt .` before committing.
