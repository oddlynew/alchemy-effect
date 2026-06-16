import { Resource } from "../Resource.ts";
import {
  makeDatabaseEngineProvider,
  PRIVATE_DOMAIN,
  type DatabaseEngineAttributes,
  type DatabaseEngineProps,
} from "./DatabaseEngine.ts";
import { PostgresDatabaseBinding } from "./PostgresDatabaseBinding.ts";
import type { Providers } from "./Providers.ts";

export type PostgresDatabaseProps = DatabaseEngineProps;

export type PostgresDatabase = Resource<
  "Railway.PostgresDatabase",
  PostgresDatabaseProps,
  DatabaseEngineAttributes,
  never,
  Providers
>;

/**
 * A Railway-hosted Postgres database — the same image, volume, and
 * variable layout as Railway's official Postgres template, deployed as a
 * fully reconciled service with a persistent volume and a
 * private-network connection URL.
 *
 * Consume it from a `Railway.Service`/`Railway.Function` with
 * `PostgresDatabase.bind(db)`, which injects the connection details via
 * Railway reference-variable syntax (`${{Postgres.DATABASE_URL}}`) so
 * Railway keeps them fresh, and returns a typed runtime accessor.
 *
 * @section Creating a Database
 * @example Postgres database in a project
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const db = yield* Railway.PostgresDatabase("db", { project });
 * ```
 *
 * @section Binding to a Function
 * @example Connect with Effect's native Postgres client
 * ```typescript
 * Effect.gen(function* () {
 *   const db = yield* Railway.PostgresDatabase.bind(MyDatabase);
 *   const sql = yield* Sql.postgres(db.connectionString);
 *   return {
 *     fetch: Effect.gen(function* () {
 *       const rows = yield* sql`select now()`;
 *       return yield* HttpServerResponse.json(rows);
 *     }),
 *   };
 * }).pipe(Effect.provide(Railway.PostgresDatabaseBindingLive))
 * ```
 *
 * @see https://docs.railway.com/guides/postgresql
 */
export const PostgresDatabase = Resource<PostgresDatabase>(
  "Railway.PostgresDatabase",
)({
  bind: PostgresDatabaseBinding.bind,
});

export const isPostgresDatabase = (value: any): value is PostgresDatabase =>
  typeof value === "object" &&
  value !== null &&
  "Type" in value &&
  value.Type === "Railway.PostgresDatabase";

export const PostgresDatabaseProvider = () =>
  makeDatabaseEngineProvider<"Railway.PostgresDatabase">(PostgresDatabase, {
    image: "ghcr.io/railwayapp-templates/postgres-ssl:16",
    port: 5432,
    mountPath: "/var/lib/postgresql/data",
    username: "postgres",
    database: "railway",
    variables: (password) => ({
      PGDATA: "/var/lib/postgresql/data/pgdata",
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: "railway",
      DATABASE_URL: `postgresql://postgres:${password}@${PRIVATE_DOMAIN}:5432/railway`,
    }),
  });
