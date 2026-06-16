import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Binding from "../Binding.ts";
import * as Output from "../Output.ts";
import { RuntimeContext } from "../RuntimeContext.ts";
import type { MySQLDatabase } from "./MySQLDatabase.ts";
import {
  bindingEnvPrefix,
  isBindingHost,
  serviceReference,
} from "./Reference.ts";

/**
 * Typed runtime accessor for a bound {@link MySQLDatabase}. Every Effect
 * requires {@link RuntimeContext} — the values only exist inside the
 * deployed Railway service whose variables the deploy-time policy wrote.
 */
export interface MySQLDatabaseClient {
  /**
   * A MySQL connection string for use with a driver/ORM, e.g.
   * `mysql://root:…@<db>.railway.internal:3306/railway`.
   */
  connectionString: Effect.Effect<
    Redacted.Redacted<string>,
    never,
    RuntimeContext
  >;
  /** Private-network hostname of the database service. */
  host: Effect.Effect<string, never, RuntimeContext>;
  /** Port to pair with `host`. */
  port: Effect.Effect<number, never, RuntimeContext>;
  /** Database user. */
  user: Effect.Effect<string, never, RuntimeContext>;
  /** Database password. */
  password: Effect.Effect<Redacted.Redacted<string>, never, RuntimeContext>;
  /** Logical database name. */
  database: Effect.Effect<string, never, RuntimeContext>;
}

/**
 * MySQL database binding.
 *
 * - At deploy time, {@link MySQLDatabaseBindingPolicy} writes
 *   `<PREFIX>_URL=${{<DbName>.MYSQL_URL}}` (plus `_HOST`, `_PORT`,
 *   `_USER`, `_PASSWORD`, `_DATABASE`) onto the host's variables using
 *   Railway reference-variable syntax, so Railway resolves them
 *   server-side and keeps them fresh if the database's domain or
 *   credentials change.
 * - At runtime, `MySQLDatabase.bind(db)` returns a typed
 *   {@link MySQLDatabaseClient} whose Effects read those variables.
 *
 * @example
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
 * @binding
 */
export class MySQLDatabaseBinding extends Binding.Service<
  MySQLDatabaseBinding,
  (database: MySQLDatabase) => Effect.Effect<MySQLDatabaseClient>
>()("Railway.MySQLDatabase.Binding") {}

/** Read a required binding env var from the runtime environment. */
const readEnv = (database: MySQLDatabase, suffix: string) =>
  RuntimeContext.pipe(
    Effect.flatMap((ctx) => {
      const key = `${bindingEnvPrefix(database)}_${suffix}`;
      const value = ctx.env[key];
      return typeof value === "string" && value.length > 0
        ? Effect.succeed(value)
        : Effect.die(
            `Railway.MySQLDatabase: env var '${key}' is not set — ` +
              `was '${database.LogicalId}' bound at deploy time?`,
          );
    }),
  );

export const MySQLDatabaseBindingLive = Layer.effect(
  MySQLDatabaseBinding,
  Effect.gen(function* () {
    const Policy = yield* MySQLDatabaseBindingPolicy;

    return Effect.fn(function* (database: MySQLDatabase) {
      yield* Policy(database);
      return {
        connectionString: readEnv(database, "URL").pipe(
          Effect.map(Redacted.make),
        ),
        host: readEnv(database, "HOST"),
        port: readEnv(database, "PORT").pipe(Effect.map(Number)),
        user: readEnv(database, "USER"),
        password: readEnv(database, "PASSWORD").pipe(Effect.map(Redacted.make)),
        database: readEnv(database, "DATABASE"),
      } satisfies MySQLDatabaseClient;
    });
  }),
);

/**
 * Deploy-time half of {@link MySQLDatabaseBinding}: records the
 * reference-variable env vars on the consuming Railway service.
 */
export class MySQLDatabaseBindingPolicy extends Binding.Policy<
  MySQLDatabaseBindingPolicy,
  (database: MySQLDatabase) => Effect.Effect<void>
>()("Railway.MySQLDatabase.Binding") {}

export const MySQLDatabaseBindingPolicyLive =
  MySQLDatabaseBindingPolicy.layer.succeed(
    Effect.fn(function* (host, database) {
      if (!isBindingHost(host)) {
        return yield* Effect.die(
          `MySQLDatabaseBinding does not support runtime '${host.Type}'`,
        );
      }
      const prefix = bindingEnvPrefix(database);
      yield* host.bind`MySQLDatabase(${host}, ${database})`({
        env: {
          // `${{<name>.MYSQL_URL>}}`-style references — Railway resolves
          // them server-side when the variables are read.
          [`${prefix}_URL`]: serviceReference(database, "MYSQL_URL"),
          [`${prefix}_HOST`]: serviceReference(
            database,
            "RAILWAY_PRIVATE_DOMAIN",
          ),
          [`${prefix}_PORT`]: Output.interpolate`${database.port}`,
          // The root user has no dedicated variable on the engine
          // service — it is fixed by the official template.
          [`${prefix}_USER`]: Output.interpolate`${database.username}`,
          [`${prefix}_PASSWORD`]: serviceReference(
            database,
            "MYSQL_ROOT_PASSWORD",
          ),
          [`${prefix}_DATABASE`]: serviceReference(database, "MYSQL_DATABASE"),
        },
      });
    }),
  );
