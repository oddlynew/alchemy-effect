# Distilled

Effect-native SDKs for cloud providers with exhaustive error typing, retry policies, and streaming pagination.

```typescript
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Lambda from "@oddlynew/distilled-aws/lambda";
import * as S3 from "@oddlynew/distilled-aws/s3";

const bucket =
  yield *
  S3.getBucket({
    Bucket: "my-bucket",
  }).pipe(Effect.catch("NoSuchBucket", () => Effect.void));

const functions =
  yield *
  Lambda.listFunctions.items({}).pipe(Stream.take(10), Stream.runCollect);
```

## Generating SDKs

Distilled now lives inside the Alchemy monorepo. From the repository root, install dependencies once
with `bun install`, then run the SDK generator from `projects/distilled`.

Every SDK has all of its sources as git submodules; you can either supply a git repo or an HTTP URL
to an OpenAPI spec. Use `--note` to specify where the OpenAPI spec lives in the repo when it is not
obvious.

```bash
cd projects/distilled
bun scripts/create-sdk.ts discord https://github.com/discord/discord-api-spec --note "use /specs/openapi.json from the provided repo"
```

This workflow uses local Claude Code. You must be signed in before running it.

For larger SDKs, rerun the command after limits refresh; the generator is designed to continue from
existing work. Use `bun scripts/create-sdk.ts --help` for skip/resume flags.

## Packages

| Package                                                             | Description                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`@oddlynew/distilled-core`](./packages/core)                       | Shared client, traits, errors, and categories                    |
| [`@oddlynew/distilled-aws`](./packages/aws)                         | AWS SDK from Smithy models (S3, Lambda, DynamoDB, 200+ services) |
| [`@oddlynew/distilled-axiom`](./packages/axiom)                     | Axiom SDK from OpenAPI spec                                      |
| [`@oddlynew/distilled-azure`](./packages/azure)                     | Azure SDK from OpenAPI specs                                     |
| [`@oddlynew/distilled-cloudflare`](./packages/cloudflare)           | Cloudflare SDK (Workers, R2, KV, D1, Queues, DNS)                |
| [`@oddlynew/distilled-coinbase`](./packages/coinbase)               | Coinbase CDP SDK (EVM/Solana wallets, swaps, faucets, onramp)    |
| [`@oddlynew/distilled-expo-eas`](./packages/expo-eas)               | Expo EAS SDK from OpenAPI spec                                   |
| [`@oddlynew/distilled-fly-io`](./packages/fly-io)                   | Fly.io SDK from OpenAPI spec                                     |
| [`@oddlynew/distilled-gcp`](./packages/gcp)                         | GCP SDK from Discovery Documents                                 |
| [`@oddlynew/distilled-kubernetes`](./packages/kubernetes)           | Kubernetes SDK from OpenAPI spec                                 |
| [`@oddlynew/distilled-mongodb-atlas`](./packages/mongodb-atlas)     | MongoDB Atlas SDK from OpenAPI spec                              |
| [`@oddlynew/distilled-neon`](./packages/neon)                       | Neon serverless Postgres SDK from OpenAPI spec                   |
| [`@oddlynew/distilled-planetscale`](./packages/planetscale)         | PlanetScale MySQL SDK from OpenAPI spec                          |
| [`@oddlynew/distilled-posthog`](./packages/posthog)                 | PostHog SDK from OpenAPI spec                                    |
| [`@oddlynew/distilled-prisma-postgres`](./packages/prisma-postgres) | Prisma Postgres SDK from OpenAPI spec                            |
| [`@oddlynew/distilled-stripe`](./packages/stripe)                   | Stripe SDK from OpenAPI spec                                     |
| [`@oddlynew/distilled-supabase`](./packages/supabase)               | Supabase Management API SDK from OpenAPI spec                    |
| [`@oddlynew/distilled-turso`](./packages/turso)                     | Turso SDK from OpenAPI spec                                      |
| [`@oddlynew/distilled-typesense`](./packages/typesense)             | Typesense SDK from OpenAPI spec                                  |
| [`@oddlynew/distilled-workos`](./packages/workos)                   | WorkOS SDK from OpenAPI spec                                     |

## Getting Started

Distilled now lives in the Alchemy monorepo under `projects/distilled`.

```bash
# Clone the replacement monorepo
git clone https://github.com/oddlynew/alchemy-effect.git
cd alchemy-effect

# Install dependencies
bun install

# Build one SDK through Nx
bun nx build @oddlynew/distilled-core
bun nx build @oddlynew/distilled-stripe

# Run one SDK's tests through Nx
bun nx test @oddlynew/distilled-stripe
```

## Git Performance

This repo has 17+ submodules including very large repos (`kubernetes/kubernetes`, `azure-rest-api-specs`, `aws-sdk-js-v3`). Without the settings below, basic git commands will be extremely slow (~11+ seconds for `git status`).

### Global config (once per machine)

**Do NOT set `submodule.recurse=true`.** If it's already set, remove it — it makes every git command recurse into all submodules:

```bash
git config --global --unset submodule.recurse
```

These are fine to keep:

```bash
git config --global fetch.recurseSubmodules on-demand
git config --global push.recurseSubmodules on-demand
```

### Local config (once per clone)

```bash
git config --local diff.ignoreSubmodules dirty
git config --local status.submoduleSummary false
```

The `.gitmodules` file also has `ignore = dirty` on every submodule, so most of this is handled automatically on fresh clones.

### Why `ignore = dirty`?

| Setting                   | Tracks submodule HEAD changes | Scans submodule working tree               |
| ------------------------- | ----------------------------- | ------------------------------------------ |
| `ignore = none` (default) | Yes                           | Yes (slow)                                 |
| `ignore = dirty`          | Yes                           | No (fast)                                  |
| `ignore = all`            | No                            | No (breaks `git add` after `specs:update`) |

`dirty` skips the expensive working tree scan but still detects when a submodule's committed SHA changes. After `specs:update`, `git status` will show the updated submodule and `git add` / `git commit` work normally.

### Committing submodule updates

After running `bun run specs:update` in a package directory:

```bash
git status                                    # shows submodule as modified
git add packages/{name}/specs/{submodule}
git commit -m "update {name} spec to latest"
```

## Submodules

Vendor API specifications are stored as git submodules under each package's `specs/` directory. They are **not needed for building or typechecking** — only for code generation (`bun run generate`). The exception is `aws`, which also needs submodules for testing. All submodules use `shallow = true` to avoid cloning full histories.

```bash
# Fetch specs for a specific package
bun run specs:fetch    # run inside a package directory

# Update specs to latest upstream
bun run specs:update   # run inside a package directory
```

| Package           | Submodules                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `aws`             | `api-models-aws`, `aws-sdk-js-v3`, `smithy`, `smithy-typescript` |
| `cloudflare`      | `cloudflare-typescript`                                          |
| `coinbase`        | `cdp-sdk`                                                        |
| `fly-io`          | `distilled-spec-fly-io`                                          |
| `gcp`             | `distilled-spec-gcp`                                             |
| `mongodb-atlas`   | `distilled-spec-mongodb-atlas`                                   |
| `neon`            | `distilled-spec-neon`                                            |
| `planetscale`     | `distilled-spec-planetscale`                                     |
| `prisma-postgres` | `distilled-spec-prisma-postgres`                                 |
| `stripe`          | `stripe-openapi`                                                 |
| `supabase`        | `distilled-spec-supabase`                                        |
| `turso`           | `turso-docs`                                                     |

## Scripts

| Script                                       | Description                        |
| -------------------------------------------- | ---------------------------------- |
| `bun run build`                              | Build core, then all packages      |
| `bun run typecheck`                          | Type check all packages            |
| `bun run check`                              | Full check (types + lint + format) |
| `bun run test`                               | Run all tests                      |
| `bun run fmt`                                | Format all packages                |
| `bun run lint`                               | Lint all packages                  |
| `bun run generate`                           | Regenerate all SDKs from specs     |
| `bun run create-sdk <name> --specs <url>...` | Scaffold a new SDK package         |

## Deployment

### Preview Packages

The root `pr-package` workflow republishes Alchemy preview packages when Distilled or Cloudflare
Tools changes affect what Alchemy bundles. Distilled packages themselves are released through the
root Nx release workflow.

### NPM Releases

To publish Distilled packages to npm, manually trigger the root **release** workflow from the
GitHub Actions UI:

1. Go to **Actions** -> **release** -> **Run workflow**.
2. Select the `distilled` release group.
3. Keep `dry-run` enabled for previews; disable it only on `main` when publishing intentionally.

The workflow bumps all Distilled package versions together, writes package changelogs, builds the
release artifacts, publishes to npm, and pushes the release commit/tags.

### CI

Root CI uses Nx affected validation. For broad local checks, run
`bun nx affected -t typecheck --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"` and the matching
`lint` or `build` target from the repository root.

## Contributing

The TDD workflow for discovering and patching missing errors:

1. Write a test that triggers an error
2. Run with `DEBUG=1` to see the raw response
3. Add the error to the patch file (see package READMEs for format)
4. Regenerate: `bun run generate`
5. Import the typed error and handle it

See [AGENTS.md](./AGENTS.md) for detailed development guidelines.
