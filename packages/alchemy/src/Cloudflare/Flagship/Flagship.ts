import * as Effect from "effect/Effect";
import type { Input } from "../../Input.ts";
import { FlagshipBinding, type FlagshipClient } from "./FlagshipBinding.ts";

type FlagshipTypeId = typeof FlagshipTypeId;
const FlagshipTypeId = "Cloudflare.Flagship" as const;

export type FlagshipProps = {
  /**
   * Binding name used when `Flagship` is bound from inside a Worker init phase
   * (`yield* Cloudflare.Flagship(...)`). When passed through
   * `Worker({ env: { ... } })`, the object key remains the binding name.
   *
   * @default "FLAGS"
   */
  name?: string;
  /**
   * The app ID from your Flagship app. Flags are organized into apps that map
   * to your projects or services. Accepts a plain string or a `FlagshipApp`
   * resource's `appId` output.
   */
  appId: Input<string>;
};

/**
 * Marker for a Cloudflare Flagship (feature flags) binding.
 *
 * It carries the binding metadata (`name`, `appId`) so it can be declared
 * directly on a Worker's `env`, and it **is** an Effect: yielding it
 * (`yield* Cloudflare.Flagship(...)`) inside an Effect-native Worker attaches
 * the binding to the surrounding Worker and resolves to the runtime
 * {@link FlagshipClient} — no separate `.bind(...)` step required.
 */
export interface Flagship extends Effect.Effect<
  FlagshipClient,
  never,
  FlagshipBinding
> {
  kind: FlagshipTypeId;
  name: string;
  appId: Input<string>;
}

export const isFlagship = (value: unknown): value is Flagship =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  (value as Flagship).kind === FlagshipTypeId;

/**
 * A Cloudflare Flagship binding for evaluating feature flags from Workers.
 *
 * Flagship is Cloudflare's feature flag service. It lets you control feature
 * visibility in your applications without redeploying code: define flags with
 * targeting rules and percentage-based rollouts, then evaluate them directly
 * inside your Workers through this native binding.
 *
 * Evaluation methods never fail — they always resolve to a value, falling
 * back to the `defaultValue` you provide on errors. Use the `*Details`
 * variants to inspect what went wrong via `errorCode` / `errorMessage`.
 *
 * @binding
 *
 * @section Effect-style Worker (recommended)
 * @example Bind the runtime client and evaluate a boolean flag
 * Yielding the marker attaches the binding to the surrounding Worker and
 * returns the runtime {@link FlagshipClient}. Every `Flagship` method is
 * mirrored as an Effect, so no `Effect.tryPromise` wrapping is needed.
 * ```typescript
 * import * as Effect from "effect/Effect";
 * import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
 *
 * Cloudflare.Worker(
 *   "FlagsWorker",
 *   { main: import.meta.filename },
 *   Effect.gen(function* () {
 *     const flags = yield* Cloudflare.Flagship({ appId: "<APP_ID>" });
 *
 *     return {
 *       fetch: Effect.gen(function* () {
 *         const enabled = yield* flags.getBooleanValue("new-feature", false, {
 *           userId: "user-42",
 *         });
 *         return HttpServerResponse.text(enabled ? "Feature on" : "Feature off");
 *       }),
 *     };
 *   }).pipe(Effect.provide(Cloudflare.FlagshipBindingLive)),
 * );
 * ```
 *
 * @section Evaluating flags
 * @example Typed flag values
 * Each typed getter returns the flag value, falling back to the default when
 * evaluation fails or the flag type does not match.
 * ```typescript
 * const flags = yield* Cloudflare.Flagship({ appId: "<APP_ID>" });
 *
 * const enabled = yield* flags.getBooleanValue("dark-mode", false);
 * const variant = yield* flags.getStringValue("checkout-flow", "v1", {
 *   userId: "user-42",
 *   country: "US",
 * });
 * const maxRetries = yield* flags.getNumberValue("max-retries", 3, {
 *   plan: "enterprise",
 * });
 * const theme = yield* flags.getObjectValue("theme-config", {
 *   primaryColor: "#000",
 *   fontSize: 14,
 * });
 * ```
 *
 * @example Evaluation details
 * The `*Details` variants include metadata about how Flagship resolved the
 * flag — the matched variant, the reason, and any error code.
 * ```typescript
 * const details = yield* flags.getBooleanDetails("dark-mode", false, {
 *   userId: "user-42",
 * });
 * // details.value   — true
 * // details.variant — "on"
 * // details.reason  — "TARGETING_MATCH"
 * ```
 *
 * @section Worker binding metadata
 * @example Declare the binding on `env`
 * ```typescript
 * export const Worker = Cloudflare.Worker("Worker", {
 *   main: "./src/worker.ts",
 *   env: {
 *     FLAGS: Cloudflare.Flagship({ appId: "<APP_ID>" }),
 *   },
 * });
 *
 * export type WorkerEnv = Cloudflare.InferEnv<typeof Worker>;
 * //   { FLAGS: Flagship }
 * ```
 *
 * @example Async-style worker with the raw runtime binding
 * ```typescript
 * import type { WorkerEnv } from "../alchemy.run.ts";
 *
 * export default {
 *   async fetch(request: Request, env: WorkerEnv) {
 *     const enabled = await env.FLAGS.getBooleanValue("new-feature", false, {
 *       userId: "user-42",
 *     });
 *     return new Response(enabled ? "Feature on" : "Feature off");
 *   },
 * };
 * ```
 *
 * @see https://developers.cloudflare.com/flagship/
 * @see https://developers.cloudflare.com/flagship/binding/
 */
export const Flagship: {
  (props: FlagshipProps): Flagship;
  /**
   * Bind an existing `Flagship` marker to the surrounding Worker, returning
   * the runtime client. Equivalent to `yield* flagship` — prefer yielding the
   * marker directly.
   */
  bind: typeof FlagshipBinding.bind;
} = Object.assign(
  (props: FlagshipProps): Flagship => {
    const self: Flagship = Object.assign(
      Effect.suspend(() => FlagshipBinding.bind(self)),
      {
        kind: FlagshipTypeId,
        name: props.name ?? "FLAGS",
        appId: props.appId,
      },
    );
    return self;
  },
  {
    bind: (...args: Parameters<typeof FlagshipBinding.bind>) =>
      FlagshipBinding.bind(...args),
  },
);
