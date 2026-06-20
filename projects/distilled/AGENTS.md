# Distilled Agent Notes

Distilled now lives under `projects/distilled` in the Alchemy monorepo. The root
[`AGENTS.md`](../../AGENTS.md) owns repository-wide workflow, Nx usage, CI validation, release
commands, and formatting rules. The notes below describe Distilled-specific SDK conventions.

## Upstream Fork Discipline

This directory is imported from `alchemy-run/distilled` through the monorepo clean-history lane.
Before broad SDK generator, runtime, or package-layout changes, check upstream Distilled for new
commits and bring them in through the documented prefix-sync flow. Fork-specific changes are allowed,
but they should preserve Distilled's architecture unless the PR explicitly explains the deviation.

## Monorepo Workflow

- Use `bun nx` from the repository root for validation and builds. Examples:
  - `bun nx build @oddlynew/distilled-core`
  - `bun nx typecheck @oddlynew/distilled-stripe`
  - `bun nx lint @oddlynew/distilled-cloudflare`
  - `bun nx test @oddlynew/distilled-aws`
- For broad changes, use the validation affected commands from the root, for example
  `bun nx affected -t typecheck --parallel=3 --exclude="$NX_VALIDATION_EXCLUDE"`.
- Package-local scripts still exist for generation and debugging. Prefer the Nx form from the root
  when available, for example `bun nx run @oddlynew/distilled-stripe:generate`.
- Do not use the imported standalone root scripts as the default validation path; they are retained
  for package behavior and historical compatibility.

# Distilled

Effect-native SDKs with exhaustive error typing. We use a TDD-driven approach to discover, document, and patch missing API behavior from vendor specifications.

## Directory Structure

```
projects/distilled/
├── packages/
│   ├── core/             # @oddlynew/distilled-core — shared client, traits, errors, categories
│   ├── aws/              # @oddlynew/distilled-aws — AWS SDK from Smithy models
│   ├── axiom/            # @oddlynew/distilled-axiom — Axiom SDK from OpenAPI spec
│   ├── azure/            # @oddlynew/distilled-azure — Azure SDK from OpenAPI specs
│   ├── cloudflare/       # @oddlynew/distilled-cloudflare — Cloudflare SDK from TypeScript SDK
│   ├── coinbase/         # @oddlynew/distilled-coinbase — Coinbase CDP SDK from OpenAPI spec
│   ├── expo-eas/         # @oddlynew/distilled-expo-eas — Expo EAS SDK from OpenAPI spec
│   ├── fly-io/           # @oddlynew/distilled-fly-io — Fly.io SDK from OpenAPI spec
│   ├── gcp/              # @oddlynew/distilled-gcp — GCP SDK from Discovery Documents
│   ├── kubernetes/       # @oddlynew/distilled-kubernetes — Kubernetes SDK from OpenAPI spec
│   ├── mongodb-atlas/    # @oddlynew/distilled-mongodb-atlas — MongoDB Atlas SDK from OpenAPI spec
│   ├── neon/             # @oddlynew/distilled-neon — Neon SDK from OpenAPI spec
│   ├── planetscale/      # @oddlynew/distilled-planetscale — PlanetScale SDK from OpenAPI spec
│   ├── posthog/          # @oddlynew/distilled-posthog — PostHog SDK from OpenAPI spec
│   ├── prisma-postgres/  # @oddlynew/distilled-prisma-postgres — Prisma Postgres SDK from OpenAPI spec
│   ├── stripe/           # @oddlynew/distilled-stripe — Stripe SDK from OpenAPI spec
│   ├── supabase/         # @oddlynew/distilled-supabase — Supabase SDK from OpenAPI spec
│   ├── turso/            # @oddlynew/distilled-turso — Turso SDK from OpenAPI spec
│   ├── typesense/        # @oddlynew/distilled-typesense — Typesense SDK from OpenAPI spec
│   └── workos/           # @oddlynew/distilled-workos — WorkOS SDK from OpenAPI spec
├── scripts/              # Root-level scripts (create-sdk.ts, bump.ts, etc.)
└── AGENTS.md             # This file
```

### Package Layout (each package)

```
projects/distilled/packages/{name}/
├── src/                  # Source code (generated + hand-written)
│   ├── client.ts         # API.make/makePaginated factory
│   ├── traits.ts         # HTTP trait annotations (PathParam, Http, etc.)
│   ├── errors.ts         # Typed error classes
│   ├── category.ts       # Error categories (re-exported from core)
│   └── operations/       # Generated operations (DO NOT HAND-EDIT)
├── tests/                # Tests
├── specs/                # Git submodules with vendor specs (see below)
├── scripts/              # Code generation scripts
├── lib/                  # Build output (gitignored) — .js, .d.ts, .js.map, .d.ts.map
├── package.json
└── tsconfig.json
```

### Core Package

`projects/distilled/packages/core` (`@oddlynew/distilled-core`) contains shared infrastructure used by all SDKs:

- `client.ts` — `API.make()` and `API.makePaginated()` factories that create Effect operations from annotated schemas
- `traits.ts` — Schema annotations for HTTP bindings (`T.Http`, `T.PathParam`, `T.HttpHeader`, `T.JsonName`, etc.)
- `errors.ts` — Base error classes (`NotFound`, `Unauthorized`, `Forbidden`, etc.) with error code matching
- `category.ts` — Error categories (`AuthError`, `ThrottlingError`, `ServerError`, etc.) for retry logic and semantic grouping
- `pagination.ts` — `paginatePages`/`paginateItems` stream utilities
- `retry.ts` — Retry policy configuration
- `sensitive.ts` — Sensitive data schemas
- `json-patch.ts` — JSON Patch (RFC 6902) implementation for spec patching

All other packages depend on core via the `@oddlynew/distilled-core` workspace dependency.

## Tools

| Tool       | Purpose                                    | Command                                  |
| ---------- | ------------------------------------------ | ---------------------------------------- |
| **Bun**    | Runtime, package manager, test runner      | `bun install`, `bun run ...`             |
| **tsgo**   | Type checking (native TypeScript compiler) | `tsgo` (check), `tsgo -b` (build)        |
| **oxlint** | Linter                                     | `oxlint --fix src`                       |
| **oxfmt**  | Formatter                                  | `oxfmt --write src`, `oxfmt --check src` |
| **vitest** | Test framework                             | `bun nx test <project>`                  |
| **Effect** | Core framework                             | All operations return `Effect<A, E, R>`  |

### Package Scripts And Nx Targets

Package scripts are intentionally smaller in the monorepo than they were in the standalone repo.
Use Nx from the repository root for validation, because shared plugins infer the standard
`typecheck` and `lint` targets from each package's `tsconfig.json` and oxlint config.

| Script     | Command                                                                                     | Description                                 |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `build`    | `tsgo -b tsconfig.build.json --noCheck`                                                     | Build to `lib/` (.js + .d.ts + source maps) |
| `fmt`      | `oxfmt --write src`                                                                         | Format source                               |
| `generate` | `bun run scripts/generate.ts && oxlint --fix src && oxfmt --write src && oxfmt --write src` | Regenerate from spec                        |

`@oddlynew/distilled-gcp` is the exception in Nx. Its generated source is large enough that
whole-package `tsgo -b` exceeds standard CI runner memory, so its Nx `build` target uses
`projects/distilled/scripts/build-generated-package.ts` to emit JS and declarations one file at a
time. Its `typecheck` target remains inferred from `tsconfig.src.json`, and its custom lint target
uses `oxlint src` to avoid loading the generated package as a type-aware program.

Each generated package uses this TypeScript shape:

- `tsconfig.json` is a solution file for Nx inference.
- `tsconfig.dev.json` covers package-local tooling/config files.
- `tsconfig.src.json` emits declaration-only validation output to `.tsbuild/`.
- `tsconfig.build.json` emits publishable package output to `lib/`, except GCP which uses the
  file-by-file build script.

### Monorepo Build

```bash
bun nx build @oddlynew/distilled-core
bun nx build @oddlynew/distilled-stripe
```

Core must be built before other packages because provider packages depend on its emitted
declarations. Nx models that dependency ordering through the project graph, so use
`bun nx build <project>` or the affected validation helper instead of the old standalone root build.

### Scaffolding a New SDK

Use `create-sdk` to scaffold a new SDK package with all boilerplate, submodule setup, and code generation:

```bash
bun run create-sdk <name> --specs <url-or-repo>...
```

Examples:

```bash
# OpenAPI spec URL → creates distilled-spec-* mirror repo
bun run create-sdk stripe --specs https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json

# Git repo → adds as direct submodule
bun run create-sdk stripe --specs https://github.com/stripe/openapi.git
```

After scaffolding, the `create-sdk` script automatically calls Claude to review the OpenAPI spec and update credentials, client error handling, and auth to match the actual API.

## Submodules and Specs

Each SDK package has vendor API specifications stored as git submodules under `specs/`:

| Package           | Submodule(s)                                                                             | Contents                                  |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| `aws`             | `specs/api-models-aws`, `specs/aws-sdk-js-v3`, `specs/smithy`, `specs/smithy-typescript` | Smithy models, reference SDK, Smithy spec |
| `cloudflare`      | `specs/cloudflare-typescript`                                                            | Cloudflare TypeScript SDK source          |
| `coinbase`        | `specs/cdp-sdk`                                                                          | Coinbase Developer Platform SDK           |
| `fly-io`          | `specs/distilled-spec-fly-io`                                                            | Fly.io OpenAPI spec                       |
| `gcp`             | `specs/distilled-spec-gcp`                                                               | GCP Discovery Documents                   |
| `mongodb-atlas`   | `specs/distilled-spec-mongodb-atlas`                                                     | MongoDB Atlas OpenAPI spec                |
| `neon`            | `specs/distilled-spec-neon`                                                              | Neon OpenAPI spec                         |
| `planetscale`     | `specs/distilled-spec-planetscale`                                                       | PlanetScale OpenAPI spec                  |
| `prisma-postgres` | `specs/distilled-spec-prisma-postgres`                                                   | Prisma Postgres OpenAPI spec              |
| `stripe`          | `specs/stripe-openapi`                                                                   | Stripe OpenAPI spec                       |
| `supabase`        | `specs/distilled-spec-supabase`                                                          | Supabase OpenAPI spec                     |
| `turso`           | `specs/turso-docs`                                                                       | Turso API docs                            |

**Submodules are NOT needed for building or typechecking.** They're only needed for code generation (`bun run generate`), with the exception of `aws` which also needs its submodules for testing.

```bash
# Fetch specs for a package (only needed for generation)
bun run specs:fetch    # in a package directory

# Update specs to latest upstream
bun run specs:update   # in a package directory
```

## Writing Patches

Each SDK uses a patch system to fix vendor spec inaccuracies. When you encounter an untyped error (e.g. `UnknownCloudflareError`, `PlanetScaleApiError`):

1. Run the test with `DEBUG=1` to see the raw error response
2. Add the error to the appropriate patch file
3. Regenerate: `bun nx run @oddlynew/distilled-<provider>:generate` from the repo root, or
   `bun run generate` from the package directory
4. Import the new typed error and update the test

### Patch Locations

| Package           | Patch Format            | Location                           |
| ----------------- | ----------------------- | ---------------------------------- |
| `aws`             | Smithy error additions  | `spec/{service}.json`              |
| `cloudflare`      | Expression DSL matchers | `patch/{service}/{operation}.json` |
| `gcp`             | gRPC status matchers    | `patch/{service}/{operation}.json` |
| `neon`            | JSON Patch (RFC 6902)   | `specs/*.patch.json`               |
| `planetscale`     | JSON Patch (RFC 6902)   | `specs/*.patch.json`               |
| `prisma-postgres` | JSON Patch (RFC 6902)   | `specs/*.patch.json`               |

## Effect 4 (IMPORTANT)

This project uses **Effect 4** (`effect@4.x`), which is unlikely to be in your training data. The API has significant breaking changes from Effect 3. **Do NOT rely on training data for Effect APIs — always reference the actual code in the codebase and `node_modules`.**

### How to verify APIs

1. **Check existing code first** — search tests and `src/` for usage patterns of whatever API you need (e.g. `grep` for `Effect.retry`, `Effect.catch`, `Schedule.spaced`, etc.)
2. **Check `node_modules`** — the Effect source is at `node_modules/.bun/effect@*/node_modules/effect/src/`. Read the actual type signatures when unsure.
3. **Do NOT guess** — if you're unsure whether a function exists or what its signature is, look it up in the codebase or node_modules first.

### Key Effect 4 API changes (non-exhaustive)

| Effect 3 (old)               | Effect 4 (current)                               | Notes                                   |
| ---------------------------- | ------------------------------------------------ | --------------------------------------- |
| `Effect.catchAll(fn)`        | `Effect.catch(fn)`                               | `catchAll` does not exist               |
| `Effect.catchTag("Tag", fn)` | `Effect.catch("Tag", fn)`                        | Catch by tag is via overload            |
| `Effect.retry(schedule)`     | `Effect.retry({ schedule })`                     | Takes options object, not bare schedule |
| `Effect.retry({ times: 3 })` | `Effect.retry({ schedule: Schedule.recurs(3) })` | Use `Schedule` for retry counts         |

The `while` option on `Effect.retry` is useful for retrying only specific errors:

```typescript
Effect.retry({
  while: (err) => err === "not ready yet",
  schedule: Schedule.spaced("1 second").pipe(
    Schedule.both(Schedule.recurs(10)),
  ),
});
```

### Common patterns in this codebase

```typescript
// Error catching (Effect 4 — use Effect.catch, NOT Effect.catchAll)
someOperation().pipe(Effect.catch(() => Effect.succeed(fallback)));

// Retry with schedule
someOperation().pipe(
  Effect.retry({
    schedule: Schedule.spaced("1 second").pipe(
      Schedule.both(Schedule.recurs(10)),
    ),
  }),
);

// Retry only specific errors
someOperation().pipe(
  Effect.retry({
    while: (err) => err._tag === "ThrottlingException",
    schedule: Schedule.exponential("1 second"),
  }),
);
```

## Writing Tests

### Structure

Tests are organized by API operation:

```typescript
describe("ServiceName", () => {
  describe("operationName", () => {
    test("happy path - returns expected data", () => ...);
    test("error - NotFound for non-existent resource", () => ...);
  });
});
```

### Resource Naming

**Test resource names MUST be unique per test run** to prevent collisions when multiple CI runs (or local runs) execute in parallel. Every package's test support file (`test.ts` or `setup.ts`) exports a `testRunId` — an 8-character random hex string generated once per process via `crypto.randomUUID()`.

The naming convention is: `distilled-{service}-{testname}-{testRunId}`

#### Cloudflare pattern — name helper per file

Each Cloudflare test file defines a name helper that incorporates `testRunId`:

```typescript
import { test, testRunId } from "./test.ts";

const bucketName = (name: string) => `distilled-cf-r2-${name}-${testRunId}`;
```

#### AWS pattern — `withXxx` helpers resolve names

AWS test helpers like `withBucket`, `withQueue`, `withTopic` etc. automatically append `testRunId` to the resource name before creating it:

```typescript
import { test, testRunId } from "../test.ts";

const withBucket = <A, E, R>(
  name: string,
  testFn: (bucket: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const bucket = `${name}-${testRunId}`;
    yield* cleanupBucket(bucket);
    yield* createBucket({ Bucket: bucket });
    return yield* testFn(bucket).pipe(Effect.ensuring(cleanupBucket(bucket)));
  });
```

#### Neon / PlanetScale pattern — setup includes `testRunId`

The shared `setup.ts` includes `testRunId` in the project/database name:

```typescript
export const testRunId: string = crypto
  .randomUUID()
  .replace(/-/g, "")
  .slice(0, 8);

const getProjectName = (suffix?: string): string =>
  suffix
    ? `${TEST_PROJECT_PREFIX}-${suffix}-${testRunId}`
    : `${TEST_PROJECT_PREFIX}-${testRunId}`;
```

Sub-resources within a shared project/database also use `testRunId`:

```typescript
import { testRunId } from "./setup.ts";

const branchName = `test-branch-${testRunId}`;
```

### Resource Cleanup

**Tests MUST always clean up resources they create**, even on failure. Use `Effect.ensuring` or try/finally:

```typescript
it.effect("creates and cleans up resource", () =>
  Effect.gen(function* () {
    const resource = yield* createResource({
      name: `test-resource-${testRunId}`,
    });
    expect(resource.id).toBeDefined();
  }).pipe(
    Effect.ensuring(
      deleteResource({ name: `test-resource-${testRunId}` }).pipe(
        Effect.ignore,
      ),
    ),
  ),
);
```

### Error Testing

```typescript
// Flip the effect to get the error channel
someOperation({ id: "non-existent" }).pipe(
  Effect.flip,
  Effect.map((e) => expect(e._tag).toBe("NotFound")),
);

// Or use matchEffect for more control
someOperation({ id: "non-existent" }).pipe(
  Effect.matchEffect({
    onFailure: (e) => Effect.succeed(e),
    onSuccess: () => Effect.succeed(null),
  }),
);
```

### AI-WORKSPACE

There is `.ai-workspace` in the git ignore, this is designed as a workspace for ai agents to write files and try things without polluting the workspace.

### Key Rules

- **Always clean up** — use `Effect.ensuring` or try/finally with `Effect.ignore` on cleanup
- **Unique names per run** — always include `testRunId` in resource names to prevent collisions between parallel test runs. Use the pattern `distilled-{service}-{testname}-${testRunId}`. Never use bare deterministic names without `testRunId`.
- **Increase timeouts** for tests hitting real APIs — `{ timeout: 30_000 }`
- **Use `DEBUG=1`** to see raw HTTP request/response logs when debugging failures
- **DO NOT modify generated files** in `src/operations/` — fix the generator or patch instead

# Pull Request Conventions

When you automatically open a PR, it MUST follow this structure:

- **Title**: Use conventional commit format (e.g. `fix(website): mobile theme metas`, `feat(aws/s3): add bucket lifecycle rules`).
- **Description heading levels**: NEVER use `#` or `##` in the PR description. The smallest heading allowed is `###`. The PR description must NOT begin with its own title heading — GitHub already renders the PR title above it.
- **Content**: Aim for the minimal content needed to convey the idea.
  - Use simple sentences. If there are multiple discrete changes, use bullet points.
  - For anything that warrants it (new features, new resources, serious changes to existing resources, API/behavior changes), include code snippets and/or ` ```diff ` blocks showing what changes from the user's perspective.
  - Skip examples for trivial fixes, internal refactors, or doc-only changes.
- **Outstanding work / testing / review needed**: If there are outstanding steps, manual testing required, or review items, DO NOT leave a comment on the PR and DO NOT include them in the PR description. Instead:
  1. Mark the PR as **draft**.
  2. Tell the user (in the chat that initiated the PR creation) what is outstanding.

The summary goes at the very top of the description as plain prose — NO heading above it, no `### Summary`, nothing. The PR title already serves as the title; do not repeat or re-title it. Only add `###` subheadings further down if the description genuinely has multiple sections worth separating.

**Markdown — write it plainly, do not escape:**

- Inline code uses single backticks: `` `MyThing` ``. Block code uses triple backticks. That's it.
- NEVER pad backticks with spaces (`` ` ` `MyThing` ` ` ``). NEVER escape them. The result looks like garbage and is never what the user wants.
- When passing a PR body to `gh`, write it to a file and use `--body-file` (or `gh api -F body=@file`). Do NOT inline it in a heredoc you then try to escape — that is what causes the broken backticks.
- If `gh pr edit` fails (it can fail on some repos due to a Projects-classic GraphQL deprecation), retry via `gh api -X PATCH repos/{owner}/{repo}/pulls/{n} -F body=@file.md`.

Example PR description (good):

```
Persist the user's selected theme across reloads and fix a hero scroll glitch on mobile.

- Read theme from `localStorage` on mount before first paint
- Add `<meta name="theme-color">` per theme so mobile chrome matches
```

Example PR description (BAD — do not do this):

```
## Theme persistence fix    ← no, the PR title already exists
### Summary                  ← no, summary needs no heading
Persist the user's theme...
```
