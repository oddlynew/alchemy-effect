import {
  createCustomDomain,
  deleteCustomDomain,
  getDomains,
  getService,
  updateCustomDomain,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { resolveEnvironmentId, type EnvironmentSource } from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import { resolveServiceId, type ServiceSource } from "./Service.ts";

export type DnsRecord = {
  fqdn: string;
  recordType: string;
  requiredValue: string;
  currentValue: string | undefined;
  zone: string | undefined;
  status: string | undefined;
};

export type CustomDomainProps = {
  /**
   * The Railway service (or `{ serviceId }`) the domain routes to.
   */
  service: ServiceSource;
  /**
   * The environment (or `{ environmentId }`) the domain routes to.
   * Defaults to the environment of the given `Service` resource.
   */
  environment?: EnvironmentSource;
  /**
   * Fully-qualified domain name to attach, e.g. `api.example.com`.
   * Changing it replaces the domain.
   */
  domain: string;
  /**
   * Container port the domain routes to. Defaults to Railway's detected
   * port.
   */
  targetPort?: number;
};

export type CustomDomain = Resource<
  "Railway.CustomDomain",
  CustomDomainProps,
  {
    domainId: string;
    domain: string;
    projectId: string;
    serviceId: string;
    environmentId: string;
    targetPort: number | undefined;
    /**
     * DNS records that must be created at your DNS provider for the
     * domain to verify and route to Railway.
     */
    dnsRecords: DnsRecord[];
  },
  never,
  Providers
>;

/**
 * A custom domain attached to a Railway service. Railway provisions the
 * TLS certificate once the required DNS records are in place.
 *
 * @section Attaching a Custom Domain
 * @example Attach a domain to a service
 * ```typescript
 * const api = yield* Railway.Service("api", {
 *   project,
 *   source: { image: "nginx:alpine" },
 * });
 * const domain = yield* Railway.CustomDomain("api-domain", {
 *   service: api,
 *   domain: "api.example.com",
 * });
 * // create the records in `domain.dnsRecords` at your DNS provider
 * ```
 *
 * @see https://docs.railway.com/guides/public-networking#custom-domains
 */
export const CustomDomain = Resource<CustomDomain>("Railway.CustomDomain");

const resolveIds = (props: CustomDomainProps) => {
  const serviceId = resolveServiceId(props.service);
  const environmentId = props.environment
    ? resolveEnvironmentId(props.environment)
    : "environmentId" in props.service && props.service.environmentId
      ? (props.service.environmentId as unknown as string)
      : undefined;
  if (!environmentId) {
    throw new Error(
      "Railway.CustomDomain requires `environment` when `service` is not a Service resource",
    );
  }
  return { serviceId, environmentId };
};

const toDnsRecords = (
  records:
    | ReadonlyArray<{
        fqdn: string;
        recordType: string;
        requiredValue: string;
        currentValue?: string | null;
        zone?: string | null;
        status?: string | null;
      }>
    | null
    | undefined,
): DnsRecord[] =>
  (records ?? []).map((r) => ({
    fqdn: r.fqdn,
    recordType: r.recordType,
    requiredValue: r.requiredValue,
    currentValue: r.currentValue ?? undefined,
    zone: r.zone ?? undefined,
    status: r.status ?? undefined,
  }));

export const CustomDomainProvider = () =>
  Provider.succeed(CustomDomain, {
    stables: ["domainId", "projectId", "serviceId", "environmentId"],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const { serviceId, environmentId } = resolveIds(news);
        if (
          news.domain !== output.domain ||
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
      const match = domains?.customDomains.find(
        (d) => d.id === output.domainId,
      );
      if (!match) return undefined;
      return {
        ...output,
        domain: match.domain,
        targetPort: match.targetPort ?? undefined,
      };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const { serviceId, environmentId } = resolveIds(news);
      const projectId =
        output?.projectId ?? (yield* getService({ id: serviceId })).projectId;

      // Observe — find the existing custom domain by id or name.
      const domains = yield* getDomains({
        projectId,
        environmentId,
        serviceId,
      });
      const observed = domains.customDomains.find(
        (d) => d.id === output?.domainId || d.domain === news.domain,
      );

      if (!observed) {
        // Ensure — attach the domain.
        const created = yield* createCustomDomain({
          input: {
            projectId,
            serviceId,
            environmentId,
            domain: news.domain,
            targetPort: news.targetPort,
          },
        });
        return {
          domainId: created.id,
          domain: created.domain,
          projectId,
          serviceId,
          environmentId,
          targetPort: created.targetPort ?? undefined,
          dnsRecords: toDnsRecords(created.status.dnsRecords as any),
        };
      }

      // Sync — adjust the target port when it differs.
      if (
        news.targetPort !== undefined &&
        (observed.targetPort ?? undefined) !== news.targetPort
      ) {
        yield* updateCustomDomain({
          id: observed.id,
          environmentId,
          targetPort: news.targetPort,
        });
      }

      return {
        domainId: observed.id,
        domain: observed.domain,
        projectId,
        serviceId,
        environmentId,
        targetPort: news.targetPort ?? observed.targetPort ?? undefined,
        // dnsRecords are only returned on create — keep the cached copy.
        dnsRecords: output?.dnsRecords ?? [],
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteCustomDomain({ id: output.domainId }).pipe(
        Effect.catchTags({
          NotAuthorized: () => Effect.void,
          ProblemProcessingRequest: () => Effect.void,
        }),
      );
    }),
  });
