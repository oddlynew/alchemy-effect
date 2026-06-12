import {
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  getEnvironments,
  type GetEnvironmentsOutput,
  renameEnvironment,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Project } from "./Project.ts";
import type { Providers } from "./Providers.ts";

export type ProjectSource = Project | { projectId: string };

export type EnvironmentSource = Environment | { environmentId: string };

export const resolveProjectId = (source: ProjectSource): string => {
  if ("projectId" in source && source.projectId) {
    return source.projectId as unknown as string;
  }
  throw new Error(
    "Invalid Railway project source: must be a Project or { projectId }",
  );
};

export const resolveEnvironmentId = (source: EnvironmentSource): string => {
  if ("environmentId" in source && source.environmentId) {
    return source.environmentId as unknown as string;
  }
  throw new Error(
    "Invalid Railway environment source: must be an Environment or { environmentId }",
  );
};

export type EnvironmentProps = {
  /**
   * The Railway project (or `{ projectId }`) to create the environment in.
   */
  project: ProjectSource;
  /**
   * Environment name. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`.
   */
  name?: string;
  /**
   * Source environment to fork (duplicate services/variables) from.
   * Cannot be changed after creation.
   */
  sourceEnvironment?: EnvironmentSource;
  /**
   * Skip the initial deploys of duplicated services when forking from a
   * source environment.
   *
   * @default false
   */
  skipInitialDeploys?: boolean;
  /**
   * Whether the environment is ephemeral (e.g. a PR environment).
   *
   * @default false
   */
  ephemeral?: boolean;
};

export type Environment = Resource<
  "Railway.Environment",
  EnvironmentProps,
  {
    environmentId: string;
    name: string;
    projectId: string;
    isEphemeral: boolean;
  },
  never,
  Providers
>;

/**
 * A Railway environment — an isolated instance of every service in a
 * project (e.g. `production`, `staging`, per-PR preview environments).
 *
 * @section Creating an Environment
 * @example Basic environment
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const staging = yield* Railway.Environment("staging", { project });
 * ```
 *
 * @example Fork an environment from production
 * ```typescript
 * const staging = yield* Railway.Environment("staging", {
 *   project,
 *   sourceEnvironment: { environmentId: project.defaultEnvironmentId },
 *   skipInitialDeploys: true,
 * });
 * ```
 *
 * @see https://docs.railway.com/reference/environments
 */
export const Environment = Resource<Environment>("Railway.Environment");

export const EnvironmentProvider = () =>
  Provider.succeed(Environment, {
    stables: ["environmentId", "projectId"],
    diff: Effect.fn(function* ({ id, olds = {}, news, output }) {
      if (!isResolved(news)) return undefined;
      const newProjectId = resolveProjectId(news.project as ProjectSource);
      if (output?.projectId && newProjectId !== output.projectId) {
        return { action: "replace" } as const;
      }
      const name = yield* createEnvironmentName(id, news.name);
      const oldName =
        output?.name ?? (yield* createEnvironmentName(id, olds.name));
      if (name !== oldName) {
        return { action: "update" } as const;
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ id, output, olds }) {
      if (output?.environmentId) {
        return yield* getEnvironment({ id: output.environmentId }).pipe(
          Effect.map((env) =>
            // Railway soft-deletes environments — a deleted environment is
            // still returned by getEnvironment with `deletedAt` set.
            env.deletedAt !== null
              ? undefined
              : {
                  ...output,
                  name: env.name,
                  projectId: env.projectId,
                  isEphemeral: env.isEphemeral,
                },
          ),
          Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
        );
      }
      if (!olds?.project) return undefined;
      const projectId = resolveProjectId(olds.project as ProjectSource);
      const name = yield* createEnvironmentName(id, olds.name);
      const match = yield* findEnvironmentByName(projectId, name);
      if (!match) return undefined;
      return {
        environmentId: match.id,
        name: match.name,
        projectId: match.projectId,
        isEphemeral: match.isEphemeral,
      };
    }),
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const name = yield* createEnvironmentName(id, news.name);

      if (output) {
        // Sync — rename if the desired name differs from the observed name.
        const observed = yield* getEnvironment({ id: output.environmentId });
        if (observed.name !== name) {
          yield* renameEnvironment({
            id: output.environmentId,
            input: { name },
          }).pipe(
            // A just-deleted environment can hold the name while its
            // deletion propagates — retry until the name frees up.
            Effect.retry({
              while: (e) => e._tag === "EnvironmentNameConflict",
              schedule: Schedule.spaced("2 seconds"),
              times: 90,
            }),
          );
        }
        return {
          environmentId: output.environmentId,
          name,
          projectId: observed.projectId,
          isEphemeral: observed.isEphemeral,
        };
      }

      const projectId = resolveProjectId(news.project as ProjectSource);
      const created = yield* createEnvironment({
        input: {
          projectId,
          name,
          sourceEnvironmentId: news.sourceEnvironment
            ? resolveEnvironmentId(news.sourceEnvironment as EnvironmentSource)
            : undefined,
          skipInitialDeploys: news.skipInitialDeploys,
          ephemeral: news.ephemeral,
        },
      }).pipe(
        // AlreadyExists race / orphan from a crashed run — adopt the
        // existing environment with that name instead of failing. If the
        // name is held by an environment that is mid-deletion (it no longer
        // shows up in the list), the conflict is transient — retry below.
        Effect.catchTag("EnvironmentNameConflict", (conflict) =>
          findEnvironmentByName(projectId, name).pipe(
            Effect.flatMap((match) =>
              match ? Effect.succeed(match) : Effect.fail(conflict),
            ),
          ),
        ),
        Effect.retry({
          while: (e) => e._tag === "EnvironmentNameConflict",
          schedule: Schedule.spaced("2 seconds"),
          times: 90,
        }),
      );
      return {
        environmentId: created.id,
        name: created.name,
        projectId: created.projectId,
        isEphemeral: created.isEphemeral,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteEnvironment({ id: output.environmentId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
    }),
  });

const createEnvironmentName = (id: string, name: string | undefined) =>
  Effect.gen(function* () {
    return name ?? (yield* createPhysicalName({ id, lowercase: true }));
  });

const findEnvironmentByName = (projectId: string, name: string) =>
  Effect.gen(function* () {
    let after: string | undefined;
    while (true) {
      const page: GetEnvironmentsOutput = yield* getEnvironments({
        projectId,
        first: 100,
        ...(after !== undefined ? { after } : {}),
      });
      // Skip soft-deleted environments — their names are free to reuse.
      const match = page.edges.find(
        (e) => e.node.name === name && e.node.deletedAt === null,
      );
      if (match) return match.node;
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
        return undefined;
      }
      after = page.pageInfo.endCursor;
    }
  });
