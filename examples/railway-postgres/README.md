# railway-postgres

An end-to-end Effect-native Railway application built with Alchemy:

- **`Railway.Project`** — the project containing every service ([src/Project.ts](./src/Project.ts))
- **`Railway.Database`** — a Postgres database with a persistent volume, mirroring Railway's official template ([src/Postgres.ts](./src/Postgres.ts))
- **`Railway.Function`** — an Effect-native HTTP service bundled and uploaded straight to Railway's build pipeline, exposed on a public `*.up.railway.app` domain ([src/Api.ts](./src/Api.ts))
- **`Railway.DatabaseUrl`** — binds the database's connection string into the Function via Railway reference variables (`${{Postgres.DATABASE_URL}}`), surfaced at runtime as a `Redacted<string>`
- **`effect/Config`** — `GREETING` is read with `Config.string` in the Init phase, automatically published as a service variable, and re-read from the environment at runtime

## Routes

| Route     | Behavior                                                          |
| --------- | ----------------------------------------------------------------- |
| `/`       | Returns the `GREETING` config value                               |
| `/db`     | Runs `select now(), current_database(), version()` over the bound Postgres |
| `/health` | Railway healthcheck                                               |

## Deploy

Authenticate with a Railway API token (or run `alchemy login railway`):

```sh
export RAILWAY_API_TOKEN=...
```

Then, from this directory:

```sh
bun i
bun run deploy
```

The stack outputs include the public URL:

```sh
curl https://<service>.up.railway.app/
curl https://<service>.up.railway.app/db
```

Optionally set `GREETING` in your environment (or `.env`) before deploying to
see the config value flow through to the service.

## Destroy

```sh
bun run destroy
```

## Notes

- The Railway Function runtime does not currently provide `RuntimeContext`
  to the `fetch` handler, so binding accessors (like the one returned by
  `Railway.DatabaseUrl.bind`) fail at runtime with
  `Service not found: RuntimeContext`. As a workaround, [src/Api.ts](./src/Api.ts)
  captures `RuntimeContext` during Init and re-provides it on the handler.
- Railway rejects service names containing underscores, so the services set
  explicit `name`s instead of relying on the generated physical name (which
  embeds the stage, e.g. `dev_yourname`).
