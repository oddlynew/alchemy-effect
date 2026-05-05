/**
 * Shared support for the factory-form of a Platform/Resource — a
 * default export of the shape `(args) => Worker(id, props, body)`.
 *
 * ```ts
 * export default Worker((scriptName: string) =>
 *   Worker("Api", { name: scriptName, main: import.meta.filename, ... }, body));
 * ```
 *
 * At deploy time, calling `yield* MyWorker(...args)` runs the inner
 * Effect and stamps each arg into `Props.env` as its own binding under
 * keys `__ALCHEMY_FACTORY_ARG_<i>__` (plus a count under
 * `__ALCHEMY_FACTORY_ARG_COUNT__`). Top-level `Redacted` args ride the
 * existing `secret_text` binding lifecycle; everything else rides
 * `plain_text`. `Output` args are unwrapped at deploy time by the
 * engine's resolver, so an `Output<Redacted<string>>` lands as a
 * `secret_text` binding too.
 *
 * At runtime, the generated entrypoint detects the
 * {@link FACTORY_MARKER} marker, reads the count, decodes each arg
 * (rebuilding `Redacted` from the JSON marker), and calls the factory
 * before treating the result as a Layer/Effect.
 */

import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Output from "./Output.ts";

export const FACTORY_ARG_COUNT_KEY = "__ALCHEMY_FACTORY_ARG_COUNT__";
export const FACTORY_ARG_PREFIX = "__ALCHEMY_FACTORY_ARG_";
export const factoryArgKey = (i: number) => `${FACTORY_ARG_PREFIX}${i}__`;

export const FACTORY_MARKER = "__alchemyFactory" as const;

const encodeOne = (value: unknown): unknown =>
  Redacted.isRedacted(value)
    ? // Preserve `Redacted`-ness across the env-binding boundary so the
      // create/update lifecycle deploys this arg via `secret_text`. The
      // JSON payload still carries the `_tag` marker so the runtime
      // decode below can rebuild the wrapper after Cloudflare hands the
      // binding back as a plain string.
      Redacted.make(
        JSON.stringify({
          _tag: "Redacted",
          value: Redacted.value(value),
        }),
      )
    : JSON.stringify(value);

const encodeArg = (arg: unknown): unknown =>
  Output.isOutput(arg) ? arg.pipe(Output.map(encodeOne)) : encodeOne(arg);

export const makeFactory = (
  fn: (...args: any[]) => Effect.Effect<any>,
): ((...args: any[]) => Effect.Effect<any>) & {
  readonly [FACTORY_MARKER]: true;
} => {
  const factory = (...args: any[]) =>
    Effect.gen(function* () {
      const resource = yield* fn(...args);
      if (resource && typeof resource === "object") {
        const props = (resource as any).Props ?? {};
        const env: Record<string, unknown> = { ...(props.env ?? {}) };
        env[FACTORY_ARG_COUNT_KEY] = String(args.length);
        for (let i = 0; i < args.length; i++) {
          env[factoryArgKey(i)] = encodeArg(args[i]);
        }
        (resource as any).Props = { ...props, env };
      }
      return resource;
    });
  return Object.assign(factory, { [FACTORY_MARKER]: true as const });
};
