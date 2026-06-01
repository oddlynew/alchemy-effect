import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

/**
 * The phase an alchemy program is currently executing in.
 *
 * - `construct` — builds the resource graph (Config, Bindings, Resources,
 *   Layers). Runs both locally (`alchemy deploy`, `plan`, `dev`) and in the
 *   cloud at cold start.
 * - `runtime` — the deployed handler (API handlers, async/background jobs).
 *   Only runs in the cloud, and references values declared during `construct`.
 */
export type AlchemyPhase = "construct" | "runtime";

export const ALCHEMY_PHASE = Config.string("ALCHEMY_PHASE").pipe(
  Config.withDefault("construct"),
  Config.mapOrFail((value) => {
    if (value !== "construct" && value !== "runtime") {
      return Effect.die(new Error(`Invalid ALCHEMY_PHASE: ${value}`));
    }
    return Effect.succeed(value as AlchemyPhase);
  }),
  Effect.orDie,
);
