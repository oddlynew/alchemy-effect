# cloudflare-tools

Monorepo for Cloudflare developer tooling powered by Rolldown, Effect, and Vite. Packages are published under [`@distilled.cloud`](https://www.npmjs.com/org/distilled.cloud) on npm.

> Note: The Effect-native Cloudflare API client is published as [`@distilled.cloud/cloudflare`](https://www.npmjs.com/package/@distilled.cloud/cloudflare) on npm and now lives at [`projects/distilled/packages/cloudflare`](../distilled/packages/cloudflare) in the same replacement monorepo.

## Packages

| Package                                                                              | Description                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [`@distilled.cloud/cloudflare-rolldown-plugin`](packages/cloudflare-rolldown-plugin) | Rolldown plugin for Cloudflare Workers.             |
| [`@distilled.cloud/cloudflare-runtime`](packages/cloudflare-runtime)                 | Effect-native local runtime for Cloudflare Workers. |
| [`@distilled.cloud/cloudflare-vite-plugin`](packages/cloudflare-vite-plugin)         | Vite plugin for Cloudflare Workers.                 |

## Development

```bash
bun install
bun nx lint @distilled.cloud/cloudflare-runtime
bun nx typecheck @distilled.cloud/cloudflare-runtime
bun nx build @distilled.cloud/cloudflare-runtime
bun nx test @distilled.cloud/cloudflare-runtime
```

Workspace packages live under [`packages/`](packages/).

## License

MIT
