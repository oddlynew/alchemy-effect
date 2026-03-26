# cloudflare-tools

This monorepo contains **Effect-native developer tooling for Cloudflare Workers**, published under [`@distilled.cloud`](https://www.npmjs.com/org/distilled.cloud) on npm.

> Note: This repository does not contain our Effect-native Cloudflare API client, which is published as [`@distilled.cloud/cloudflare`](https://www.npmjs.com/package/@distilled.cloud/cloudflare) on npm and located in our [`distilled`](https://github.com/alchemy-run/distilled/tree/main/packages/cloudflare) monorepo.

## Packages

| Package                                                                      | Description                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`@distilled.cloud/cloudflare-bundler`](packages/cloudflare-bundler)         | Effect-native bundler for Cloudflare Workers.            |
| [`@distilled.cloud/cloudflare-runtime`](packages/cloudflare-runtime)         | WIP: Effect-native local runtime for Cloudflare Workers. |
| [`@distilled.cloud/cloudflare-vite-plugin`](packages/cloudflare-vite-plugin) | WIP: Vite plugin for Cloudflare Workers.                 |

## Development

```bash
bun install
bun run format
bun run lint
bun run typecheck
bun run build
bun run test
```

Workspace packages live under [`packages/`](packages/).

## License

MIT
