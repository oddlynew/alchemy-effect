import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../Binding.ts";
import { RuntimeContext } from "../RuntimeContext.ts";
import {
  bindingEnvPrefix,
  isBindingHost,
  serviceReference,
  type BindingHost,
} from "./Reference.ts";

/**
 * Typed runtime handle to a bound Railway service, returned by
 * `Connect.bind(service)`. Every accessor requires {@link RuntimeContext} —
 * they only make sense inside a deployed Railway service whose variables
 * were reconciled with the `ConnectPolicy` env bindings.
 */
export interface ServiceConnection {
  /**
   * The target's private-network domain, e.g. `my-api.railway.internal`.
   * Only reachable from inside the same Railway environment.
   */
  readonly privateDomain: Effect.Effect<string, never, RuntimeContext>;
  /**
   * `http://<privateDomain>` (optionally with a port). Railway's private
   * network is HTTP — TLS terminates at the public edge only.
   */
  readonly privateUrl: (options?: {
    readonly port?: number;
  }) => Effect.Effect<string, never, RuntimeContext>;
  /**
   * The target's public domain (e.g. `my-api-production-xxxx.up.railway.app`),
   * or `undefined` when the target has no public domain attached.
   */
  readonly publicDomain: Effect.Effect<
    string | undefined,
    never,
    RuntimeContext
  >;
  /**
   * `https://<publicDomain>`, or `undefined` when the target has no public
   * domain attached.
   */
  readonly publicUrl: Effect.Effect<string | undefined, never, RuntimeContext>;
}

/**
 * Service-to-service connectivity binding.
 *
 * At deploy time, {@link ConnectPolicy} injects the target service's
 * private and public domains into the consuming service's variables using
 * Railway reference-variable syntax (`${{Name.RAILWAY_PRIVATE_DOMAIN}}`),
 * so Railway keeps the values fresh even if the target's domains change.
 *
 * At runtime, `Connect.bind(service)` returns a {@link ServiceConnection}
 * with typed URL accessors.
 *
 * @example
 * ```typescript
 * const api = yield* Connect.bind(apiService);
 * const url = yield* api.privateUrl({ port: 8080 });
 * // => http://my-api.railway.internal:8080
 * ```
 */
export class Connect extends Binding.Service<
  Connect,
  (service: BindingHost) => Effect.Effect<ServiceConnection>
>()("Railway.Connect") {}

const readEnv = (key: string) =>
  RuntimeContext.pipe(
    Effect.map((ctx) => {
      const value = ctx.env[key];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    }),
  );

export const ConnectLive = Layer.effect(
  Connect,
  Effect.gen(function* () {
    const Policy = yield* ConnectPolicy;

    return Effect.fn(function* (service: BindingHost) {
      yield* Policy(service);
      const prefix = bindingEnvPrefix(service);

      const privateDomain = readEnv(`${prefix}_PRIVATE_DOMAIN`).pipe(
        Effect.flatMap((domain) =>
          domain !== undefined
            ? Effect.succeed(domain)
            : Effect.die(
                `Railway.Connect: env var '${prefix}_PRIVATE_DOMAIN' is not set — ` +
                  `was '${service.LogicalId}' bound via ConnectPolicy at deploy time?`,
              ),
        ),
      );
      const publicDomain = readEnv(`${prefix}_PUBLIC_DOMAIN`);

      const connection: ServiceConnection = {
        privateDomain,
        privateUrl: (options) =>
          Effect.map(privateDomain, (domain) =>
            options?.port !== undefined
              ? `http://${domain}:${options.port}`
              : `http://${domain}`,
          ),
        publicDomain,
        publicUrl: Effect.map(publicDomain, (domain) =>
          domain !== undefined ? `https://${domain}` : undefined,
        ),
      };
      return connection;
    });
  }),
);

/**
 * Deploy-time half of {@link Connect}: records the target service's
 * private/public domains as env vars on the consuming Railway service.
 */
export class ConnectPolicy extends Binding.Policy<
  ConnectPolicy,
  (service: BindingHost) => Effect.Effect<void>
>()("Railway.Connect") {}

export const ConnectPolicyLive = ConnectPolicy.layer.succeed(
  Effect.fn(function* (host, service) {
    if (isBindingHost(host)) {
      const prefix = bindingEnvPrefix(service);
      yield* host.bind`Connect(${host}, ${service})`({
        env: {
          [`${prefix}_PRIVATE_DOMAIN`]: serviceReference(
            service,
            "RAILWAY_PRIVATE_DOMAIN",
          ),
          [`${prefix}_PUBLIC_DOMAIN`]: serviceReference(
            service,
            "RAILWAY_PUBLIC_DOMAIN",
          ),
        },
      });
    } else {
      return yield* Effect.die(
        `ConnectPolicy does not support runtime '${host.Type}'`,
      );
    }
  }),
);
