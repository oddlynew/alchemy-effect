import { Resource } from "../Resource.ts";
import {
  makeDatabaseEngineProvider,
  PRIVATE_DOMAIN,
  type DatabaseEngineAttributes,
  type DatabaseEngineProps,
} from "./DatabaseEngine.ts";
import { MySQLDatabaseBinding } from "./MySQLDatabaseBinding.ts";
import type { Providers } from "./Providers.ts";

export type MySQLDatabaseProps = DatabaseEngineProps;

export type MySQLDatabase = Resource<
  "Railway.MySQLDatabase",
  MySQLDatabaseProps,
  DatabaseEngineAttributes,
  never,
  Providers
>;

/**
 * A Railway-hosted MySQL database — the same image, volume, and variable
 * layout as Railway's official MySQL template, deployed as a fully
 * reconciled service with a persistent volume and a private-network
 * connection URL.
 *
 * Consume it from a `Railway.Service`/`Railway.Function` with
 * `MySQLDatabase.bind(db)`, which injects the connection details via
 * Railway reference-variable syntax (`${{MySQL.MYSQL_URL}}`) so Railway
 * keeps them fresh, and returns a typed runtime accessor.
 *
 * @section Creating a Database
 * @example MySQL database in a project
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const db = yield* Railway.MySQLDatabase("db", { project });
 * ```
 *
 * @section Binding to a Function
 * @example Read the connection string at runtime
 * ```typescript
 * Effect.gen(function* () {
 *   const db = yield* Railway.MySQLDatabase.bind(MyDatabase);
 *   return {
 *     fetch: Effect.gen(function* () {
 *       const url = Redacted.value(yield* db.connectionString);
 *       // pass to mysql2 / drizzle / kysely...
 *     }),
 *   };
 * }).pipe(Effect.provide(Railway.MySQLDatabaseBindingLive))
 * ```
 *
 * @see https://docs.railway.com/guides/mysql
 */
export const MySQLDatabase = Resource<MySQLDatabase>("Railway.MySQLDatabase")({
  bind: MySQLDatabaseBinding.bind,
});

export const isMySQLDatabase = (value: any): value is MySQLDatabase =>
  typeof value === "object" &&
  value !== null &&
  "Type" in value &&
  value.Type === "Railway.MySQLDatabase";

export const MySQLDatabaseProvider = () =>
  makeDatabaseEngineProvider<"Railway.MySQLDatabase">(MySQLDatabase, {
    image: "mysql:8",
    port: 3306,
    mountPath: "/var/lib/mysql",
    username: "root",
    database: "railway",
    variables: (password) => ({
      MYSQL_ROOT_PASSWORD: password,
      MYSQL_DATABASE: "railway",
      MYSQL_URL: `mysql://root:${password}@${PRIVATE_DOMAIN}:3306/railway`,
    }),
  });
