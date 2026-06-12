import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../Binding.ts";
import { RuntimeContext } from "../RuntimeContext.ts";
import { bindingEnvPrefix, isBindingHost } from "./Reference.ts";
import type { Volume } from "./Volume.ts";

/**
 * Volume mount binding.
 *
 * Attaches a `Railway.Volume` to the consuming Service/Function:
 *
 * - At deploy time, {@link VolumeMountPolicy} records the volume
 *   attachment (`{ volumes: [{ volumeId, mountPath }] }`) on the host's
 *   binding contract; the host provider's reconcile applies it via
 *   `updateVolumeInstance` and redeploys so the mount takes effect. The
 *   mount path is also published as `<PREFIX>_MOUNT_PATH` so the runtime
 *   accessor can find it.
 * - At runtime, `VolumeMount.bind(volume)` returns an Effect producing
 *   the absolute mount path inside the container. It requires
 *   {@link RuntimeContext}.
 *
 * Create the volume *without* `service` props when binding it — the
 * binding owns the attachment:
 *
 * @example
 * ```typescript
 * // stack: const data = yield* Railway.Volume("data", { project, mountPath: "/data" });
 * // function Init:
 * const dataDir = yield* Railway.VolumeMount.bind(data);
 * // runtime:
 * const dir = yield* dataDir; // "/data"
 * ```
 */
export class VolumeMount extends Binding.Service<
  VolumeMount,
  (
    volume: Volume,
  ) => Effect.Effect<Effect.Effect<string, never, RuntimeContext>>
>()("Railway.VolumeMount") {}

export const VolumeMountLive = Layer.effect(
  VolumeMount,
  Effect.gen(function* () {
    const Policy = yield* VolumeMountPolicy;

    return Effect.fn(function* (volume: Volume) {
      yield* Policy(volume);
      const key = `${bindingEnvPrefix(volume)}_MOUNT_PATH`;
      return RuntimeContext.pipe(
        Effect.flatMap((ctx) => {
          const value = ctx.env[key];
          return typeof value === "string" && value.length > 0
            ? Effect.succeed(value)
            : Effect.die(
                `Railway.VolumeMount: env var '${key}' is not set — ` +
                  `was '${volume.LogicalId}' bound via VolumeMountPolicy at deploy time?`,
              );
        }),
      );
    });
  }),
);

/**
 * Deploy-time half of {@link VolumeMount}: records the volume attachment
 * and the mount-path env var on the consuming Railway service.
 */
export class VolumeMountPolicy extends Binding.Policy<
  VolumeMountPolicy,
  (volume: Volume) => Effect.Effect<void>
>()("Railway.VolumeMount") {}

export const VolumeMountPolicyLive = VolumeMountPolicy.layer.succeed(
  Effect.fn(function* (host, volume) {
    if (isBindingHost(host)) {
      const prefix = bindingEnvPrefix(volume);
      yield* host.bind`Mount(${host}, ${volume})`({
        env: {
          [`${prefix}_MOUNT_PATH`]: volume.mountPath,
        },
        volumes: [
          {
            volumeId: volume.volumeId,
            mountPath: volume.mountPath,
          },
        ],
      });
    } else {
      return yield* Effect.die(
        `VolumeMountPolicy does not support runtime '${host.Type}'`,
      );
    }
  }),
);
