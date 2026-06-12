import {
  createServiceDomain,
  deleteServiceDomain,
  getDomains,
  getService,
  updateServiceDomain,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { resolveEnvironmentId, type EnvironmentSource } from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import { resolveServiceId, type ServiceSource } from "./Service.ts";

export type ServiceDomainProps = {
  /**
   * The Railway service (or `{ serviceId }`) to expose.
   */
  service: ServiceSource;
  /**
   * The environment (or `{ environmentId }`) to expose the service in.
   * Defaults to the environment of the given `Service` resource.
   */
  environment?: EnvironmentSource;
  /**
   * Container port the domain routes to. Defaults to Railway's detected
   * port.
   */
  targetPort?: number;
};

export type ServiceDomain = Resource<
  "Railway.ServiceDomain",
  ServiceDomainProps,
  {
    domainId: string;
    /** The generated `*.up.railway.app` domain. */
    domain: string;
    /** Convenience `https://` URL for the domain. */
    url: string;
    projectId: string;
    serviceId: string;
    environmentId: string;
    targetPort: number | undefined;
  },
  never,
  Providers
>;

/**
 * A Railway-generated public domain (`*.up.railway.app`) for a service,
 * with TLS provisioned automatically.
 *
 * @section Exposing a Service
 * @example Generate a railway.app domain
 * ```typescript
 * const api = yield* Railway.Service("api", {
 *   project,
 *   source: { image: "nginx:alpine" },
 * });
 * const domain = yield* Railway.ServiceDomain("api-domain", {
 *   service: api,
 * });
 * // => domain.url: https://api-production-xxxx.up.railway.app
 * ```
 *
 * @example Route to an explicit container port
 * ```typescript
 * const domain = yield* Railway.ServiceDomain("api-domain", {
 *   service: api,
 *   targetPort: 8080,
 * });
 * ```
 *
 * @see https://docs.railway.com/guides/public-networking
 */
export const ServiceDomain = Resource<ServiceDomain>("Railway.ServiceDomain");

const resolveIds = (props: ServiceDomainProps) => {
  const serviceId = resolveServiceId(props.service);
  const environmentId = props.environment
    ? resolveEnvironmentId(props.environment)
    : "environmentId" in props.service && props.service.environmentId
      ? (props.service.environmentId as unknown as string)
      : undefined;
  if (!environmentId) {
    throw new Error(
      "Railway.ServiceDomain requires `environment` when `service` is not a Service resource",
    );
  }
  return { serviceId, environmentId };
};

export const ServiceDomainProvider = () =>
  Provider.succeed(ServiceDomain, {
    stables: [
      "domainId",
      "domain",
      "url",
      "projectId",
      "serviceId",
      "environmentId",
    ],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const { serviceId, environmentId } = resolveIds(news);
        if (
          serviceId !== output.serviceId ||
          environmentId !== output.environmentId
        ) {
          return { action: "replace" } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output?.domainId) return undefined;
      const domains = yield* getDomains({
        projectId: output.projectId,
        environmentId: output.environmentId,
        serviceId: output.serviceId,
      }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      );
      const match = domains?.serviceDomains.find(
        (d) => d.id === output.domainId,
      );
      if (!match) return undefined;
      return {
        ...output,
        domain: match.domain,
        url: `https://${match.domain}`,
        targetPort: match.targetPort ?? undefined,
      };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const { serviceId, environmentId } = resolveIds(news);
      const projectId =
        output?.projectId ?? (yield* getService({ id: serviceId })).projectId;

      // Observe — find the existing generated domain, if any.
      const domains = yield* getDomains({
        projectId,
        environmentId,
        serviceId,
      });
      const observed = output?.domainId
        ? domains.serviceDomains.find((d) => d.id === output.domainId)
        : undefined;

      // Ensure — create the domain if missing.
      const domain =
        observed ??
        (yield* createServiceDomain({
          input: { serviceId, environmentId, targetPort: news.targetPort },
        }));

      // Sync — adjust the target port if it differs from the observed one.
      if (
        observed &&
        news.targetPort !== undefined &&
        (observed.targetPort ?? undefined) !== news.targetPort
      ) {
        yield* updateServiceDomain({
          input: {
            serviceDomainId: domain.id,
            serviceId,
            environmentId,
            domain: domain.domain,
            targetPort: news.targetPort,
          },
        });
      }

      return {
        domainId: domain.id,
        domain: domain.domain,
        url: `https://${domain.domain}`,
        projectId,
        serviceId,
        environmentId,
        targetPort: news.targetPort ?? domain.targetPort ?? undefined,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteServiceDomain({ id: output.domainId }).pipe(
        Effect.catchTags({
          NotAuthorized: () => Effect.void,
          ProblemProcessingRequest: () => Effect.void,
        }),
      );
    }),
  });
