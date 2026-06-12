import {
  createProject,
  deleteProject,
  getEnvironments,
  getProject,
  getProjects,
  type GetProjectsOutput,
  updateProject,
} from "@distilled.cloud/railway";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import type { Providers } from "./Providers.ts";

export type ProjectProps = {
  /**
   * Name of the project. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`.
   */
  name?: string;
  /**
   * Description of the project.
   */
  description?: string;
  /**
   * Name of the default environment created with the project.
   * Cannot be changed after creation.
   *
   * @default "production"
   */
  defaultEnvironmentName?: string;
  /**
   * Whether the project is publicly visible.
   *
   * @default false
   */
  isPublic?: boolean;
  /**
   * Whether PR deploys (preview environments for pull requests) are
   * enabled on the project.
   *
   * @default false
   */
  prDeploys?: boolean;
  /**
   * Railway workspace ID to create the project in. Defaults to the
   * token's workspace. Cannot be changed after creation.
   */
  workspaceId?: string;
};

export type Project = Resource<
  "Railway.Project",
  ProjectProps,
  {
    projectId: string;
    name: string;
    description: string | undefined;
    /** ID of the project's default (base) environment. */
    defaultEnvironmentId: string;
    /** Name of the project's default (base) environment. */
    defaultEnvironmentName: string;
    workspaceId: string | undefined;
    isPublic: boolean;
    prDeploys: boolean;
  },
  never,
  Providers
>;

/**
 * A Railway project — the top-level container for environments, services
 * and volumes.
 *
 * Creating a project also provisions its default environment (named
 * `production` by default), exposed as `defaultEnvironmentId`.
 *
 * @section Creating a Project
 * @example Basic project
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * ```
 *
 * @example Project with explicit name and description
 * ```typescript
 * const project = yield* Railway.Project("my-project", {
 *   name: "my-app",
 *   description: "My production application",
 * });
 * ```
 *
 * @section Environments
 * @example Use the default environment
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const service = yield* Railway.Service("api", {
 *   project,
 *   source: { image: "nginx:alpine" },
 * });
 * ```
 *
 * @see https://docs.railway.com/reference/projects
 */
export const Project = Resource<Project>("Railway.Project");

export const ProjectProvider = () =>
  Provider.succeed(Project, {
    stables: ["projectId", "defaultEnvironmentId", "workspaceId"],
    diff: Effect.fn(function* ({ id, olds = {}, news = {}, output }) {
      if (!isResolved(news)) return undefined;
      if (
        news.workspaceId !== undefined &&
        output?.workspaceId !== undefined &&
        news.workspaceId !== output.workspaceId
      ) {
        return { action: "replace" } as const;
      }
      if (
        news.defaultEnvironmentName !== undefined &&
        output?.defaultEnvironmentName !== undefined &&
        news.defaultEnvironmentName !== output.defaultEnvironmentName
      ) {
        return { action: "replace" } as const;
      }
      const name = yield* createProjectName(id, news.name);
      const oldName = output?.name ?? (yield* createProjectName(id, olds.name));
      if (
        name !== oldName ||
        (news.description ?? undefined) !==
          (output?.description ?? undefined) ||
        (news.isPublic ?? false) !== (output?.isPublic ?? false) ||
        (news.prDeploys ?? false) !== (output?.prDeploys ?? false)
      ) {
        return { action: "update" } as const;
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ id, output, olds }) {
      if (output?.projectId) {
        return yield* getProject({ id: output.projectId }).pipe(
          Effect.map((project) => ({
            ...output,
            name: project.name,
            description: project.description ?? undefined,
            isPublic: project.isPublic,
            prDeploys: project.prDeploys,
            workspaceId: project.workspaceId ?? undefined,
          })),
          Effect.catchTags({
            ProjectNotFound: () => Effect.succeed(undefined),
            // Railway returns Not Authorized for deleted/foreign projects.
            NotAuthorized: () => Effect.succeed(undefined),
          }),
        );
      }
      const name = yield* createProjectName(id, olds?.name);
      const match = yield* findProjectByName(name);
      if (!match) return undefined;
      const project = yield* getProject({ id: match.id }).pipe(
        Effect.catchTags({
          ProjectNotFound: () => Effect.succeed(undefined),
          NotAuthorized: () => Effect.succeed(undefined),
        }),
      );
      if (!project) return undefined;
      const baseEnv = yield* resolveDefaultEnvironment(
        project.id,
        olds?.defaultEnvironmentName,
      );
      return {
        projectId: project.id,
        name: project.name,
        description: project.description ?? undefined,
        defaultEnvironmentId: baseEnv.id,
        defaultEnvironmentName: baseEnv.name,
        workspaceId: project.workspaceId ?? undefined,
        isPublic: project.isPublic,
        prDeploys: project.prDeploys,
      };
    }),
    reconcile: Effect.fn(function* ({ id, news = {}, output, session }) {
      const name = yield* createProjectName(id, news.name);

      if (output) {
        // Sync mutable scalar fields on the existing project.
        const updated = yield* updateProject({
          id: output.projectId,
          input: {
            name,
            description: news.description ?? null,
            isPublic: news.isPublic,
            prDeploys: news.prDeploys,
          },
        });
        return {
          ...output,
          name: updated.name,
          description: updated.description ?? undefined,
          isPublic: updated.isPublic,
          prDeploys: updated.prDeploys,
        };
      }

      // Railway rate-limits project creation (1 per 30s per workspace) —
      // serialize local deployers through a host-wide lock, then retry the
      // typed throttling error until the window opens.
      yield* session.note(`Creating project '${name}'...`);
      const created = yield* withProjectCreateLock(
        createProject({
          input: {
            name,
            description: news.description,
            defaultEnvironmentName: news.defaultEnvironmentName,
            isPublic: news.isPublic,
            prDeploys: news.prDeploys,
            workspaceId: news.workspaceId,
          },
        }).pipe(
          Effect.tapError((e) =>
            e._tag === "ProjectCreateRateLimited"
              ? session.note(
                  "Rate limited (Railway allows 1 project create per 30s per workspace) — retrying in ~35s...",
                )
              : Effect.void,
          ),
          Effect.retry({
            while: (e) => e._tag === "ProjectCreateRateLimited",
            // Failed attempts count against the rate window, so wait longer
            // than the 30s window between attempts. Jitter desynchronizes
            // remote deployers competing for the same window.
            schedule: Schedule.jittered(Schedule.spaced("35 seconds")),
            times: 20,
          }),
        ),
        (waitedMillis) =>
          session.note(
            `Waiting for host-wide project-create lock (held by another deploy, ${Math.round(waitedMillis / 1000)}s)...`,
          ),
      );
      // The default environment is provisioned asynchronously — poll until
      // it appears. Railway does not reliably populate `baseEnvironmentId`
      // for API-created projects, so fall back to listing environments.
      yield* session.note(
        `Project ${created.id} created — waiting for default environment...`,
      );
      const baseEnv = yield* resolveDefaultEnvironment(
        created.id,
        news.defaultEnvironmentName,
      );
      return {
        projectId: created.id,
        name: created.name,
        description: created.description ?? undefined,
        defaultEnvironmentId: baseEnv.id,
        defaultEnvironmentName: baseEnv.name,
        workspaceId: created.workspaceId ?? undefined,
        isPublic: created.isPublic,
        prDeploys: created.prDeploys,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteProject({ id: output.projectId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
    }),
  });

export class DefaultEnvironmentNotFound extends Data.TaggedError(
  "DefaultEnvironmentNotFound",
)<{ projectId: string }> {}

class ProjectCreateLockBusy extends Data.TaggedError(
  "ProjectCreateLockBusy",
)<{}> {}

/**
 * Railway's create rate limit (1 project per 30s) is workspace-wide and
 * failed attempts count against the window, so concurrent deployers on the
 * same host (e.g. parallel test runs) livelock each other when they retry
 * independently. Serialize project creation through a host-wide directory
 * lock so at most one local process competes for the window at a time.
 */
const PROJECT_CREATE_LOCK_DIR = "/tmp/alchemy-railway-project-create.lock";
/**
 * Steal locks left behind by crashed processes after this long. A create
 * normally holds the lock for well under a minute (one create + rate-limit
 * retries), so anything older is presumed dead.
 */
const PROJECT_CREATE_LOCK_STALE_MILLIS = 2 * 60 * 1000;

const withProjectCreateLock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  onWait?: (waitedMillis: number) => Effect.Effect<void>,
): Effect.Effect<A, E | ProjectCreateLockBusy, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const startedAt = yield* Effect.sync(() => Date.now());
    const tryAcquire = Effect.gen(function* () {
      const acquired = yield* fs.makeDirectory(PROJECT_CREATE_LOCK_DIR).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      if (acquired) return;
      // Steal the lock if its holder appears to have crashed.
      const stat = yield* fs.stat(PROJECT_CREATE_LOCK_DIR).pipe(Effect.option);
      const mtime = Option.flatMap(stat, (s) => s.mtime);
      const now = yield* Effect.sync(() => Date.now());
      if (
        Option.isSome(mtime) &&
        now - mtime.value.getTime() > PROJECT_CREATE_LOCK_STALE_MILLIS
      ) {
        yield* fs
          .remove(PROJECT_CREATE_LOCK_DIR, { recursive: true })
          .pipe(Effect.ignore);
      }
      if (onWait) yield* onWait(now - startedAt);
      return yield* Effect.fail(new ProjectCreateLockBusy());
    });
    yield* tryAcquire.pipe(
      Effect.retry({
        while: (e) => e._tag === "ProjectCreateLockBusy",
        schedule: Schedule.spaced("5 seconds"),
        times: 240,
      }),
    );
    return yield* effect.pipe(
      Effect.ensuring(
        fs
          .remove(PROJECT_CREATE_LOCK_DIR, { recursive: true })
          .pipe(Effect.ignore),
      ),
    );
  });

/**
 * Resolve a project's default environment. Railway does not reliably set
 * `baseEnvironmentId` on API-created projects, so prefer it when present
 * but fall back to listing the project's environments — picking the one
 * matching `preferredName` (default `production`), else the first
 * non-ephemeral environment. Polls briefly because the default environment
 * is provisioned asynchronously after project creation.
 */
export const resolveDefaultEnvironment = (
  projectId: string,
  preferredName?: string,
) =>
  Effect.gen(function* () {
    const lookup = Effect.gen(function* () {
      const project = yield* getProject({ id: projectId });
      const baseEnvId =
        project.baseEnvironmentId ?? project.baseEnvironment?.id;
      if (baseEnvId) {
        return {
          id: baseEnvId,
          name: project.baseEnvironment?.name ?? preferredName ?? "production",
        };
      }
      const page = yield* getEnvironments({ projectId, first: 100 });
      const nodes = page.edges.map((e) => e.node);
      const match =
        nodes.find((n) => n.name === (preferredName ?? "production")) ??
        nodes.find((n) => !n.isEphemeral) ??
        nodes[0];
      return match ? { id: match.id, name: match.name } : undefined;
    });
    const env = yield* lookup.pipe(
      // Read-after-write: a freshly created project may briefly 404 (or
      // surface as Not Authorized) until it is visible to reads.
      Effect.retry({
        while: (e) =>
          e._tag === "ProjectNotFound" || e._tag === "NotAuthorized",
        schedule: Schedule.spaced("2 seconds"),
        times: 30,
      }),
      Effect.repeat({
        schedule: Schedule.spaced("2 seconds"),
        until: (e) => e !== undefined,
        times: 30,
      }),
    );
    if (!env) {
      return yield* new DefaultEnvironmentNotFound({ projectId });
    }
    return env;
  });

const createProjectName = (id: string, name: string | undefined) =>
  Effect.gen(function* () {
    return name ?? (yield* createPhysicalName({ id, lowercase: true }));
  });

/**
 * Find a project by exact name, paging through the workspace's projects.
 */
export const findProjectByName = (name: string) =>
  Effect.gen(function* () {
    let after: string | undefined;
    while (true) {
      const page: GetProjectsOutput = yield* getProjects({
        first: 100,
        ...(after !== undefined ? { after } : {}),
      });
      const match = page.edges.find((e) => e.node.name === name);
      if (match) return match.node;
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
        return undefined;
      }
      after = page.pageInfo.endCursor;
    }
  });
