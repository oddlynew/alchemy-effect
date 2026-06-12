import {
  createProjectToken,
  deleteProjectToken,
  getProjectTokens,
  type GetProjectTokensOutput,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
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
import type { Providers } from "./Providers.ts";

export type ProjectTokenProps = {
  /**
   * The Railway project (or `{ projectId }`) the token grants access to.
   * Changing it replaces the token.
   */
  project: ProjectSource;
  /**
   * The environment (or `{ environmentId }`) the token is scoped to.
   * Changing it replaces the token.
   */
  environment: EnvironmentSource;
  /**
   * Token name. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`. Changing it replaces the token.
   */
  name?: string;
};

export type ProjectToken = Resource<
  "Railway.ProjectToken",
  ProjectTokenProps,
  {
    tokenId: string;
    name: string;
    projectId: string;
    environmentId: string;
    /**
     * The token secret. Only returned by the API at creation time —
     * persisted in state so it remains available across deploys.
     */
    token: string;
  },
  never,
  Providers
>;

/**
 * A Railway project token — grants API access scoped to a single project
 * and environment (sent as the `Project-Access-Token` header, or via
 * `RAILWAY_PROJECT_TOKEN` for the Railway CLI). Commonly used in CI to
 * deploy or read variables for one environment.
 *
 * The token secret is only returned by Railway at creation time; Alchemy
 * persists it in state and exposes it as the `token` attribute.
 *
 * @section Creating a Project Token
 * @example Token for the project's default environment
 * ```typescript
 * const project = yield* Railway.Project("my-project");
 * const token = yield* Railway.ProjectToken("ci-token", {
 *   project,
 *   environment: { environmentId: project.defaultEnvironmentId },
 * });
 * // use `token.token` as RAILWAY_PROJECT_TOKEN in CI
 * ```
 *
 * @example Token for a specific environment
 * ```typescript
 * const staging = yield* Railway.Environment("staging", { project });
 * const token = yield* Railway.ProjectToken("staging-token", {
 *   project,
 *   environment: staging,
 *   name: "staging-ci",
 * });
 * ```
 *
 * @see https://docs.railway.com/guides/public-api#authentication
 */
export const ProjectToken = Resource<ProjectToken>("Railway.ProjectToken");

export const ProjectTokenProvider = () =>
  Provider.succeed(ProjectToken, {
    stables: ["tokenId", "name", "projectId", "environmentId", "token"],
    diff: Effect.fn(function* ({ id, news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const projectId = resolveProjectId(news.project as ProjectSource);
        const environmentId = resolveEnvironmentId(
          news.environment as EnvironmentSource,
        );
        const name = yield* createTokenName(id, news.name);
        if (
          projectId !== output.projectId ||
          environmentId !== output.environmentId ||
          name !== output.name
        ) {
          // Tokens have no update API — any change is a replacement.
          return { action: "replace" } as const;
        }
      }
      return undefined;
    }),
    read: Effect.fn(function* ({ output }) {
      if (!output?.tokenId) return undefined;
      const match = yield* findToken(
        output.projectId,
        (t) => t.id === output.tokenId,
      ).pipe(Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)));
      if (!match) return undefined;
      return { ...output, name: match.name };
    }),
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const projectId = resolveProjectId(news.project as ProjectSource);
      const environmentId = resolveEnvironmentId(
        news.environment as EnvironmentSource,
      );
      const name = yield* createTokenName(id, news.name);

      // Observe — does the token still exist? The secret is only returned
      // on create, so an existing token can only be reused when we still
      // have its secret cached in `output`.
      const observed = output?.tokenId
        ? yield* findToken(projectId, (t) => t.id === output.tokenId)
        : undefined;
      if (observed && output) {
        return {
          tokenId: observed.id,
          name: observed.name,
          projectId: observed.projectId,
          environmentId: observed.environmentId,
          token: output.token,
        };
      }

      // Ensure — create the token.
      const token = yield* createProjectToken({
        input: { projectId, environmentId, name },
      });
      const created = yield* findToken(
        projectId,
        (t) =>
          t.name === name &&
          t.environmentId === environmentId &&
          t.id !== output?.tokenId,
      );
      if (!created) {
        return yield* Effect.die(
          `Railway project token ${name} not found after creation`,
        );
      }
      return {
        tokenId: created.id,
        name: created.name,
        projectId: created.projectId,
        environmentId: created.environmentId,
        token,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteProjectToken({ id: output.tokenId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
    }),
  });

const createTokenName = (id: string, name: string | undefined) =>
  Effect.gen(function* () {
    return name ?? (yield* createPhysicalName({ id, lowercase: true }));
  });

type ProjectTokenNode = GetProjectTokensOutput["edges"][number]["node"];

const findToken = (
  projectId: string,
  predicate: (token: ProjectTokenNode) => boolean,
) =>
  Effect.gen(function* () {
    let after: string | undefined;
    while (true) {
      const page: GetProjectTokensOutput = yield* getProjectTokens({
        projectId,
        first: 100,
        ...(after !== undefined ? { after } : {}),
      });
      const match = page.edges.find((e) => predicate(e.node));
      if (match) return match.node;
      if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
        return undefined;
      }
      after = page.pageInfo.endCursor;
    }
  });
