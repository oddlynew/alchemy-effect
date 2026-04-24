import * as Effect from "effect/Effect";
import { type StateService } from "./State.ts";

/**
 * Copy all state (every stack/stage/resource) from `source` into `destination`.
 *
 * Resources are read from the source store and written into the destination
 * store under the same `{ stack, stage, fqn }` keys. Existing entries in the
 * destination with matching keys are overwritten.
 *
 * Stacks and stages are walked sequentially; resources within a single stage
 * are copied concurrently for throughput.
 */
export const copyState = Effect.fnUntraced(function* (
  source: StateService,
  destination: StateService,
  options?: {
    /**
     * Maximum number of resources to copy in parallel within a single stage.
     * @default "unbounded".
     */
    concurrency?: number | "unbounded";
  },
) {
  const stacks = yield* source.listStacks();

  yield* Effect.forEach(
    stacks,
    Effect.fnUntraced(function* (stack) {
      const stages = yield* source.listStages(stack);

      yield* Effect.forEach(
        stages,
        Effect.fnUntraced(function* (stage) {
          const fqns = yield* source.list({ stack, stage });
          const results = yield* Effect.forEach(
            fqns,
            Effect.fnUntraced(function* (fqn) {
              const value = yield* source.get({ stack, stage, fqn });
              if (value) {
                yield* destination.set({ stack, stage, fqn, value });
              }
            }),
            { concurrency: options?.concurrency ?? "unbounded" },
          );
          return results.length;
        }),
        // process all stages concurrently
        { concurrency: "unbounded" },
      );
    }),
  );
});
