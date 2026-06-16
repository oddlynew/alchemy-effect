# railway-postgres

An end-to-end Effect-native Railway application built with Alchemy:

- **`Railway.Project`** — the project containing every service ([src/Project.ts](./src/Project.ts))
- **`Railway.PostgresDatabase`** — a Postgres database with a persistent volume, mirroring Railway's official template ([src/Postgres.ts](./src/Postgres.ts))
- **`Railway.Function`** — an Effect-native HTTP service bundled and uploaded straight to Railway's build pipeline, exposed on a public `*.up.railway.app` domain ([src/Api.ts](./src/Api.ts))
- **`Railway.PostgresDatabase.bind`** — binds the database's connection details into the Function via Railway reference variables (`${{Postgres.DATABASE_URL}}`), surfaced at runtime as typed accessors (`connectionString`, `host`, `port`, `user`, `password`, `database`)
- **`Sql.postgres`** — Effect's native Postgres client (`@effect/sql-pg`), opened from the bound connection string; the pool is built lazily on the first query and shared for the process lifetime
- **`effect/Config`** — `GREETING` is read with `Config.string` in the Init phase, automatically published as a service variable, and re-read from the environment at runtime

For the same stack with Drizzle ORM, see
[railway-postgres-drizzle](../railway-postgres-drizzle/).

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

- Railway rejects service names containing underscores, so the services set
  explicit `name`s instead of relying on the generated physical name (which
  embeds the stage, e.g. `dev_yourname`).
