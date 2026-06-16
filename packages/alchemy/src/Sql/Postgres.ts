import * as PgClient from "@effect/sql-pg/PgClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ExecutionContext } from "../ExecutionContext.ts";
import { proxyChain } from "../Util/proxy-chain.ts";

/**
 * Open Effect's native Postgres client (`@effect/sql-pg`) from a
 * connection URL.
 *
 * Returns a chainable Proxy over `PgClient` (via `proxyChain`) — every
 * property read records a step, every call records args, and the chain is
 * replayed against the resolved client when it's finally yielded as an
 * Effect. Callers don't need a separate `yield* conn` step:
 *
 * ```typescript
 * const db = yield* Railway.PostgresDatabase.bind(MyDatabase);
 * const sql = yield* Sql.postgres(db.connectionString);
 *
 * fetch: Effect.gen(function* () {
 *   const rows = yield* sql`select now() as now`;
 * });
 * ```
 *
 * The connect work is deferred until the first query and memoized on the
 * current `ExecutionContext` (`ctx.cache`), so the pool is built at most
 * once per execution — a Worker `fetch`/`queue`/`scheduled` event on
 * Cloudflare, or the whole process lifetime on a serverful runtime like a
 * Railway Function — and reused across every query in that execution.
 * Yielding the connection string is likewise deferred, so deploy /
 * plan-time invocations (where the runtime environment isn't provided)
 * never trigger a real connection attempt.
 *
 * The pool is built against the execution's `Scope` (`ctx.scope`), so its
 * `end` finalizer fires when that scope closes — when the request / run /
 * process settles, not when the init scope closes.
 *
 * @binding
 */
export const postgres = <E = never, R = never>(
  connectionString: Effect.Effect<Redacted.Redacted<string>, E, R>,
  config?: Omit<PgClient.PgPoolConfig, "url">,
) =>
  Effect.sync(function () {
    const symbol = Symbol();

    return proxyChain<PgClient.PgClient>(
      Effect.gen(function* () {
        const ctx = yield* ExecutionContext;
        return yield* (ctx.cache[symbol] ??= yield* Effect.gen(function* () {
          const pgCtx = yield* Layer.buildWithScope(
            PgClient.layer({ ...config, url: yield* connectionString }),
            ctx.scope,
          );
          return Context.get(pgCtx, PgClient.PgClient);
        }).pipe(Effect.cached));
      }) as Effect.Effect<PgClient.PgClient>,
    );
  });
