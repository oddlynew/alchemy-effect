import {
  createTcpProxy,
  deleteTcpProxy,
  getTcpProxies,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { resolveEnvironmentId, type EnvironmentSource } from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import { resolveServiceId, type ServiceSource } from "./Service.ts";

export type TcpProxyProps = {
  /**
   * The Railway service (or `{ serviceId }`) to proxy to.
   */
  service: ServiceSource;
  /**
   * The environment (or `{ environmentId }`) the proxy lives in.
   * Defaults to the environment of the given `Service` resource.
   */
  environment?: EnvironmentSource;
  /**
   * The port your application listens on inside the container.
   * Changing it replaces the proxy.
   */
  applicationPort: number;
};

export type TcpProxy = Resource<
  "Railway.TcpProxy",
  TcpProxyProps,
  {
    proxyId: string;
    /** Public domain of the proxy, e.g. `yamabiko.proxy.rlwy.net`. */
    domain: string;
    /** Public port assigned by Railway. */
    proxyPort: number;
    applicationPort: number;
    serviceId: string;
    environmentId: string;
  },
  never,
  Providers
>;

/**
 * A Railway TCP proxy — exposes a raw TCP port of a service publicly
 * (e.g. for databases or game servers).
 *
 * Note: Railway requires a redeploy of the service for a newly created
 * proxy to become active; trigger one by updating the `Service` (or rely
 * on the next deploy).
 *
 * @section Exposing a TCP Port
 * @example Proxy a Postgres service
 * ```typescript
 * const db = yield* Railway.Service("db", {
 *   project,
 *   source: { image: "postgres:16" },
 *   variables: { POSTGRES_PASSWORD: "secret" },
 * });
 * const proxy = yield* Railway.TcpProxy("db-proxy", {
 *   service: db,
 *   applicationPort: 5432,
 * });
 * // connect via `${proxy.domain}:${proxy.proxyPort}`
 * ```
 *
 * @see https://docs.railway.com/guides/public-networking#tcp-proxying
 */
export const TcpProxy = Resource<TcpProxy>("Railway.TcpProxy");

const resolveIds = (props: TcpProxyProps) => {
  const serviceId = resolveServiceId(props.service);
  const environmentId = props.environment
    ? resolveEnvironmentId(props.environment)
    : "environmentId" in props.service && props.service.environmentId
      ? (props.service.environmentId as unknown as string)
      : undefined;
  if (!environmentId) {
    throw new Error(
      "Railway.TcpProxy requires `environment` when `service` is not a Service resource",
    );
  }
  return { serviceId, environmentId };
};

export const TcpProxyProvider = () =>
  Provider.succeed(TcpProxy, {
    stables: ["proxyId", "domain", "proxyPort", "serviceId", "environmentId"],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const { serviceId, environmentId } = resolveIds(news);
        if (
          serviceId !== output.serviceId ||
          environmentId !== output.environmentId ||
          news.applicationPort !== output.applicationPort
        ) {
          // The proxy has no update API — any change is a replacement.
          // Railway allows only a single TCP proxy per service instance,
          // so the old proxy must be deleted before the new one is created.
          return { action: "replace", deleteFirst: true } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output?.proxyId) return undefined;
      const proxies = yield* getTcpProxies({
        serviceId: output.serviceId,
        environmentId: output.environmentId,
      }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      );
      const match = proxies?.find((p) => p.id === output.proxyId);
      if (!match) return undefined;
      return {
        ...output,
        domain: match.domain,
        proxyPort: match.proxyPort,
        applicationPort: match.applicationPort,
      };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const { serviceId, environmentId } = resolveIds(news);

      // Observe — an existing proxy for this application port.
      const proxies = yield* getTcpProxies({ serviceId, environmentId });
      const observed = proxies.find(
        (p) =>
          p.id === output?.proxyId ||
          p.applicationPort === news.applicationPort,
      );

      // Railway allows only a single TCP proxy per service instance, so a
      // stale proxy (e.g. the old generation during a replacement) must be
      // deleted before the desired one can be created.
      if (!observed) {
        for (const stale of proxies) {
          yield* deleteTcpProxyIdempotent(stale.id, serviceId, environmentId);
        }
      }

      // Ensure — create when missing. Retry the single-proxy conflict in
      // case a just-deleted proxy is still releasing its slot.
      const proxy =
        observed ??
        (yield* createTcpProxy({
          input: {
            serviceId,
            environmentId,
            applicationPort: news.applicationPort,
          },
        }).pipe(
          Effect.retry({
            while: (e) => e._tag === "TcpProxyLimitExceeded",
            schedule: Schedule.spaced("2 seconds"),
            times: 30,
          }),
        ));

      return {
        proxyId: proxy.id,
        domain: proxy.domain,
        proxyPort: proxy.proxyPort,
        applicationPort: proxy.applicationPort,
        serviceId,
        environmentId,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteTcpProxyIdempotent(
        output.proxyId,
        output.serviceId,
        output.environmentId,
      );
    }),
  });

/**
 * Delete a TCP proxy idempotently. Railway answers
 * `TcpProxyOperationInProgress` both for a genuinely busy proxy AND for a
 * proxy that is already deleted/deleting — so on that error we observe the
 * live proxy list and only keep retrying while the proxy still exists.
 */
const deleteTcpProxyIdempotent = (
  proxyId: string,
  serviceId: string,
  environmentId: string,
) =>
  deleteTcpProxy({ id: proxyId }).pipe(
    Effect.asVoid,
    Effect.catchTags({
      NotAuthorized: () => Effect.void,
      ProblemProcessingRequest: () => Effect.void,
      TcpProxyOperationInProgress: (err) =>
        getTcpProxies({ serviceId, environmentId }).pipe(
          Effect.catchTag("NotAuthorized", () => Effect.succeed([])),
          Effect.flatMap((proxies) =>
            proxies.some((p) => p.id === proxyId)
              ? Effect.fail(err)
              : Effect.void,
          ),
        ),
    }),
    Effect.retry({
      while: (e) => e._tag === "TcpProxyOperationInProgress",
      schedule: Schedule.spaced("2 seconds"),
      times: 30,
    }),
  );
