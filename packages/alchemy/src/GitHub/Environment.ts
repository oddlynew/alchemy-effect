import type { Octokit } from "@octokit/rest";
import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { GitHubCredentials } from "./Credentials.ts";
import type * as GitHub from "./Providers.ts";

export interface EnvironmentProps {
  /**
   * Repository owner (user or organization).
   */
  owner: string;

  /**
   * Repository name.
   */
  repository: string;

  /**
   * Environment name (e.g. `production`, `staging`). This is the name
   * workflows reference via `environment:` and the path identifier GitHub
   * uses for the environment. Changing it replaces the environment.
   */
  name: string;

  /**
   * Wait timer (in minutes) before deployments to this environment are
   * allowed to proceed. Must be between 0 and 43200 (30 days).
   * @default 0
   */
  waitTimer?: number;

  /**
   * Prevent users from approving their own deployments. Requires at least
   * one reviewer when enabled.
   * @default false
   */
  preventSelfReview?: boolean;

  /**
   * Required reviewers for deployments to this environment.
   */
  reviewers?: {
    /**
     * GitHub usernames or numeric user IDs that may approve deployments.
     * String usernames are resolved to IDs.
     */
    users?: Array<number | string>;

    /**
     * GitHub team slugs or numeric team IDs that may approve deployments.
     * String team slugs are resolved to IDs; use `org/team-slug` to target
     * a team in another organization.
     */
    teams?: Array<number | string>;
  };

  /**
   * Deployment branch policy for the environment.
   */
  deploymentBranchPolicy?: {
    /**
     * Restrict deployments to branches with branch protection rules.
     * @default false
     */
    protectedBranches?: boolean;

    /**
     * Allow custom branch name patterns (configured via `branchPatterns`).
     * @default false
     */
    customBranchPolicies?: boolean;
  };

  /**
   * Branch name patterns allowed to deploy when
   * `deploymentBranchPolicy.customBranchPolicies` is `true`, e.g.
   * `["main", "release/*"]`. The resource is authoritative over these
   * patterns — patterns it didn't create are removed on reconcile.
   * @default []
   */
  branchPatterns?: string[];
}

export interface Environment extends Resource<
  "GitHub.Environment",
  EnvironmentProps,
  {
    /**
     * The numeric ID GitHub assigns to the environment.
     */
    environmentId: number;

    /**
     * Environment name.
     */
    name: string;

    /**
     * URL to view the environment in a browser.
     */
    htmlUrl: string;

    /**
     * ISO-8601 timestamp at which the environment was created.
     */
    createdAt: string;

    /**
     * ISO-8601 timestamp of the last update.
     */
    updatedAt: string;
  },
  never,
  GitHub.Providers
> {}

/**
 * A GitHub Actions deployment environment.
 *
 * `Environment` manages the lifecycle of a repository environment along with
 * its protection rules — wait timers, required reviewers, and deployment
 * branch policies. Environments gate GitHub Actions deployments and scope
 * environment-level secrets and variables.
 *
 * Authentication is resolved via the `GitHubCredentials` service supplied by
 * `GitHub.providers()` (which uses the Alchemy AuthProvider — env, stored
 * PAT, `gh` CLI, or OAuth). The token needs `repo` scope and admin rights on
 * the repository.
 *
 * @section Creating Environments
 * @example A Basic Environment
 * ```typescript
 * const env = yield* GitHub.Environment("staging", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "staging",
 * });
 * ```
 *
 * @example A Protected Production Environment
 * ```typescript
 * const prod = yield* GitHub.Environment("production", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "production",
 *   waitTimer: 10,
 *   preventSelfReview: true,
 *   reviewers: {
 *     teams: ["platform-team"],
 *     users: ["security-admin"],
 *   },
 *   deploymentBranchPolicy: {
 *     protectedBranches: true,
 *     customBranchPolicies: false,
 *   },
 * });
 * ```
 *
 * @example Custom Branch Patterns
 * ```typescript
 * yield* GitHub.Environment("release", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "release",
 *   deploymentBranchPolicy: {
 *     customBranchPolicies: true,
 *   },
 *   branchPatterns: ["main", "release/*"],
 * });
 * ```
 *
 * @section Scoping Secrets and Variables
 * Pass the environment (or its name) to `GitHub.Secret` / `GitHub.Variable`
 * via their `environment` prop to scope the value to this environment. Passing
 * the resource also orders the deploy so the environment exists first.
 *
 * @example Environment-scoped Secret and Variable
 * ```typescript
 * const prod = yield* GitHub.Environment("production", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   name: "production",
 * });
 *
 * yield* GitHub.Secret("deploy-key", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   environment: prod,
 *   name: "DEPLOY_KEY",
 *   value: Redacted.make("my-secret-value"),
 * });
 *
 * yield* GitHub.Variable("deploy-region", {
 *   owner: "my-org",
 *   repository: "my-repo",
 *   environment: prod,
 *   name: "AWS_REGION",
 *   value: "us-east-1",
 * });
 * ```
 */
export const Environment = Resource<Environment>("GitHub.Environment");

/**
 * Normalize an `environment` prop — either a name string or an
 * {@link Environment} reference — down to the environment name (or
 * `undefined` when unset). At runtime an `Environment` reference is resolved
 * to its attributes, so `.name` is the plain environment-name string.
 * @internal
 */
export const environmentName = (
  environment: string | Environment | undefined,
): string | undefined =>
  environment === undefined
    ? undefined
    : typeof environment === "string"
      ? environment
      : (environment as unknown as { name: string }).name;

const getOctokit = Effect.gen(function* () {
  const creds = yield* GitHubCredentials;
  return creds.octokit();
});

/**
 * Resolve mixed username/team-slug reviewers to the `{ type, id }` shape the
 * GitHub API expects. Numeric entries are used directly; string entries are
 * looked up (usernames via `getByUsername`, teams via `getByName`).
 */
const resolveReviewers = Effect.fn(function* (
  octokit: Octokit,
  owner: string,
  reviewers: EnvironmentProps["reviewers"],
) {
  const resolved: { type: "User" | "Team"; id: number }[] = [];

  for (const user of reviewers?.users ?? []) {
    if (typeof user === "number") {
      resolved.push({ type: "User", id: user });
    } else {
      const { data } = yield* Effect.tryPromise(() =>
        octokit.rest.users.getByUsername({ username: user }),
      );
      resolved.push({ type: "User", id: data.id });
    }
  }

  for (const team of reviewers?.teams ?? []) {
    if (typeof team === "number") {
      resolved.push({ type: "Team", id: team });
    } else {
      const [org, teamSlug] = team.includes("/")
        ? team.split("/")
        : [owner, team];
      const { data } = yield* Effect.tryPromise(() =>
        octokit.rest.teams.getByName({ org, team_slug: teamSlug }),
      );
      resolved.push({ type: "Team", id: data.id });
    }
  }

  return resolved;
});

/**
 * Converge the environment's custom deployment branch policies to the desired
 * set of patterns. Treats the resource as authoritative — adds missing
 * patterns and removes ones it no longer wants.
 */
const syncBranchPatterns = Effect.fn(function* (
  octokit: Octokit,
  props: EnvironmentProps,
) {
  const desired = props.branchPatterns ?? [];

  const { data: existing } = yield* Effect.tryPromise(() =>
    octokit.rest.repos.listDeploymentBranchPolicies({
      owner: props.owner,
      repo: props.repository,
      environment_name: props.name,
    }),
  );

  const observed = existing.branch_policies;
  const observedNames = observed.map((policy) => policy.name ?? "");

  for (const pattern of desired) {
    if (!observedNames.includes(pattern)) {
      yield* Effect.tryPromise(() =>
        octokit.rest.repos.createDeploymentBranchPolicy({
          owner: props.owner,
          repo: props.repository,
          environment_name: props.name,
          name: pattern,
        }),
      );
    }
  }

  for (const policy of observed) {
    if (policy.id !== undefined && !desired.includes(policy.name ?? "")) {
      yield* Effect.tryPromise(() =>
        octokit.rest.repos.deleteDeploymentBranchPolicy({
          owner: props.owner,
          repo: props.repository,
          environment_name: props.name,
          branch_policy_id: policy.id!,
        }),
      );
    }
  }
});

export const EnvironmentProvider = () =>
  Provider.succeed(Environment, {
    stables: ["environmentId", "name", "createdAt"],

    // Replace (rather than update in place) when the path identifiers change,
    // since GitHub keys environments by owner/repo/name.
    diff: Effect.fn(function* ({ olds, news }) {
      if (!isResolved(news)) return;
      if (
        olds.owner !== news.owner ||
        olds.repository !== news.repository ||
        olds.name !== news.name
      ) {
        return { action: "replace" } as const;
      }
    }),

    read: Effect.fn(function* ({ olds, output }) {
      const octokit = yield* getOctokit;
      const name = output?.name ?? olds.name;
      const observed = yield* Effect.tryPromise({
        try: async () => {
          try {
            const { data } = await octokit.rest.repos.getEnvironment({
              owner: olds.owner,
              repo: olds.repository,
              environment_name: name,
            });
            return data;
          } catch (error: any) {
            if (error.status === 404) return undefined;
            throw error;
          }
        },
        catch: (e) => e as Error,
      });
      if (observed === undefined) return undefined;
      return {
        environmentId: observed.id,
        name: observed.name,
        htmlUrl: observed.html_url,
        createdAt: observed.created_at,
        updatedAt: observed.updated_at,
      };
    }),

    reconcile: Effect.fn(function* ({ news }) {
      const octokit = yield* getOctokit;

      const reviewers = yield* resolveReviewers(
        octokit,
        news.owner,
        news.reviewers,
      );

      // Ensure & Sync — `createOrUpdateEnvironment` (PUT) is upsert-style: it
      // creates the environment when absent and overwrites its protection
      // rules when present, so a single call converges both create and
      // update paths.
      yield* Effect.tryPromise(() =>
        octokit.rest.repos.createOrUpdateEnvironment({
          owner: news.owner,
          repo: news.repository,
          environment_name: news.name,
          wait_timer: news.waitTimer,
          prevent_self_review: news.preventSelfReview,
          reviewers: reviewers.length > 0 ? reviewers : null,
          deployment_branch_policy: news.deploymentBranchPolicy
            ? {
                protected_branches:
                  news.deploymentBranchPolicy.protectedBranches ?? false,
                custom_branch_policies:
                  news.deploymentBranchPolicy.customBranchPolicies ?? false,
              }
            : null,
        }),
      );

      // Sync custom branch patterns only when custom policies are enabled;
      // GitHub rejects the branch-policy endpoints otherwise.
      if (news.deploymentBranchPolicy?.customBranchPolicies === true) {
        yield* syncBranchPatterns(octokit, news);
      }

      const { data } = yield* Effect.tryPromise(() =>
        octokit.rest.repos.getEnvironment({
          owner: news.owner,
          repo: news.repository,
          environment_name: news.name,
        }),
      );

      return {
        environmentId: data.id,
        name: data.name,
        htmlUrl: data.html_url,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }),

    delete: Effect.fn(function* ({ olds }) {
      const octokit = yield* getOctokit;
      yield* Effect.tryPromise(async () => {
        try {
          await octokit.rest.repos.deleteAnEnvironment({
            owner: olds.owner,
            repo: olds.repository,
            environment_name: olds.name,
          });
        } catch (error: any) {
          if (error.status !== 404) {
            throw error;
          }
        }
      });
    }),
  });
