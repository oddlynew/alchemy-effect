# Alchemy Effect Website

This workspace contains the customer-facing docs site for Alchemy Effect.

## Build Pipeline

The site is an Astro/Starlight app. The build currently runs these steps:

1. `bun run build:reference` generates provider API reference pages from the TypeScript source tree.
2. `bun run build:llms` generates the `llms.txt` artifacts.
3. `astro build` renders the docs site into `dist/`.
4. `alchemy.run.ts` deploys the final `dist/` directory through `Cloudflare.StaticSite(...)`.

`bun run build` runs the full pipeline with the Node heap size required by the docs corpus.

## Local Commands

- `bun run build`
- `bun run dev:site`
- `bun run deploy`
- `bun run destroy`

## Benchmark Snapshot

The previous Zola/Pagefind benchmark no longer applies. Re-record a fresh Astro baseline after the
dogfood website deploy path is stable.
