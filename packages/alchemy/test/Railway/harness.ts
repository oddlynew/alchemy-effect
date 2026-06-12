import {
  createProject,
  getEnvironments,
  getProjects,
  type GetProjectsOutput,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

/**
 * Railway rate-limits project creation to 1 per 30s per workspace (and
 * failed attempts re-arm the window), so the test suite must NOT create a
 * project per file/run. Instead every test file (except Project.test.ts,
 * which tests the project lifecycle itself) shares one persistent project,
 * found by deterministic name or created at most once, and never destroyed.
 *
 * Tests reference it as `project: { projectId }` so `stack.destroy()` only
 * tears down the resources the test itself created inside the project.
 */
export const SHARED_PROJECT_NAME = "alchemy-railway-shared-test";

let cached: { projectId: string; environmentId: string } | undefined;

const findProjectByName = (name: string) =>
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

const baseEnvironmentId = (projectId: string) =>
  Effect.gen(function* () {
    const page = yield* getEnvironments({ projectId, first: 100 }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced("2 seconds"),
        until: (page) => page.edges.length > 0,
        times: 30,
      }),
    );
    const nodes = page.edges.map((e) => e.node);
    const env =
      nodes.find((n) => n.name === "production") ??
      nodes.find((n) => !n.isEphemeral) ??
      nodes[0];
    if (!env) {
      return yield* Effect.die(
        `Shared test project ${projectId} has no environments`,
      );
    }
    return env.id;
  });

/**
 * Find-or-create the shared test project. Cached per process so a test
 * file only pays one lookup.
 */
export const ensureSharedProject = Effect.gen(function* () {
  if (cached) return cached;
  const existing = yield* findProjectByName(SHARED_PROJECT_NAME);
  if (existing) {
    cached = {
      projectId: existing.id,
      environmentId: yield* baseEnvironmentId(existing.id),
    };
    return cached;
  }
  yield* Effect.log(
    `Shared test project '${SHARED_PROJECT_NAME}' not found — creating (Railway allows 1 project create per 30s)...`,
  );
  const created = yield* createProject({
    input: { name: SHARED_PROJECT_NAME },
  }).pipe(
    Effect.tapError((e) =>
      e._tag === "ProjectCreateRateLimited"
        ? Effect.log("Rate limited — retrying in ~35s...")
        : Effect.void,
    ),
    Effect.retry({
      while: (e) => e._tag === "ProjectCreateRateLimited",
      schedule: Schedule.jittered(Schedule.spaced("35 seconds")),
      times: 20,
    }),
  );
  cached = {
    projectId: created.id,
    environmentId: yield* baseEnvironmentId(created.id),
  };
  return cached;
});
