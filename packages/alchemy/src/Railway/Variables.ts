import {
  deleteVariable,
  getVariables,
  upsertVariableCollection,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { recordsEqual } from "../Util/equal.ts";
import {
  resolveEnvironmentId,
  resolveProjectId,
  type EnvironmentSource,
  type ProjectSource,
} from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import { resolveServiceId, type ServiceSource } from "./Service.ts";

export type VariablesProps = {
  /**
   * The Railway project (or `{ projectId }`) the variables belong to.
   */
  project: ProjectSource;
  /**
   * The environment (or `{ environmentId }`) the variables belong to.
   */
  environment: EnvironmentSource;
  /**
   * The service (or `{ serviceId }`) to scope the variables to. When
   * omitted, the variables are shared (environment-wide).
   */
  service?: ServiceSource;
  /**
   * The variables to manage. Only variables listed here are owned by
   * this resource — removing a key deletes it from Railway, but foreign
   * variables are left untouched.
   */
  variables: Record<string, string>;
  /**
   * Skip redeploys of affected services when variables change.
   *
   * @default false
   */
  skipDeploys?: boolean;
};

export type Variables = Resource<
  "Railway.Variables",
  VariablesProps,
  {
    projectId: string;
    environmentId: string;
    serviceId: string | undefined;
    /** Names of the variables managed by this resource. */
    names: string[];
    /** The managed variables as last reconciled. */
    variables: Record<string, string>;
  },
  never,
  Providers
>;

/**
 * A set of Railway environment variables — either shared across an
 * environment or scoped to a single service.
 *
 * @section Managing Variables
 * @example Shared (environment-wide) variables
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * yield* Railway.Variables("shared-config", {
 *   project,
 *   environment: { environmentId: project.defaultEnvironmentId },
 *   variables: {
 *     LOG_LEVEL: "info",
 *     REGION: "us-west2",
 *   },
 * });
 * ```
 *
 * @example Service-scoped variables
 * ```typescript
 * yield* Railway.Variables("api-config", {
 *   project,
 *   environment: { environmentId: project.defaultEnvironmentId },
 *   service: api,
 *   variables: { PORT: "8080" },
 * });
 * ```
 *
 * @see https://docs.railway.com/guides/variables
 */
export const Variables = Resource<Variables>("Railway.Variables");

export const VariablesProvider = () =>
  Provider.succeed(Variables, {
    stables: ["projectId", "environmentId", "serviceId"],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const projectId = resolveProjectId(news.project as ProjectSource);
        const environmentId = resolveEnvironmentId(
          news.environment as EnvironmentSource,
        );
        const serviceId = news.service
          ? resolveServiceId(news.service as ServiceSource)
          : undefined;
        if (
          projectId !== output.projectId ||
          environmentId !== output.environmentId ||
          serviceId !== output.serviceId
        ) {
          return { action: "replace" } as const;
        }
        if (!recordsEqual(news.variables ?? {}, output.variables ?? {})) {
          return { action: "update" } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output) return undefined;
      const observed = (yield* getVariables({
        projectId: output.projectId,
        environmentId: output.environmentId,
        serviceId: output.serviceId,
      }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      )) as Record<string, string> | undefined;
      if (observed === undefined) return undefined;
      const variables: Record<string, string> = {};
      for (const name of output.names) {
        if (name in observed) variables[name] = observed[name]!;
      }
      return { ...output, names: Object.keys(variables), variables };
    }),
    reconcile: Effect.fn(function* ({ news, output }) {
      const projectId = resolveProjectId(news.project as ProjectSource);
      const environmentId = resolveEnvironmentId(
        news.environment as EnvironmentSource,
      );
      const serviceId = news.service
        ? resolveServiceId(news.service as ServiceSource)
        : undefined;
      const desired = news.variables ?? {};

      // Observe — current variables in the cloud.
      const observed = (yield* getVariables({
        projectId,
        environmentId,
        serviceId,
      })) as Record<string, string>;

      // Sync — upsert changed values; delete managed names that were removed.
      const upserts: Record<string, string> = {};
      for (const [key, value] of Object.entries(desired)) {
        if (observed[key] !== value) upserts[key] = value;
      }
      if (Object.keys(upserts).length > 0) {
        yield* upsertVariableCollection({
          input: {
            projectId,
            environmentId,
            serviceId,
            variables: upserts,
            skipDeploys: news.skipDeploys,
          },
        });
      }
      const managed = new Set(output?.names ?? []);
      for (const key of managed) {
        if (!(key in desired) && key in observed) {
          yield* deleteVariable({
            input: { projectId, environmentId, serviceId, name: key },
          }).pipe(Effect.catchTag("NotAuthorized", () => Effect.void));
        }
      }

      return {
        projectId,
        environmentId,
        serviceId,
        names: Object.keys(desired),
        variables: desired,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      for (const name of output.names) {
        yield* deleteVariable({
          input: {
            projectId: output.projectId,
            environmentId: output.environmentId,
            serviceId: output.serviceId,
            name,
          },
        }).pipe(Effect.catchTag("NotAuthorized", () => Effect.void));
      }
    }),
  });
