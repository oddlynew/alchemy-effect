import type { Octokit } from "@octokit/rest";
import * as Effect from "effect/Effect";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { GitHubCredentials } from "./Credentials.ts";
import { type Environment, environmentName } from "./Environment.ts";
import type * as GitHub from "./Providers.ts";

export interface VariableProps {
  /**
   * Repository owner (user or organization).
   */
  owner: string;

  /**
   * Repository name.
   */
  repository: string;

  /**
   * Variable name (e.g. `AWS_ROLE_ARN`).
   */
  name: string;

  /**
   * Variable value.
   */
  value: string;

  /**
   * Optional environment. When set the variable is scoped to that GitHub
   * Actions environment instead of the whole repository. Accepts either the
   * environment name or a {@link Environment} reference (which also orders
   * the deploy so the environment exists first).
   */
  environment?: string | Environment;
}

export interface Variable extends Resource<
  "GitHub.Variable",
  VariableProps,
  {
    /**
     * ISO-8601 timestamp of the last update.
     */
    updatedAt: string;
  },
  never,
  GitHub.Providers
> {}

/**
 * A GitHub Actions repository variable.
 *
 * `Variable` manages the lifecycle of a plain-text configuration variable
 * in GitHub Actions. Variables are visible in workflow logs and are
 * suitable for non-sensitive configuration like region names, environment
 * labels, or feature flags. For sensitive values, use `GitHub.Secret`
 * instead.
 *
 * Authentication is resolved via the `GitHubCredentials` service supplied
 * by `GitHub.providers()` (which uses the Alchemy AuthProvider — env,
 * stored PAT, `gh` CLI, or OAuth). The token needs `repo` scope for
 * private repositories or `public_repo` for public ones.
 *
 * @section Repository Variables
 * Store variables accessible to all GitHub Actions workflows in the
 * repository.
 *
 * @example Create a Repository Variable
 * ```typescript
 * yield* GitHub.Variable("aws-region", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "AWS_REGION",
 *   value: "us-east-1",
 * });
 * ```
 *
 * @section Wiring with Other Resources
 * Pass output attributes from other resources into GitHub variables so
 * that CI workflows can reference them.
 *
 * @example Store a Worker URL for CI
 * ```typescript
 * const worker = yield* Cloudflare.Worker("Api", { ... });
 *
 * yield* GitHub.Variable("api-url", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "API_URL",
 *   value: worker.url!,
 * });
 * ```
 *
 * @example Multiple Variables
 * ```typescript
 * yield* GitHub.Variable("region", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "AWS_REGION",
 *   value: "us-east-1",
 * });
 *
 * yield* GitHub.Variable("stage", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "DEPLOY_STAGE",
 *   value: "production",
 * });
 * ```
 *
 * @section Environment Variables
 * Scope a variable to a specific GitHub Actions environment (e.g.
 * `production`, `staging`) instead of the whole repository.
 *
 * @example Create an Environment Variable
 * ```typescript
 * yield* GitHub.Variable("deploy-region", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   environment: "production",
 *   name: "AWS_REGION",
 *   value: "us-east-1",
 * });
 * ```
 */
export const Variable = Resource<Variable>("GitHub.Variable");

const getOctokit = Effect.gen(function* () {
  const creds = yield* GitHubCredentials;
  return creds.octokit();
});

// Observe the live value at a location (repo- or environment-scoped). A 404
// collapses to `undefined` so the caller converges by creating it.
const observeVariable = Effect.fn(function* (
  octokit: Octokit,
  props: VariableProps,
  environment: string | undefined,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      try {
        if (environment) {
          const { data } = await octokit.rest.actions.getEnvironmentVariable({
            owner: props.owner,
            repo: props.repository,
            environment_name: environment,
            name: props.name,
          });
          return data.value;
        }
        const { data } = await octokit.rest.actions.getRepoVariable({
          owner: props.owner,
          repo: props.repository,
          name: props.name,
        });
        return data.value;
      } catch (error: any) {
        if (error.status === 404) return undefined;
        throw error;
      }
    },
    catch: (e) => e as Error,
  });
});

const deleteVariable = Effect.fn(function* (
  octokit: Octokit,
  props: VariableProps,
) {
  const environment = environmentName(props.environment);
  yield* Effect.tryPromise(async () => {
    try {
      if (environment) {
        await octokit.rest.actions.deleteEnvironmentVariable({
          owner: props.owner,
          repo: props.repository,
          environment_name: environment,
          name: props.name,
        });
      } else {
        await octokit.rest.actions.deleteRepoVariable({
          owner: props.owner,
          repo: props.repository,
          name: props.name,
        });
      }
    } catch (error: any) {
      if (error.status !== 404) {
        throw error;
      }
    }
  });
});

export const VariableProvider = () =>
  Provider.succeed(Variable, {
    reconcile: Effect.fn(function* ({ news, olds }) {
      const octokit = yield* getOctokit;
      const environment = environmentName(news.environment);

      // If the variable moved between repository and environment scope (or
      // between environments), the old one is orphaned — delete it before
      // converging the new location.
      if (
        olds !== undefined &&
        environmentName(olds.environment) !== environment
      ) {
        yield* deleteVariable(octokit, olds);
      }

      // Observe the live value, then converge: create when absent, PATCH
      // when the value drifted, and skip the call on a no-op.
      const observed = yield* observeVariable(octokit, news, environment);

      if (observed === undefined) {
        if (environment) {
          yield* Effect.tryPromise(() =>
            octokit.rest.actions.createEnvironmentVariable({
              owner: news.owner,
              repo: news.repository,
              environment_name: environment,
              name: news.name,
              value: news.value,
            }),
          );
        } else {
          yield* Effect.tryPromise(() =>
            octokit.rest.actions.createRepoVariable({
              owner: news.owner,
              repo: news.repository,
              name: news.name,
              value: news.value,
            }),
          );
        }
        return { updatedAt: new Date().toISOString() };
      }

      if (observed !== news.value) {
        if (environment) {
          yield* Effect.tryPromise(() =>
            octokit.rest.actions.updateEnvironmentVariable({
              owner: news.owner,
              repo: news.repository,
              environment_name: environment,
              name: news.name,
              value: news.value,
            }),
          );
        } else {
          yield* Effect.tryPromise(() =>
            octokit.rest.actions.updateRepoVariable({
              owner: news.owner,
              repo: news.repository,
              name: news.name,
              value: news.value,
            }),
          );
        }
      }
      return { updatedAt: new Date().toISOString() };
    }),

    delete: Effect.fn(function* ({ olds }) {
      const octokit = yield* getOctokit;
      yield* deleteVariable(octokit, olds);
    }),
  });
