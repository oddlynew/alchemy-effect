import {
  createService,
  createVolume,
  deleteService,
  deleteVolume,
  deployServiceInstanceV2,
  getService,
  getServiceInstance,
  getVariables,
  updateService,
  upsertVariableCollection,
} from "@distilled.cloud/railway";
import * as crypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import type { Resource } from "../Resource.ts";
import {
  resolveEnvironmentId,
  resolveProjectId,
  type EnvironmentSource,
  type ProjectSource,
} from "./Environment.ts";
import { resolveDefaultEnvironment } from "./Project.ts";
import type { Providers } from "./Providers.ts";
import {
  findServiceByName,
  waitForDeployment,
  type DeploymentStatus,
} from "./Service.ts";

/**
 * Railway resolves `${{RAILWAY_PRIVATE_DOMAIN}}` (own-service template
 * syntax) server-side, so connection URLs always track the live private
 * domain.
 */
export const PRIVATE_DOMAIN = "${{RAILWAY_PRIVATE_DOMAIN}}";

/**
 * The image/volume/variable layout of a Railway database engine —
 * mirrors Railway's official database templates (the SDK exposes no way
 * to discover the service a `templateDeployV2` workflow created, so we
 * deploy the same images directly; every aspect stays observable and
 * reconcilable).
 */
export interface DatabaseEngineSpec {
  /** Docker image the official Railway template deploys. */
  image: string;
  /** Port the engine listens on inside the private network. */
  port: number;
  /** Where the data volume is mounted. */
  mountPath: string;
  /** Default admin username baked into the engine variables. */
  username: string;
  /** Default logical database name (where the engine has one). */
  database: string | undefined;
  /** Build the engine's service variables from the generated password. */
  variables: (password: string) => Record<string, string>;
}

/**
 * Props shared by every Railway database engine resource
 * (`PostgresDatabase`, `MySQLDatabase`).
 */
export type DatabaseEngineProps = {
  /**
   * The Railway project (or `{ projectId }`) to create the database in.
   */
  project: ProjectSource;
  /**
   * The environment (or `{ environmentId }`) to deploy into. Defaults to
   * the project's base environment when the project is a `Project`
   * resource (otherwise required).
   */
  environment?: EnvironmentSource;
  /**
   * Service name. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`.
   */
  name?: string;
  /**
   * Region to deploy into, e.g. `us-west2`.
   */
  region?: string;
};

/**
 * Output attributes shared by every Railway database engine resource.
 */
export type DatabaseEngineAttributes = {
  serviceId: string;
  name: string;
  projectId: string;
  environmentId: string;
  volumeId: string;
  /** Port the engine listens on inside the private network. */
  port: number;
  /** Default admin username. */
  username: string;
  /** Default logical database name (where the engine has one). */
  database: string | undefined;
  /** Generated admin password (persisted in state). */
  password: string;
  deploymentId: string | undefined;
  deploymentStatus: DeploymentStatus | undefined;
};

const generatePassword = Effect.sync(() =>
  crypto.randomBytes(24).toString("base64url"),
);

/**
 * A Railway database engine resource — `PostgresDatabase` and
 * `MySQLDatabase` are instances of this shape; only the type string (and
 * the engine spec wired into the provider) differ.
 */
export type DatabaseEngineResource<Type extends string> = Resource<
  Type,
  DatabaseEngineProps,
  DatabaseEngineAttributes,
  never,
  Providers
>;

/**
 * Build the provider for a database engine resource. The lifecycle is
 * identical across engines — only the image/port/variable spec differs.
 */
export const makeDatabaseEngineProvider = <Type extends string>(
  cls: Parameters<typeof Provider.succeed<DatabaseEngineResource<Type>>>[0],
  spec: DatabaseEngineSpec,
) =>
  Provider.succeed(cls, {
    stables: [
      "serviceId",
      "projectId",
      "environmentId",
      "volumeId",
      "port",
      "username",
      "database",
      "password",
    ],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const projectId = resolveProjectId(news.project as ProjectSource);
        if (projectId !== output.projectId) {
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
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const projectId = resolveProjectId(news.project as ProjectSource);
      const environmentId = news.environment
        ? resolveEnvironmentId(news.environment as EnvironmentSource)
        : (yield* resolveDefaultEnvironment(projectId)).id;
      // Railway service names are documented at max 32 characters.
      const name =
        news.name ??
        (yield* createPhysicalName({ id, lowercase: true, maxLength: 32 }));

      // The password is generated once and persisted in state; rotation
      // would require coordinated re-provisioning of the engine's data
      // directory, so it is deliberately stable.
      const password = output?.password ?? (yield* generatePassword);
      const desiredVariables = spec.variables(password);

      // Observe — does the service still exist? Soft-deleted services are
      // still returned by getService with `deletedAt` set.
      const observed = output?.serviceId
        ? yield* getService({ id: output.serviceId }).pipe(
            Effect.map((s) => (s.deletedAt !== null ? undefined : s)),
            Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
          )
        : undefined;

      // Ensure — create the database service if missing, else sync name.
      let serviceId: string;
      let createdNow = false;
      if (!observed) {
        const created = yield* createService({
          input: {
            projectId,
            environmentId,
            name,
            source: { image: spec.image },
            variables: desiredVariables,
          },
        }).pipe(
          // AlreadyExists race / orphan from a crashed run — adopt the
          // existing service with that name; the sync steps below converge
          // it. If the name is held by a mid-deletion service, the
          // conflict is transient — retry until it frees up.
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

      // Ensure — the data volume. Railway exposes no read API for volume
      // instances, so `output.volumeId` is the cache of record here.
      let volumeId = output?.volumeId;
      if (!volumeId) {
        const volume = yield* createVolume({
          input: {
            projectId,
            environmentId,
            serviceId,
            mountPath: spec.mountPath,
            region: news.region,
          },
        });
        volumeId = volume.id;
      }

      // Sync — variables, diffed against observed cloud variables.
      const observedVariables = (yield* getVariables({
        projectId,
        environmentId,
        serviceId,
      })) as Record<string, string>;
      const upserts: Record<string, string> = {};
      for (const [key, value] of Object.entries(desiredVariables)) {
        if (observedVariables[key] !== value) upserts[key] = value;
      }
      const variablesChanged = Object.keys(upserts).length > 0;
      if (variablesChanged) {
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

      // Deploy — when anything changed or no healthy deployment exists.
      const instance = yield* getServiceInstance({ serviceId, environmentId });
      let deploymentId = instance.latestDeployment?.id ?? undefined;
      let deploymentStatus = (instance.latestDeployment?.status ??
        undefined) as DeploymentStatus | undefined;
      const shouldDeploy =
        createdNow ||
        variablesChanged ||
        deploymentStatus === undefined ||
        deploymentStatus === "FAILED" ||
        deploymentStatus === "CRASHED" ||
        deploymentStatus === "REMOVED" ||
        deploymentStatus === "SKIPPED";
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
        volumeId,
        port: spec.port,
        username: spec.username,
        database: spec.database,
        password,
        deploymentId,
        deploymentStatus,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteService({ id: output.serviceId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
      yield* deleteVolume({ volumeId: output.volumeId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
    }),
  });
