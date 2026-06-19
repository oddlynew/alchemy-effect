# Docs

This directory is for repo-level maintainer documentation. Product docs for Alchemy users live in
[`projects/alchemy/apps/website/src/content/docs`](../projects/alchemy/apps/website/src/content/docs).

| Topic | Location |
| --- | --- |
| Monorepo migration overview | [`monorepo/migration.md`](./monorepo/migration.md) |
| Maintainer-facing summary | [`monorepo/maintainer-summary.md`](./monorepo/maintainer-summary.md) |
| Clean replacement-repo cutover | [`monorepo/cutover-operating-note.md`](./monorepo/cutover-operating-note.md) |
| Dogfood deviance audit | [`monorepo/deviance-audit.md`](./monorepo/deviance-audit.md) |
| Provider factory catalog notes | [`provider-catalog/README.md`](./provider-catalog/README.md) |
| Agent and contributor guidance | [`../AGENTS.md`](../AGENTS.md) |
| Generated provider API docs | [`../projects/alchemy/apps/website/src/content/docs/providers`](../projects/alchemy/apps/website/src/content/docs/providers) |

Generated provider API docs should not be edited directly. Update JSDoc in
`projects/alchemy/packages/alchemy/src/**/*.ts` and regenerate the website docs instead.
