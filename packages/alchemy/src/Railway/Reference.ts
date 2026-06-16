import * as Output from "../Output.ts";
import { sanitizeKey } from "../RuntimeContext.ts";
import { FunctionTypeId, type Function } from "./Function.ts";
import { isService, type Service } from "./Service.ts";

/**
 * # Railway binding model
 *
 * Railway has no IAM — its native "binding" mechanism is **environment
 * variables** plus **private networking** (every service in an environment
 * can reach every other service at `<service>.railway.internal`). Railway
 * additionally supports *reference variables* — template values like
 * `${{Postgres.DATABASE_URL}}` or `${{shared.LOG_LEVEL}}` that Railway
 * resolves server-side when the variable is read by a deployment.
 *
 * Alchemy maps **real resource relationships** onto the standard
 * `Binding.Service` + `Binding.Policy` split:
 *
 * - The **Policy** (deploy-time) calls `host.bind(...)({ env, volumes })`
 *   on the consuming `Railway.Service`/`Railway.Function`, recording env
 *   vars and volume attachments on the Stack. The host provider's
 *   `reconcile` merges the binding env into the service-scoped variables
 *   it upserts and applies volume attachments, then redeploys.
 * - The **Service** (runtime) returns a typed accessor whose inner Effects
 *   require {@link RuntimeContext} (they only make sense inside a deployed
 *   Railway service) and read the deterministic env var names written by
 *   the Policy from the runtime environment.
 *
 * Bindings (resource relationships only):
 *
 * - {@link Connect} — service-to-service: injects the target's private /
 *   public domains (via `${{Name.RAILWAY_PRIVATE_DOMAIN}}` references) and
 *   exposes typed URL accessors at runtime.
 * - {@link PostgresDatabaseBinding} / {@link MySQLDatabaseBinding} —
 *   inject a database's connection details (via
 *   `${{Name.DATABASE_URL}}`-style references) with RuntimeContext-colored
 *   accessors (`connectionString`, `host`, `port`, `user`, `password`,
 *   `database`).
 * - {@link VolumeMount} — attaches a `Railway.Volume` to the consuming
 *   service and exposes the mount path at runtime.
 *
 * Plain configuration and secrets are **not** bindings: they flow through
 * `effect/Config`. Any `Config` value `yield*`ed in a Function's Init
 * phase is automatically captured by the Platform's ConfigProvider
 * interceptor, published as a Railway service variable at deploy time,
 * and re-read from `process.env` at runtime — see
 * `website/src/content/docs/concepts/secrets.mdx`.
 */

/**
 * A resource that can host Railway bindings (receives env vars / volume
 * attachments through the `ServiceBindingContract`).
 */
export type BindingHost = Service | Function;

export const isBindingHost = (value: any): value is BindingHost =>
  isService(value) ||
  (typeof value === "object" &&
    value !== null &&
    "Type" in value &&
    value.Type === FunctionTypeId);

/**
 * Build a Railway reference-variable expression for a service-scoped
 * variable, e.g. `${{my-api.RAILWAY_PRIVATE_DOMAIN}}`. Railway resolves the
 * reference server-side whenever the consuming service's variables are
 * materialized.
 *
 * @see https://docs.railway.com/guides/variables#reference-variables
 */
export const serviceReference = (
  service: { readonly name: Output.Output<string, never> },
  variable: string | Output.Output<string, never>,
) => Output.interpolate`\${{${service.name}.${variable}}}`;

/**
 * Build a Railway reference-variable expression for a shared
 * (environment-wide) variable, e.g. `${{shared.LOG_LEVEL}}`. Useful for
 * wiring `Railway.Variables`-managed shared values into a service's
 * `variables` props.
 */
export const sharedReference = (name: string) => `\${{shared.${name}}}`;

/**
 * Deterministic env-var prefix for a bound resource, derived from its
 * Logical ID — e.g. logical id `api-server` -> `API_SERVER`. Both the
 * deploy-time Policy (which writes `<PREFIX>_PRIVATE_DOMAIN` etc.) and the
 * runtime accessor (which reads them) derive the same prefix, so the two
 * halves agree without any out-of-band coordination.
 */
export const bindingEnvPrefix = (resource: { LogicalId: string }) =>
  sanitizeKey(resource.LogicalId).toUpperCase();
