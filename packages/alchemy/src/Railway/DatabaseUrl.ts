import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Binding from "../Binding.ts";
import { RuntimeContext } from "../RuntimeContext.ts";
import type { Database } from "./Database.ts";
import {
  bindingEnvPrefix,
  isBindingHost,
  serviceReference,
} from "./Reference.ts";

/**
 * Database connection binding.
 *
 * Injects a `Railway.Database`'s connection URL into the consuming
 * Service/Function:
 *
 * - At deploy time, {@link DatabaseUrlPolicy} writes
 *   `<PREFIX>_URL=${{<DbName>.<URL_VARIABLE>}}` (e.g.
 *   `${{Postgres.DATABASE_URL}}`) onto the host's variables using Railway
 *   reference-variable syntax, so Railway resolves it server-side and
 *   keeps it fresh if the database's domain or credentials change.
 * - At runtime, `DatabaseUrl.bind(db)` returns an Effect producing the
 *   resolved connection URL as a `Redacted<string>`. It requires
 *   {@link RuntimeContext}.
 *
 * @example
 * ```typescript
 * Effect.gen(function* () {
 *   const url = yield* Railway.DatabaseUrl.bind(db);
 *   return {
 *     fetch: Effect.gen(function* () {
 *       const connectionString = Redacted.value(yield* url);
 *       // pass to pg/mysql2/mongodb/ioredis...
 *     }),
 *   };
 * }).pipe(Effect.provide(Railway.DatabaseUrlLive))
 * ```
 */
export class DatabaseUrl extends Binding.Service<
  DatabaseUrl,
  (
    database: Database,
  ) => Effect.Effect<
    Effect.Effect<Redacted.Redacted<string>, never, RuntimeContext>
  >
>()("Railway.DatabaseUrl") {}

export const DatabaseUrlLive = Layer.effect(
  DatabaseUrl,
  Effect.gen(function* () {
    const Policy = yield* DatabaseUrlPolicy;

    return Effect.fn(function* (database: Database) {
      yield* Policy(database);
      const key = `${bindingEnvPrefix(database)}_URL`;
      return RuntimeContext.pipe(
        Effect.flatMap((ctx) => {
          const value = ctx.env[key];
          return typeof value === "string" && value.length > 0
            ? Effect.succeed(Redacted.make(value))
            : Effect.die(
                `Railway.DatabaseUrl: env var '${key}' is not set — ` +
                  `was '${database.LogicalId}' bound via DatabaseUrlPolicy at deploy time?`,
              );
        }),
      );
    });
  }),
);

/**
 * Deploy-time half of {@link DatabaseUrl}: records the reference-variable
 * env var on the consuming Railway service.
 */
export class DatabaseUrlPolicy extends Binding.Policy<
  DatabaseUrlPolicy,
  (database: Database) => Effect.Effect<void>
>()("Railway.DatabaseUrl") {}

export const DatabaseUrlPolicyLive = DatabaseUrlPolicy.layer.succeed(
  Effect.fn(function* (host, database) {
    if (isBindingHost(host)) {
      const prefix = bindingEnvPrefix(database);
      yield* host.bind`DatabaseUrl(${host}, ${database})`({
        env: {
          // `${{<name>.DATABASE_URL>}}`-style reference; `urlVariable`
          // is itself an Output (DATABASE_URL / REDIS_URL / ...).
          [`${prefix}_URL`]: serviceReference(database, database.urlVariable),
        },
      });
    } else {
      return yield* Effect.die(
        `DatabaseUrlPolicy does not support runtime '${host.Type}'`,
      );
    }
  }),
);
