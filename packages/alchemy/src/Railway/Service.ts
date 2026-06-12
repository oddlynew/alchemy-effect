import {
  createService,
  deleteService,
  deployServiceInstanceV2,
  getDeployment,
  getEnvironmentServiceInstances,
  type GetEnvironmentServiceInstancesOutput,
  getService,
  getServiceInstance,
  getVariables,
  updateService,
  updateServiceInstance,
  updateVolumeInstance,
  upsertVariableCollection,
  deleteVariable,
} from "@distilled.cloud/railway";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource, type ResourceBinding } from "../Resource.ts";
import {
  resolveEnvironmentId,
  resolveProjectId,
  type EnvironmentSource,
  type ProjectSource,
} from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import { resolveDefaultEnvironment } from "./Project.ts";

export type ServiceSource = Service | { serviceId: string };

/**
 * A volume attachment requested through the Service/Function binding
 * contract (see {@link VolumeMount}). The host's reconcile applies it via
 * `updateVolumeInstance`, attaching the volume to the host service at the
 * given mount path.
 */
export interface ServiceVolumeMount {
  volumeId: string;
  mountPath: string;
}

/**
 * The binding contract shared by `Railway.Service` and `Railway.Function`:
 * policies attach env vars (Railway's native binding mechanism) and/or
 * volume attachments to the consuming service.
 */
export interface ServiceBindingContract {
  env?: Record<string, any>;
  volumes?: ServiceVolumeMount[];
}

export const resolveServiceId = (source: ServiceSource): string => {
  if ("serviceId" in source && source.serviceId) {
    return source.serviceId as unknown as string;
  }
  throw new Error(
    "Invalid Railway service source: must be a Service or { serviceId }",
  );
};

/**
 * Type guard for the `Railway.Service` resource — used by `Binding.Policy`
 * implementations to verify the binding host is a Railway service before
 * attaching env-var binding data to it.
 *
 * `Railway.Function` (the Effect-native runnable unit) deploys as a
 * Railway service and shares the same `{ env? }` binding contract, so
 * policies treat it as a service host too.
 */
export const isService = (value: any): value is Service =>
  typeof value === "object" &&
  value !== null &&
  "Type" in value &&
  (value.Type === "Railway.Service" || value.Type === "Railway.Function");

export type RailwayBuilder = "HEROKU" | "NIXPACKS" | "PAKETO" | "RAILPACK";
export type RailwayRestartPolicy = "ALWAYS" | "NEVER" | "ON_FAILURE";

export type DeploymentStatus =
  | "BUILDING"
  | "CRASHED"
  | "DEPLOYING"
  | "FAILED"
  | "INITIALIZING"
  | "NEEDS_APPROVAL"
  | "QUEUED"
  | "REMOVED"
  | "REMOVING"
  | "SKIPPED"
  | "SLEEPING"
  | "SUCCESS"
  | "WAITING";

export type ServiceProps = {
  /**
   * The Railway project (or `{ projectId }`) to create the service in.
   */
  project: ProjectSource;
  /**
   * The environment (or `{ environmentId }`) whose service instance is
   * managed. Defaults to the project's default (base) environment.
   */
  environment?: EnvironmentSource;
  /**
   * Service name. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`.
   */
  name?: string;
  /**
   * The deployment source of the service — either a Docker `image`
   * (e.g. `nginx:alpine`) or a GitHub `repo` (e.g. `owner/repo`).
   */
  source?: {
    /** Docker image to deploy, e.g. `ghcr.io/foo/bar:latest`. */
    image?: string;
    /** GitHub repository full name, e.g. `railwayapp/starters`. */
    repo?: string;
    /** Git branch to deploy when `repo` is set. */
    branch?: string;
  };
  /**
   * Credentials for pulling images from a private Docker registry.
   */
  registryCredentials?: { username: string; password: string };
  /**
   * Environment variables scoped to this service in the managed
   * environment. Values may reference other Railway resources with
   * Railway's `${{Service.VAR}}` template syntax.
   */
  variables?: Record<string, string>;
  /**
   * Command used to build the service (builder-dependent).
   */
  buildCommand?: string;
  /**
   * Buildpack/builder to use when deploying from a repo.
   */
  builder?: RailwayBuilder;
  /**
   * Cron schedule (e.g. `0 0 * * *`). When set, the service runs as a
   * cron job — started on schedule and expected to exit.
   */
  cronSchedule?: string;
  /**
   * Path to the Dockerfile when building from a repo.
   */
  dockerfilePath?: string;
  /**
   * Seconds to wait for connections to drain on shutdown.
   */
  drainingSeconds?: number;
  /**
   * Path Railway probes to decide a deployment is healthy, e.g. `/health`.
   */
  healthcheckPath?: string;
  /**
   * Seconds to wait for the healthcheck to pass.
   */
  healthcheckTimeout?: number;
  /**
   * Enable IPv6 egress for the service.
   */
  ipv6EgressEnabled?: boolean;
  /**
   * Per-region replica configuration, e.g.
   * `{ "us-west2": { numReplicas: 2 }, "europe-west4": { numReplicas: 1 } }`.
   * Takes precedence over `region`/`numReplicas` when set.
   */
  multiRegionConfig?: Record<string, { numReplicas: number }>;
  /**
   * Nixpacks build plan override (raw JSON) when `builder` is `NIXPACKS`.
   */
  nixpacksPlan?: unknown;
  /**
   * Number of replicas to run.
   *
   * @default 1
   */
  numReplicas?: number;
  /**
   * Seconds the previous deployment keeps running alongside the new one
   * during a deploy (zero-downtime overlap).
   */
  overlapSeconds?: number;
  /**
   * Commands run before each deploy (e.g. migrations).
   */
  preDeployCommand?: string[];
  /**
   * Path to a Railway config file (e.g. `railway.json`) within the repo.
   */
  railwayConfigFile?: string;
  /**
   * Region to deploy the service into, e.g. `us-west2`.
   */
  region?: string;
  /**
   * Restart policy for crashed containers.
   *
   * @default "ON_FAILURE"
   */
  restartPolicyType?: RailwayRestartPolicy;
  /**
   * Max restart retries when `restartPolicyType` is `ON_FAILURE`.
   */
  restartPolicyMaxRetries?: number;
  /**
   * Root directory of the service within the repo.
   */
  rootDirectory?: string;
  /**
   * Enable app sleeping — scale to zero when no traffic.
   *
   * @default false
   */
  sleepApplication?: boolean;
  /**
   * Command used to start the service.
   */
  startCommand?: string;
  /**
   * File patterns that trigger redeploys on change (repo sources).
   */
  watchPatterns?: string[];
  /**
   * Whether to trigger a deployment after reconciling configuration and
   * wait for it to succeed.
   *
   * @default true when `source` is set
   */
  deploy?: boolean;
};

export type Service = Resource<
  "Railway.Service",
  ServiceProps,
  {
    serviceId: string;
    name: string;
    projectId: string;
    environmentId: string;
    /** ID of the most recent deployment triggered/observed by Alchemy. */
    deploymentId: string | undefined;
    /** Status of that deployment. */
    deploymentStatus: DeploymentStatus | undefined;
    /** Names of the service variables managed by this resource. */
    variableNames: string[];
  },
  ServiceBindingContract,
  Providers
>;

/**
 * A Railway service — a deployable workload (Docker image or GitHub repo)
 * within a project, configured per environment.
 *
 * The provider reconciles the service's instance configuration (start
 * command, replicas, regions, healthcheck, cron schedule, ...) and its
 * service-scoped variables, then triggers a deployment and waits for it
 * to become healthy.
 *
 * @section Creating a Service
 * @example Deploy a Docker image
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const api = yield* Railway.Service("api", {
 *   project,
 *   source: { image: "nginx:alpine" },
 * });
 * ```
 *
 * @example Deploy from a GitHub repository
 * ```typescript
 * const app = yield* Railway.Service("app", {
 *   project,
 *   source: { repo: "railwayapp-templates/django", branch: "main" },
 * });
 * ```
 *
 * @section Configuration
 * @example Service with variables and healthcheck
 * ```typescript
 * const api = yield* Railway.Service("api", {
 *   project,
 *   source: { image: "ghcr.io/acme/api:latest" },
 *   variables: {
 *     LOG_LEVEL: "info",
 *     DATABASE_URL: "${{Postgres.DATABASE_URL}}",
 *   },
 *   healthcheckPath: "/health",
 *   numReplicas: 2,
 * });
 * ```
 *
 * @example Cron job service
 * ```typescript
 * const job = yield* Railway.Service("nightly-job", {
 *   project,
 *   source: { image: "ghcr.io/acme/job:latest" },
 *   cronSchedule: "0 3 * * *",
 * });
 * ```
 *
 * @see https://docs.railway.com/reference/services
 */
export const Service = Resource<Service>("Railway.Service");

export class DeploymentFailed extends Data.TaggedError("DeploymentFailed")<{
  deploymentId: string;
  status: DeploymentStatus;
  serviceId: string;
}> {}

export const ServiceProvider = () =>
  Provider.succeed(Service, {
    stables: ["serviceId", "projectId", "environmentId"],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const newProjectId = resolveProjectId(news.project as ProjectSource);
        if (newProjectId !== output.projectId) {
          return { action: "replace" } as const;
        }
        if (
          news.environment &&
          resolveEnvironmentId(news.environment as EnvironmentSource) !==
            output.environmentId
        ) {
          return { action: "replace" } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output?.serviceId) return undefined;
      return yield* getService({ id: output.serviceId }).pipe(
        Effect.map((service) =>
          // Railway soft-deletes services — a deleted service is still
          // returned by getService with `deletedAt` set.
          service.deletedAt !== null
            ? undefined
            : {
                ...output,
                name: service.name,
                projectId: service.projectId,
              },
        ),
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      );
    }),
    reconcile: Effect.fn(function* ({ id, news, olds, output, bindings }) {
      const projectId = resolveProjectId(news.project as ProjectSource);
      const environmentId = news.environment
        ? resolveEnvironmentId(news.environment as EnvironmentSource)
        : yield* defaultEnvironmentId(projectId);
      const name = yield* createServiceName(id, news.name);

      // Desired variables = props.variables + env injected by bindings.
      const bindingEnv = collectBindingEnv(bindings);
      const desiredVariables: Record<string, string> = {
        ...news.variables,
        ...bindingEnv,
      };

      // Observe — does the service still exist? Soft-deleted services are
      // still returned by getService with `deletedAt` set.
      const observed = output?.serviceId
        ? yield* getService({ id: output.serviceId }).pipe(
            Effect.map((s) => (s.deletedAt !== null ? undefined : s)),
            Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
          )
        : undefined;

      // Ensure — create the service if missing, otherwise sync its name.
      let serviceId: string;
      let createdNow = false;
      if (!observed) {
        const created = yield* createService({
          input: {
            projectId,
            environmentId,
            name,
            branch: news.source?.branch,
            source:
              news.source?.image || news.source?.repo
                ? { image: news.source.image, repo: news.source.repo }
                : undefined,
            registryCredentials: news.registryCredentials,
            variables:
              Object.keys(desiredVariables).length > 0
                ? desiredVariables
                : undefined,
          },
        }).pipe(
          // AlreadyExists race / orphan from a crashed run — adopt the
          // existing service with that name instead of failing. If the
          // name is held by a service that is mid-deletion (it no longer
          // shows up in the environment), the conflict is transient —
          // retry below until the name frees up.
          Effect.catchTag("ServiceNameConflict", (conflict) =>
            findServiceByName(environmentId, name).pipe(
              Effect.flatMap((match) =>
                match
                  ? Effect.succeed({ id: match.serviceId })
                  : Effect.fail(conflict),
              ),
            ),
          ),
          Effect.retry({
            while: (e) => e._tag === "ServiceNameConflict",
            schedule: Schedule.spaced("2 seconds"),
            times: 90,
          }),
        );
        serviceId = created.id;
        createdNow = true;
      } else {
        serviceId = observed.id;
        if (observed.name !== name) {
          yield* updateService({ id: serviceId, input: { name } });
        }
      }

      // Sync — service instance configuration, diffed against observed.
      const instance = yield* getServiceInstance({
        serviceId,
        environmentId,
      });
      const patch = buildInstancePatch(news, instance, olds);
      const configChanged = Object.keys(patch).length > 0;
      if (configChanged) {
        yield* updateServiceInstance({
          serviceId,
          environmentId,
          input: patch,
        });
      }

      // Sync — service variables, diffed against observed cloud variables.
      const observedVariables = (yield* getVariables({
        projectId,
        environmentId,
        serviceId,
      })) as Record<string, string>;
      const managedNames = new Set([
        ...(output?.variableNames ?? []),
        ...Object.keys(olds?.variables ?? {}),
      ]);
      const upserts: Record<string, string> = {};
      for (const [key, value] of Object.entries(desiredVariables)) {
        if (observedVariables[key] !== value) {
          upserts[key] = value;
        }
      }
      const removals = [...managedNames].filter(
        (key) => !(key in desiredVariables) && key in (observedVariables ?? {}),
      );
      const variablesChanged =
        Object.keys(upserts).length > 0 || removals.length > 0;
      if (Object.keys(upserts).length > 0) {
        yield* upsertVariableCollection({
          input: {
            projectId,
            environmentId,
            serviceId,
            variables: upserts,
            skipDeploys: true,
          },
        });
      }
      for (const key of removals) {
        yield* deleteVariable({
          input: { projectId, environmentId, serviceId, name: key },
        }).pipe(Effect.catchTag("NotAuthorized", () => Effect.void));
      }

      // Sync — volume attachments requested through bindings.
      const volumesChanged = yield* syncBoundVolumes(
        serviceId,
        environmentId,
        bindings,
      );

      // Deploy — trigger a new deployment when anything changed (or no
      // healthy deployment exists yet) and wait for it to settle.
      let deploymentId = instance.latestDeployment?.id ?? undefined;
      let deploymentStatus = (instance.latestDeployment?.status ??
        undefined) as DeploymentStatus | undefined;
      const shouldDeploy =
        (news.deploy ?? Boolean(news.source)) &&
        (createdNow ||
          configChanged ||
          variablesChanged ||
          volumesChanged ||
          deploymentStatus === undefined ||
          deploymentStatus === "FAILED" ||
          deploymentStatus === "CRASHED" ||
          deploymentStatus === "REMOVED" ||
          deploymentStatus === "SKIPPED");
      if (shouldDeploy) {
        deploymentId = yield* deployServiceInstanceV2({
          serviceId,
          environmentId,
        });
        deploymentStatus = yield* waitForDeployment(serviceId, deploymentId);
      }

      return {
        serviceId,
        name,
        projectId,
        environmentId,
        deploymentId,
        deploymentStatus,
        variableNames: Object.keys(desiredVariables),
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteService({ id: output.serviceId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
    }),
  });

const createServiceName = (id: string, name: string | undefined) =>
  Effect.gen(function* () {
    // Railway service names are documented at max 32 characters — longer
    // names fail with ServiceNameInvalid.
    return (
      name ??
      (yield* createPhysicalName({ id, lowercase: true, maxLength: 32 }))
    );
  });

/**
 * Find a live (non-soft-deleted) service by name via the environment's
 * service-instance connection — Railway's only API for enumerating a
 * project's services.
 */
export const findServiceByName = (environmentId: string, name: string) =>
  Effect.gen(function* () {
    let after: string | undefined;
    while (true) {
      const page: GetEnvironmentServiceInstancesOutput =
        yield* getEnvironmentServiceInstances({
          id: environmentId,
          first: 100,
          ...(after !== undefined ? { after } : {}),
        });
      const match = page.serviceInstances.edges.find(
        (e) => e.node.serviceName === name && e.node.deletedAt === null,
      );
      if (match) return match.node;
      const { hasNextPage, endCursor } = page.serviceInstances.pageInfo;
      if (!hasNextPage || !endCursor) {
        return undefined;
      }
      after = endCursor;
    }
  });

const defaultEnvironmentId = (projectId: string) =>
  Effect.map(resolveDefaultEnvironment(projectId), (env) => env.id);

/**
 * Apply volume attachments requested through the binding contract.
 *
 * Bindings arrive as plan nodes carrying an `action`; only changed
 * bindings touch the API (`create`/`update` attach, `delete` detaches,
 * `noop` skips entirely). Railway has no read API for volume instances,
 * so the binding action is the change signal. Returns `true` when any
 * attachment was mutated (callers fold this into their redeploy
 * decision).
 */
export const syncBoundVolumes = (
  serviceId: string,
  environmentId: string,
  bindings: (ResourceBinding<ServiceBindingContract> & { action?: string })[],
) =>
  Effect.gen(function* () {
    let changed = false;
    for (const binding of bindings) {
      for (const mount of binding.data?.volumes ?? []) {
        if (binding.action === "noop") continue;
        changed = true;
        if (binding.action === "delete") {
          yield* updateVolumeInstance({
            volumeId: mount.volumeId,
            environmentId,
            input: { serviceId: null },
          }).pipe(Effect.catchTag("NotAuthorized", () => Effect.void));
        } else {
          yield* updateVolumeInstance({
            volumeId: mount.volumeId,
            environmentId,
            input: { serviceId, mountPath: mount.mountPath },
          });
        }
      }
    }
    return changed;
  });

const collectBindingEnv = (
  bindings: ResourceBinding<Service["Binding"]>[],
): Record<string, string> =>
  bindings
    .filter(
      (binding: ResourceBinding<Service["Binding"]> & { action?: string }) =>
        binding.action !== "delete",
    )
    .map((binding) => binding?.data?.env ?? {})
    .reduce((acc, env) => ({ ...acc, ...env }), {});

type ServiceInstance = Effect.Success<ReturnType<typeof getServiceInstance>>;

/**
 * Build the minimal `updateServiceInstance` patch — only fields the user
 * specified whose observed value differs from the desired value.
 */
const buildInstancePatch = (
  news: ServiceProps,
  observed: ServiceInstance,
  olds: ServiceProps | undefined,
) => {
  const patch: Record<string, unknown> = {};
  const sync = (key: string, desired: unknown, current: unknown) => {
    if (desired !== undefined && !deepEqual(desired, current ?? undefined)) {
      patch[key] = desired;
    }
  };
  sync("buildCommand", news.buildCommand, observed.buildCommand);
  sync("builder", news.builder, observed.builder);
  sync("cronSchedule", news.cronSchedule, observed.cronSchedule);
  sync("dockerfilePath", news.dockerfilePath, observed.dockerfilePath);
  sync("drainingSeconds", news.drainingSeconds, observed.drainingSeconds);
  sync("healthcheckPath", news.healthcheckPath, observed.healthcheckPath);
  sync(
    "healthcheckTimeout",
    news.healthcheckTimeout,
    observed.healthcheckTimeout,
  );
  sync("ipv6EgressEnabled", news.ipv6EgressEnabled, observed.ipv6EgressEnabled);
  // multiRegionConfig is not observable via getServiceInstance — fall back
  // to the previous props as a hint to skip a no-op patch.
  if (
    news.multiRegionConfig !== undefined &&
    !deepEqual(news.multiRegionConfig, olds?.multiRegionConfig)
  ) {
    patch.multiRegionConfig = news.multiRegionConfig;
  }
  sync("nixpacksPlan", news.nixpacksPlan, observed.nixpacksPlan ?? undefined);
  sync("numReplicas", news.numReplicas, observed.numReplicas);
  sync("overlapSeconds", news.overlapSeconds, observed.overlapSeconds);
  sync("preDeployCommand", news.preDeployCommand, observed.preDeployCommand);
  sync("railwayConfigFile", news.railwayConfigFile, observed.railwayConfigFile);
  sync("region", news.region, observed.region);
  sync(
    "restartPolicyMaxRetries",
    news.restartPolicyMaxRetries,
    observed.restartPolicyMaxRetries,
  );
  sync("restartPolicyType", news.restartPolicyType, observed.restartPolicyType);
  sync("rootDirectory", news.rootDirectory, observed.rootDirectory);
  sync("sleepApplication", news.sleepApplication, observed.sleepApplication);
  sync("startCommand", news.startCommand, observed.startCommand);
  sync("watchPatterns", news.watchPatterns, observed.watchPatterns);
  if (
    news.source &&
    (news.source.image || news.source.repo) &&
    (news.source.image !== (observed.source?.image ?? undefined) ||
      news.source.repo !== (observed.source?.repo ?? undefined))
  ) {
    patch.source = { image: news.source.image, repo: news.source.repo };
  }
  if (news.registryCredentials) {
    // Credentials are write-only — always re-assert when provided.
    patch.registryCredentials = news.registryCredentials;
  }
  return patch;
};

const deepEqual = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

const TERMINAL_STATUSES: ReadonlySet<DeploymentStatus> = new Set([
  "SUCCESS",
  "FAILED",
  "CRASHED",
  "REMOVED",
  "SKIPPED",
  "SLEEPING",
]);

/**
 * Poll a deployment until it reaches a terminal status. Fails with
 * {@link DeploymentFailed} when the deployment ends in `FAILED`/`CRASHED`.
 */
export const waitForDeployment = (serviceId: string, deploymentId: string) =>
  Effect.gen(function* () {
    const deployment = yield* getDeployment({ id: deploymentId }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("5 seconds"),
        until: (d) => TERMINAL_STATUSES.has(d.status as DeploymentStatus),
        times: 180,
      }),
    );
    const status = deployment.status as DeploymentStatus;
    if (status === "FAILED" || status === "CRASHED") {
      return yield* new DeploymentFailed({
        deploymentId,
        status,
        serviceId,
      });
    }
    return status;
  });
