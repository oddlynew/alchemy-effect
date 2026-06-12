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
import { Resource } from "../Resource.ts";
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
 * The built-in database engines Railway offers via its official
 * templates.
 */
export type DatabaseKind = "postgres" | "redis" | "mysql" | "mongo";

interface DatabaseSpec {
  /** Docker image the official Railway template deploys. */
  image: string;
  /** Port the engine listens on inside the private network. */
  port: number;
  /** Where the data volume is mounted. */
  mountPath: string;
  /** Name of the service variable carrying the connection URL. */
  urlVariable: string;
  /** Default username baked into the engine variables. */
  username: string;
  /** Default logical database name (where the engine has one). */
  database: string | undefined;
  /**
   * Build the service variables. `RAILWAY_PRIVATE_DOMAIN` is referenced
   * with Railway's own-service template syntax so the connection URL
   * always tracks the live private domain.
   */
  variables: (password: string) => Record<string, string>;
}

const PRIVATE_DOMAIN = "${{RAILWAY_PRIVATE_DOMAIN}}";

/**
 * Mirrors the variable/volume layout of Railway's official database
 * templates (the SDK exposes no way to discover the service a
 * `templateDeployV2` workflow created, so we deploy the same images
 * directly — every aspect stays observable and reconcilable).
 */
const DATABASE_SPECS: Record<DatabaseKind, DatabaseSpec> = {
  postgres: {
    image: "ghcr.io/railwayapp-templates/postgres-ssl:16",
    port: 5432,
    mountPath: "/var/lib/postgresql/data",
    urlVariable: "DATABASE_URL",
    username: "postgres",
    database: "railway",
    variables: (password) => ({
      PGDATA: "/var/lib/postgresql/data/pgdata",
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: "railway",
      DATABASE_URL: `postgresql://postgres:${password}@${PRIVATE_DOMAIN}:5432/railway`,
    }),
  },
  redis: {
    image: "bitnami/redis:7.2.5",
    port: 6379,
    mountPath: "/bitnami",
    urlVariable: "REDIS_URL",
    username: "default",
    database: undefined,
    variables: (password) => ({
      REDIS_PASSWORD: password,
      // bitnami images run as non-root; Railway volumes need uid 0.
      RAILWAY_RUN_UID: "0",
      REDIS_URL: `redis://default:${password}@${PRIVATE_DOMAIN}:6379`,
    }),
  },
  mysql: {
    image: "mysql:8",
    port: 3306,
    mountPath: "/var/lib/mysql",
    urlVariable: "MYSQL_URL",
    username: "root",
    database: "railway",
    variables: (password) => ({
      MYSQL_ROOT_PASSWORD: password,
      MYSQL_DATABASE: "railway",
      MYSQL_URL: `mysql://root:${password}@${PRIVATE_DOMAIN}:3306/railway`,
    }),
  },
  mongo: {
    image: "mongo:7",
    port: 27017,
    mountPath: "/data/db",
    urlVariable: "MONGO_URL",
    username: "mongo",
    database: undefined,
    variables: (password) => ({
      MONGO_INITDB_ROOT_USERNAME: "mongo",
      MONGO_INITDB_ROOT_PASSWORD: password,
      MONGO_URL: `mongodb://mongo:${password}@${PRIVATE_DOMAIN}:27017`,
    }),
  },
};

export type DatabaseProps = {
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
   * The database engine to deploy.
   */
  kind: DatabaseKind;
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

export type Database = Resource<
  "Railway.Database",
  DatabaseProps,
  {
    serviceId: string;
    name: string;
    projectId: string;
    environmentId: string;
    volumeId: string;
    kind: DatabaseKind;
    /** Port the engine listens on inside the private network. */
    port: number;
    /** Name of the service variable carrying the connection URL, e.g. `DATABASE_URL`. */
    urlVariable: string;
    username: string;
    database: string | undefined;
    /** Generated admin password (persisted in state). */
    password: string;
    deploymentId: string | undefined;
    deploymentStatus: DeploymentStatus | undefined;
  },
  never,
  Providers
>;

/**
 * A Railway-hosted database — the same images, volumes, and variables as
 * Railway's official database templates (Postgres, Redis, MySQL,
 * MongoDB), deployed as a fully reconciled service with a persistent
 * volume and a private-network connection URL.
 *
 * Consume the connection string from another Service/Function with the
 * `DatabaseUrl` binding, which injects it via Railway reference-variable
 * syntax (`${{Postgres.DATABASE_URL}}`) so Railway keeps it fresh.
 *
 * @section Creating a Database
 * @example Postgres
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const db = yield* Railway.Database("db", {
 *   project,
 *   kind: "postgres",
 * });
 * ```
 *
 * @example Redis
 * ```typescript
 * const cache = yield* Railway.Database("cache", {
 *   project,
 *   kind: "redis",
 * });
 * ```
 *
 * @section Consuming a Database
 * @example Bind the connection URL into a Function
 * ```typescript
 * Effect.gen(function* () {
 *   const url = yield* Railway.DatabaseUrl.bind(db);
 *   return {
 *     fetch: Effect.gen(function* () {
 *       const connectionString = Redacted.value(yield* url);
 *       // ... connect with your driver of choice
 *     }),
 *   };
 * }).pipe(Effect.provide(Railway.DatabaseUrlLive))
 * ```
 *
 * @see https://docs.railway.com/guides/databases
 */
export const Database = Resource<Database>("Railway.Database");

export const isDatabase = (value: any): value is Database =>
  typeof value === "object" &&
  value !== null &&
  "Type" in value &&
  value.Type === "Railway.Database";

const generatePassword = Effect.sync(() =>
  crypto.randomBytes(24).toString("base64url"),
);

export const DatabaseProvider = () =>
  Provider.succeed(Database, {
    stables: [
      "serviceId",
      "projectId",
      "environmentId",
      "volumeId",
      "kind",
      "port",
      "urlVariable",
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
        if (news.kind !== output.kind) {
          return { action: "replace" } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output?.serviceId) return undefined;
      return yield* getService({ id: output.serviceId }).pipe(
        Effect.map((service) => ({
          ...output,
          name: service.name,
          projectId: service.projectId,
        })),
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      );
    }),
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const spec = DATABASE_SPECS[news.kind];
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
        kind: news.kind,
        port: spec.port,
        urlVariable: spec.urlVariable,
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
