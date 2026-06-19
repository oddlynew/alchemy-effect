# Docs

This directory is for repo-level fork and migration operations. Product docs for Alchemy users live in
[`projects/alchemy/apps/website/src/content/docs`](../projects/alchemy/apps/website/src/content/docs).

| Topic | Location |
| --- | --- |
| Monorepo migration overview | [`monorepo/migration.md`](./monorepo/migration.md) |
| Fork operations | [`monorepo/fork-operations.md`](./monorepo/fork-operations.md) |
| Clean-history sync procedure | [`monorepo/clean-history-operating-note.md`](./monorepo/clean-history-operating-note.md) |
| Dogfood distribution model | [`monorepo/dogfood-distribution.md`](./monorepo/dogfood-distribution.md) |
| Dogfood deviance audit | [`monorepo/deviance-audit.md`](./monorepo/deviance-audit.md) |
| Provider factory catalog notes | [`provider-catalog/README.md`](./provider-catalog/README.md) |
| Agent and contributor guidance | [`../AGENTS.md`](../AGENTS.md) |
| Generated provider API docs | [`../projects/alchemy/apps/website/src/content/docs/providers`](../projects/alchemy/apps/website/src/content/docs/providers) |

Generated provider API docs should not be edited directly. Update JSDoc in
`projects/alchemy/packages/alchemy/src/**/*.ts` and regenerate the website docs instead.
