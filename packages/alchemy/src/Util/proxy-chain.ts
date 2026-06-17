import * as Effect from "effect/Effect";

type Op =
  | { kind: "get"; prop: PropertyKey }
  | { kind: "call"; args: unknown[] };

/**
 * Replay an op chain against a real value. `get` reads a property,
 * `call` invokes — bound to the previous receiver so `this` resolves
 * to the object the method was read from (drizzle's `select()` etc.
 * read `this._.session`, so dropping `this` would throw).
 */
export const replay = (root: unknown, ops: ReadonlyArray<Op>): unknown => {
  let cur: any = root;
  let receiver: any = root;
  for (const op of ops) {
    if (op.kind === "get") {
      receiver = cur;
      cur = cur[op.prop];
    } else {
      cur = cur.apply(receiver, op.args);
      receiver = cur;
    }
  }
  return cur;
};

/**
 * Wrap a cached `Effect<T>` in a chainable Proxy so callers can use the
 * returned value as if it were `T` itself — every property read and call
 * records a step, and the chain is replayed against the resolved value
 * when it's finally yielded as an Effect.
 *
 * Compare:
 *
 * ```typescript
 * // Without proxyChain — caller has to yield the cached Effect first:
 * const conn = yield* makeConnection();      // Effect<Db>
 * fetch: Effect.gen(function* () {
 *   const db = yield* conn;
 *   const rows = yield* db.select().from(users);
 * });
 *
 * // With proxyChain — caller treats the return as the value directly:
 * const db = proxyChain(yield* Effect.cached(makeDb));   // T
 * fetch: Effect.gen(function* () {
 *   const rows = yield* db.select().from(users);
 * });
 * ```
 *
 * The chain ends when the proxy is yielded as an Effect — the resolved
 * value at that point must be a `Yieldable` (an Effect, drizzle query
 * builder, etc). Anything before that is recorded as ops.
 */
export const proxyChain = <T>(cached: Effect.Effect<T, any, any>): T =>
  chain(
    cached,
    [],
    (value) => value as Effect.Effect<unknown, unknown, unknown>,
  ) as T;

/**
 * Like {@link proxyChain}, but for targets whose query builders resolve to a
 * `Promise`/thenable rather than an `Effect` — e.g. drizzle's
 * `aws-data-api/pg` driver (its query builders extend `QueryPromise`, which is
 * a real `Promise`). At the terminal `yield*`, the replayed value is wrapped in
 * `Effect.tryPromise` when it is a thenable; non-thenable values (e.g. reading
 * `db.$client`) pass through unchanged so they can still be yielded.
 *
 * `onError` maps a rejected promise's cause into the Effect's error channel.
 */
export const proxyChainPromise = <T, E = unknown>(
  cached: Effect.Effect<T, any, any>,
  onError: (cause: unknown) => E = (cause) => cause as E,
): T =>
  chain(cached, [], (value) => {
    if (
      value != null &&
      typeof (value as { then?: unknown }).then === "function"
    ) {
      return Effect.tryPromise({
        try: () => value as Promise<unknown>,
        catch: onError,
      });
    }
    return value as Effect.Effect<unknown, unknown, unknown>;
  }) as T;

const chain = (
  cached: Effect.Effect<unknown, any, any>,
  ops: ReadonlyArray<Op>,
  toEffect: (value: unknown) => Effect.Effect<unknown, unknown, unknown>,
): unknown =>
  new Proxy(function () {} as any, {
    get(_, prop) {
      if (prop === Symbol.iterator) {
        // `yield* proxy` — produce the resolved Effect's iterator.
        return function () {
          const eff = Effect.flatMap(cached, (root) =>
            toEffect(replay(root, ops)),
          );
          return (eff as any)[Symbol.iterator]();
        };
      }
      return chain(cached, [...ops, { kind: "get", prop }], toEffect);
    },
    apply(_, __, args) {
      return chain(cached, [...ops, { kind: "call", args }], toEffect);
    },
  });
