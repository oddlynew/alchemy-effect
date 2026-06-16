import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Output from "../Output.ts";
import * as Redacted from "effect/Redacted";
import * as Binding from "../Binding.ts";
import { RuntimeContext } from "../RuntimeContext.ts";
import type { PostgresDatabase } from "./PostgresDatabase.ts";
import {
  bindingEnvPrefix,
  isBindingHost,
  serviceReference,
} from "./Reference.ts";

/**
 * Typed runtime accessor for a bound {@link PostgresDatabase}. Every
 * Effect requires {@link RuntimeContext} — the values only exist inside
 * the deployed Railway service whose variables the deploy-time policy
 * wrote.
 */
export interface PostgresDatabaseClient {
  /**
   * A Postgres connection string for use with a driver/ORM, e.g.
   * `postgresql://postgres:…@<db>.railway.internal:5432/railway`.
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
 * Postgres database binding.
 *
 * - At deploy time, {@link PostgresDatabaseBindingPolicy} writes
 *   `<PREFIX>_URL=${{<DbName>.DATABASE_URL}}` (plus `_HOST`, `_PORT`,
 *   `_USER`, `_PASSWORD`, `_DATABASE`) onto the host's variables using
 *   Railway reference-variable syntax, so Railway resolves them
 *   server-side and keeps them fresh if the database's domain or
 *   credentials change.
 * - At runtime, `PostgresDatabase.bind(db)` returns a typed
 *   {@link PostgresDatabaseClient} whose Effects read those variables.
 *
 * @example
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
 * @binding
 */
export class PostgresDatabaseBinding extends Binding.Service<
  PostgresDatabaseBinding,
  (database: PostgresDatabase) => Effect.Effect<PostgresDatabaseClient>
>()("Railway.PostgresDatabase.Binding") {}

export const PostgresDatabaseBindingLive = Layer.effect(
  PostgresDatabaseBinding,
  Effect.gen(function* () {
    const Policy = yield* PostgresDatabaseBindingPolicy;

    return Effect.fn(function* (database: PostgresDatabase) {
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
      } satisfies PostgresDatabaseClient;
    });
  }),
);

/**
 * Deploy-time half of {@link PostgresDatabaseBinding}: records the
 * reference-variable env vars on the consuming Railway service.
 */
export class PostgresDatabaseBindingPolicy extends Binding.Policy<
  PostgresDatabaseBindingPolicy,
  (database: PostgresDatabase) => Effect.Effect<void>
>()("Railway.PostgresDatabase.Binding") {}

export const PostgresDatabaseBindingPolicyLive =
  PostgresDatabaseBindingPolicy.layer.succeed(
    Effect.fn(function* (host, database) {
      if (!isBindingHost(host)) {
        return yield* Effect.die(
          `PostgresDatabaseBinding does not support runtime '${host.Type}'`,
        );
      }
      const prefix = bindingEnvPrefix(database);
      yield* host.bind`PostgresDatabase(${host}, ${database})`({
        env: {
          // `${{<name>.DATABASE_URL>}}`-style references — Railway
          // resolves them server-side when the variables are read.
          [`${prefix}_URL`]: serviceReference(database, "DATABASE_URL"),
          [`${prefix}_HOST`]: serviceReference(
            database,
            "RAILWAY_PRIVATE_DOMAIN",
          ),
          [`${prefix}_PORT`]: Output.interpolate`${database.port}`,
          [`${prefix}_USER`]: serviceReference(database, "POSTGRES_USER"),
          [`${prefix}_PASSWORD`]: serviceReference(
            database,
            "POSTGRES_PASSWORD",
          ),
          [`${prefix}_DATABASE`]: serviceReference(database, "POSTGRES_DB"),
        },
      });
    }),
  );

/** Read a required binding env var from the runtime environment. */
const readEnv = (database: PostgresDatabase, suffix: string) =>
  RuntimeContext.pipe(
    Effect.flatMap((ctx) => {
      const key = `${bindingEnvPrefix(database)}_${suffix}`;
      const value = ctx.env[key];
      return typeof value === "string" && value.length > 0
        ? Effect.succeed(value)
        : Effect.die(
            `Railway.PostgresDatabase: env var '${key}' is not set — ` +
              `was '${database.LogicalId}' bound at deploy time?`,
          );
    }),
  );
