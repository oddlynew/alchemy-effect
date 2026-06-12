import * as flagship from "@distilled.cloud/cloudflare/flagship";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { createPhysicalName } from "../../PhysicalName.ts";
import * as Provider from "../../Provider.ts";
import { Resource } from "../../Resource.ts";
import { CloudflareEnvironment } from "../CloudflareEnvironment.ts";
import type { Providers } from "../Providers.ts";

const FlagshipAppTypeId = "Cloudflare.Flagship.App" as const;
type FlagshipAppTypeId = typeof FlagshipAppTypeId;

export type FlagshipAppProps = {
  /**
   * Human readable app name. Apps group flags by project or service. If
   * omitted, a unique name is generated from the app, stage, and logical ID.
   * @default ${app}-${stage}-${id}
   */
  name?: string;
};

export type FlagshipAppAttributes = {
  /**
   * Server-generated app identifier. Stable across updates; used as the
   * `appId` for flags, the Worker binding, and all evaluation calls.
   */
  appId: string;
  /**
   * The Cloudflare account the app belongs to.
   */
  accountId: string;
  /**
   * Human readable app name.
   */
  name: string;
  /**
   * When the app was created.
   */
  createdAt: string;
  /**
   * When the app was last modified.
   */
  updatedAt: string;
  /**
   * Email of the actor who last modified the app, or `edge-gateway` for
   * gateway-authenticated changes.
   */
  updatedBy: string;
};

export type FlagshipApp = Resource<
  FlagshipAppTypeId,
  FlagshipAppProps,
  FlagshipAppAttributes,
  never,
  Providers
>;

/**
 * A Cloudflare Flagship app — a container for feature flags.
 *
 * Flagship is Cloudflare's feature flag service. Flags are organized into
 * apps that map to your projects or services; the app's `appId` is what a
 * Worker's `Flagship` binding points at and what every evaluation call is
 * scoped to. The name is mutable in place; the app id never changes.
 *
 * @section Creating an App
 * @example App with a generated name
 * ```typescript
 * const app = yield* Cloudflare.FlagshipApp("Flags", {});
 * ```
 *
 * @example App with an explicit name
 * ```typescript
 * const app = yield* Cloudflare.FlagshipApp("Flags", {
 *   name: "my-service-flags",
 * });
 * ```
 *
 * @section Using the App
 * @example Define flags in the app
 * ```typescript
 * const app = yield* Cloudflare.FlagshipApp("Flags", {});
 *
 * const flag = yield* Cloudflare.FlagshipFlag("NewCheckout", {
 *   appId: app.appId,
 *   key: "new-checkout",
 *   defaultVariation: "off",
 *   variations: { off: false, on: true },
 * });
 * ```
 *
 * @example Bind the app to a Worker
 * ```typescript
 * const app = yield* Cloudflare.FlagshipApp("Flags", {});
 *
 * Cloudflare.Worker(
 *   "FlagsWorker",
 *   { main: import.meta.filename },
 *   Effect.gen(function* () {
 *     const flags = yield* Cloudflare.Flagship({ appId: app.appId });
 *     return {
 *       fetch: Effect.gen(function* () {
 *         const enabled = yield* flags.getBooleanValue("new-checkout", false);
 *         return HttpServerResponse.text(enabled ? "on" : "off");
 *       }),
 *     };
 *   }).pipe(Effect.provide(Cloudflare.FlagshipBindingLive)),
 * );
 * ```
 *
 * @see https://developers.cloudflare.com/flagship/
 * @see https://developers.cloudflare.com/api/resources/flagship/
 */
export const FlagshipApp = Resource<FlagshipApp>(FlagshipAppTypeId);

/**
 * Returns true if the given value is a FlagshipApp resource.
 */
export const isFlagshipApp = (value: unknown): value is FlagshipApp =>
  Predicate.hasProperty(value, "Type") && value.Type === FlagshipAppTypeId;

export const FlagshipAppProvider = () =>
  Provider.succeed(FlagshipApp, {
    stables: ["appId", "accountId", "createdAt"],
    diff: Effect.fn(function* ({ output }) {
      const { accountId } = yield* yield* CloudflareEnvironment;
      if ((output?.accountId ?? accountId) !== accountId) {
        return { action: "replace" } as const;
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ id, olds, output }) {
      const { accountId } = yield* yield* CloudflareEnvironment;
      const acct = output?.accountId ?? accountId;

      if (output?.appId) {
        const observed = yield* getApp(acct, output.appId);
        return observed ? toAttributes(observed, acct) : undefined;
      }
      // Cold read — recover from lost state by matching the deterministic
      // physical name. App names are not unique on Cloudflare's side; an
      // exact match on our generated/explicit name is the best identity we
      // have. Pick the oldest match for determinism.
      const name = yield* createAppName(id, olds?.name);
      const match = yield* findByName(acct, name);
      return match ? toAttributes(match, acct) : undefined;
    }),
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const { accountId } = yield* yield* CloudflareEnvironment;
      const name = yield* createAppName(id, news.name);

      // Observe — the appId cached on `output` is a hint, not a guarantee:
      // a missing app falls through and we recreate.
      const observed = output?.appId
        ? yield* getApp(output.accountId ?? accountId, output.appId)
        : undefined;

      if (!observed) {
        // Ensure — greenfield (or out-of-band delete). App names are not
        // unique so there is no AlreadyExists race to tolerate.
        const created = yield* flagship.createApp({ accountId, name });
        return toAttributes(created, accountId);
      }

      // Sync — the only mutable aspect is the name; skip the API on a no-op.
      if (observed.name === name) {
        return toAttributes(observed, accountId);
      }
      const updated = yield* flagship.updateApp({
        accountId,
        appId: observed.id,
        name,
      });
      return toAttributes(updated, accountId);
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* flagship
        .deleteApp({ accountId: output.accountId, appId: output.appId })
        .pipe(Effect.catchTag("FlagshipAppNotFound", () => Effect.void));
    }),
  });

/**
 * Read an app by id, mapping "gone" (`FlagshipAppNotFound`) to `undefined`.
 */
const getApp = (accountId: string, appId: string) =>
  flagship
    .getApp({ accountId, appId })
    .pipe(
      Effect.catchTag("FlagshipAppNotFound", () => Effect.succeed(undefined)),
    );

/**
 * Find an app by exact name. If several apps carry the same name, pick the
 * oldest for determinism.
 */
const findByName = (accountId: string, name: string) =>
  flagship.listApps({ accountId }).pipe(
    Effect.map((list) =>
      list.result
        .filter((a) => a.name === name)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .at(0),
    ),
  );

const createAppName = (id: string, name: string | undefined) =>
  Effect.gen(function* () {
    return name ?? (yield* createPhysicalName({ id, lowercase: true }));
  });

const toAttributes = (
  app:
    | flagship.GetAppResponse
    | flagship.CreateAppResponse
    | flagship.UpdateAppResponse,
  accountId: string,
): FlagshipAppAttributes => ({
  appId: app.id,
  accountId,
  name: app.name,
  createdAt: app.createdAt,
  updatedAt: app.updatedAt,
  updatedBy: app.updatedBy,
});
