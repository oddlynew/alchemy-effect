# railway-postgres-drizzle

The [railway-postgres](../railway-postgres/) stack with Drizzle ORM
(`drizzle-orm/effect-postgres`) instead of raw SQL:

- **`Railway.Project`** — the project containing every service ([src/Project.ts](./src/Project.ts))
- **`Railway.PostgresDatabase`** — a Postgres database with a persistent volume ([src/Postgres.ts](./src/Postgres.ts))
- **`Railway.Function`** — an Effect-native HTTP service on a public `*.up.railway.app` domain ([src/Api.ts](./src/Api.ts))
- **`Railway.PostgresDatabase.bind`** — injects the connection details via Railway reference variables
- **`Drizzle.postgres`** — Drizzle over Effect's native Postgres client; the pool is built lazily on the first query and shared for the process lifetime

## Routes

| Route     | Behavior                       |
| --------- | ------------------------------ |
| `GET /`   | List users                     |
| `POST /`  | Insert a random user           |
| `/health` | Railway healthcheck            |

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

```sh
curl https://<service>.up.railway.app/
curl -X POST https://<service>.up.railway.app/
```

## Destroy

```sh
bun run destroy
```
