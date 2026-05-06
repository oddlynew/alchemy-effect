import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeOctokit } from "./Octokit.ts";
import type { RepoRef } from "./Webhooks.ts";

/**
 * Runtime-side GitHub capabilities. Each capability is a `Context.Service`
 * grouped to mirror Octokit's REST namespaces (`octokit.rest.issues`,
 * `octokit.rest.pulls`, `octokit.rest.git`, etc.) and the verbs they
 * expose. All methods accept a {@link RepoRef} as the first argument so
 * the caller doesn't repeat owner/name on every call.
 *
 * Provided by {@link CapabilitiesLive}, which depends on a
 * {@link RuntimeOctokit} layer (see `Octokit.ts`).
 */

const ownerName = (repo: RepoRef) => ({
  owner: repo.owner,
  repo: repo.name,
});

// ---------------------------------------------------------------------------
// IssueComments — covers comments on issues AND on pull-request conversations.
//   Octokit: octokit.rest.issues.{listComments, createComment,
//                                  updateComment, deleteComment}
// ---------------------------------------------------------------------------

export interface IssueCommentsService {
  list(
    repo: RepoRef,
    args: { issueNumber: number; since?: string },
  ): Effect.Effect<
    Array<{ id: number; body: string | null; user: { login: string } | null }>
  >;
  create(
    repo: RepoRef,
    args: { issueNumber: number; body: string },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
  update(
    repo: RepoRef,
    args: { commentId: number; body: string },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
  delete(repo: RepoRef, args: { commentId: number }): Effect.Effect<void>;
}

export class IssueComments extends Context.Service<
  IssueComments,
  IssueCommentsService
>()("GitHub.IssueComments") {}

// ---------------------------------------------------------------------------
// PullRequestReviewComments — inline review thread comments on a PR.
//   Octokit: octokit.rest.pulls.{listReviewComments, createReviewComment,
//                                updateReviewComment, deleteReviewComment,
//                                createReplyForReviewComment}
// ---------------------------------------------------------------------------

export interface PullRequestReviewCommentsService {
  create(
    repo: RepoRef,
    args: {
      prNumber: number;
      body: string;
      commitId: string;
      path: string;
      line: number;
      side?: "LEFT" | "RIGHT";
    },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
  update(
    repo: RepoRef,
    args: { commentId: number; body: string },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
  delete(repo: RepoRef, args: { commentId: number }): Effect.Effect<void>;
  reply(
    repo: RepoRef,
    args: { prNumber: number; commentId: number; body: string },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
}

export class PullRequestReviewComments extends Context.Service<
  PullRequestReviewComments,
  PullRequestReviewCommentsService
>()("GitHub.PullRequestReviewComments") {}

// ---------------------------------------------------------------------------
// PullRequestReviews — submitting and dismissing reviews on a PR.
//   Octokit: octokit.rest.pulls.{createReview, dismissReview,
//                                requestReviewers, removeRequestedReviewers}
// ---------------------------------------------------------------------------

export interface PullRequestReviewsService {
  create(
    repo: RepoRef,
    args: {
      prNumber: number;
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      commitId?: string;
    },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
  dismiss(
    repo: RepoRef,
    args: { prNumber: number; reviewId: number; message: string },
  ): Effect.Effect<void>;
  requestReviewers(
    repo: RepoRef,
    args: { prNumber: number; reviewers?: string[]; teamReviewers?: string[] },
  ): Effect.Effect<void>;
}

export class PullRequestReviews extends Context.Service<
  PullRequestReviews,
  PullRequestReviewsService
>()("GitHub.PullRequestReviews") {}

// ---------------------------------------------------------------------------
// PullRequests — managing pull requests themselves.
//   Octokit: octokit.rest.pulls.{create, update, merge, listFiles}
// ---------------------------------------------------------------------------

export interface PullRequestsService {
  create(
    repo: RepoRef,
    args: {
      head: string;
      base: string;
      title: string;
      body?: string;
      draft?: boolean;
    },
  ): Effect.Effect<{ number: number; htmlUrl: string }>;
  update(
    repo: RepoRef,
    args: {
      prNumber: number;
      title?: string;
      body?: string;
      state?: "open" | "closed";
      base?: string;
    },
  ): Effect.Effect<{ number: number; htmlUrl: string }>;
  merge(
    repo: RepoRef,
    args: {
      prNumber: number;
      mergeMethod?: "merge" | "squash" | "rebase";
      commitTitle?: string;
      commitMessage?: string;
    },
  ): Effect.Effect<{ sha: string; merged: boolean }>;
}

export class PullRequests extends Context.Service<
  PullRequests,
  PullRequestsService
>()("GitHub.PullRequests") {}

// ---------------------------------------------------------------------------
// Git — low-level git database (refs, blobs, trees, commits, tags).
//   Octokit: octokit.rest.git.{getRef, createRef, updateRef, deleteRef,
//                              createBlob, createTree, createCommit,
//                              getCommit, getTree, getBlob}
// ---------------------------------------------------------------------------

export interface GitService {
  getRef(
    repo: RepoRef,
    args: { ref: string },
  ): Effect.Effect<{ ref: string; sha: string }>;
  createRef(
    repo: RepoRef,
    args: { ref: string; sha: string },
  ): Effect.Effect<{ ref: string; sha: string }>;
  updateRef(
    repo: RepoRef,
    args: { ref: string; sha: string; force?: boolean },
  ): Effect.Effect<{ ref: string; sha: string }>;
  deleteRef(repo: RepoRef, args: { ref: string }): Effect.Effect<void>;
  createBlob(
    repo: RepoRef,
    args: { content: string; encoding?: "utf-8" | "base64" },
  ): Effect.Effect<{ sha: string }>;
  createTree(
    repo: RepoRef,
    args: {
      baseTree?: string;
      tree: Array<{
        path: string;
        mode: "100644" | "100755" | "040000" | "160000" | "120000";
        type: "blob" | "tree" | "commit";
        sha?: string;
        content?: string;
      }>;
    },
  ): Effect.Effect<{ sha: string }>;
  createCommit(
    repo: RepoRef,
    args: {
      message: string;
      tree: string;
      parents: string[];
      author?: { name: string; email: string; date?: string };
    },
  ): Effect.Effect<{ sha: string }>;
}

export class Git extends Context.Service<Git, GitService>()("GitHub.Git") {}

// ---------------------------------------------------------------------------
// Contents — repository file API (single-file create/update/delete).
//   Octokit: octokit.rest.repos.{getContent, createOrUpdateFileContents,
//                                deleteFile}
// ---------------------------------------------------------------------------

export interface ContentsService {
  get(
    repo: RepoRef,
    args: { path: string; ref?: string },
  ): Effect.Effect<
    | {
        sha: string;
        content: string;
        encoding: string;
      }
    | undefined
  >;
  put(
    repo: RepoRef,
    args: {
      path: string;
      message: string;
      content: string; // utf-8; will be base64-encoded internally
      branch?: string;
      sha?: string; // required to update an existing file
    },
  ): Effect.Effect<{ sha: string; commitSha: string }>;
  delete(
    repo: RepoRef,
    args: { path: string; message: string; sha: string; branch?: string },
  ): Effect.Effect<{ commitSha: string }>;
}

export class Contents extends Context.Service<Contents, ContentsService>()(
  "GitHub.Contents",
) {}

// ---------------------------------------------------------------------------
// CommitStatuses — coarse green/red commit status indicators.
//   Octokit: octokit.rest.repos.{createCommitStatus,
//                                listCommitStatusesForRef}
// ---------------------------------------------------------------------------

export interface CommitStatusesService {
  create(
    repo: RepoRef,
    args: {
      sha: string;
      state: "error" | "failure" | "pending" | "success";
      context?: string;
      description?: string;
      targetUrl?: string;
    },
  ): Effect.Effect<{ id: number; url: string }>;
}

export class CommitStatuses extends Context.Service<
  CommitStatuses,
  CommitStatusesService
>()("GitHub.CommitStatuses") {}

// ---------------------------------------------------------------------------
// CheckRuns — richer status with annotations and rerun support.
//   Octokit: octokit.rest.checks.{create, update, listForRef}
// ---------------------------------------------------------------------------

export interface CheckRunsService {
  create(
    repo: RepoRef,
    args: {
      name: string;
      headSha: string;
      status?: "queued" | "in_progress" | "completed";
      conclusion?:
        | "success"
        | "failure"
        | "neutral"
        | "cancelled"
        | "skipped"
        | "timed_out"
        | "action_required";
      detailsUrl?: string;
      output?: { title: string; summary: string; text?: string };
    },
  ): Effect.Effect<{ id: number; htmlUrl: string }>;
  update(
    repo: RepoRef,
    args: {
      checkRunId: number;
      status?: "queued" | "in_progress" | "completed";
      conclusion?:
        | "success"
        | "failure"
        | "neutral"
        | "cancelled"
        | "skipped"
        | "timed_out"
        | "action_required";
      output?: { title: string; summary: string; text?: string };
    },
  ): Effect.Effect<void>;
}

export class CheckRuns extends Context.Service<CheckRuns, CheckRunsService>()(
  "GitHub.CheckRuns",
) {}

// ---------------------------------------------------------------------------
// Reactions — quick emoji reactions on issues, comments, reviews.
//   Octokit: octokit.rest.reactions.{*}
// ---------------------------------------------------------------------------

export type ReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "confused"
  | "heart"
  | "hooray"
  | "rocket"
  | "eyes";

export interface ReactionsService {
  forIssue(
    repo: RepoRef,
    args: { issueNumber: number; content: ReactionContent },
  ): Effect.Effect<{ id: number }>;
  forIssueComment(
    repo: RepoRef,
    args: { commentId: number; content: ReactionContent },
  ): Effect.Effect<{ id: number }>;
  forReview(
    repo: RepoRef,
    args: { prNumber: number; reviewId: number; content: ReactionContent },
  ): Effect.Effect<{ id: number }>;
}

export class Reactions extends Context.Service<Reactions, ReactionsService>()(
  "GitHub.Reactions",
) {}

// ---------------------------------------------------------------------------
// Live layer — provides every capability above on top of `RuntimeOctokit`.
// ---------------------------------------------------------------------------

const tryRest = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => e as Error,
  }).pipe(Effect.orDie);

const IssueCommentsLive = Layer.effect(
  IssueComments,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      list: (repo, { issueNumber, since }) =>
        tryRest(() =>
          client.rest.issues
            .listComments({
              ...ownerName(repo),
              issue_number: issueNumber,
              since,
            })
            .then(({ data }) =>
              data.map((c) => ({
                id: c.id,
                body: c.body ?? null,
                user: c.user ? { login: c.user.login } : null,
              })),
            ),
        ),
      create: (repo, { issueNumber, body }) =>
        tryRest(() =>
          client.rest.issues
            .createComment({
              ...ownerName(repo),
              issue_number: issueNumber,
              body,
            })
            .then(({ data }) => ({ id: data.id, htmlUrl: data.html_url })),
        ),
      update: (repo, { commentId, body }) =>
        tryRest(() =>
          client.rest.issues
            .updateComment({
              ...ownerName(repo),
              comment_id: commentId,
              body,
            })
            .then(({ data }) => ({ id: data.id, htmlUrl: data.html_url })),
        ),
      delete: (repo, { commentId }) =>
        tryRest(() =>
          client.rest.issues
            .deleteComment({
              ...ownerName(repo),
              comment_id: commentId,
            })
            .then(() => undefined),
        ),
    } satisfies IssueCommentsService;
  }),
);

const PullRequestReviewCommentsLive = Layer.effect(
  PullRequestReviewComments,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      create: (repo, { prNumber, body, commitId, path, line, side }) =>
        tryRest(() =>
          client.rest.pulls
            .createReviewComment({
              ...ownerName(repo),
              pull_number: prNumber,
              body,
              commit_id: commitId,
              path,
              line,
              side,
            })
            .then(({ data }) => ({ id: data.id, htmlUrl: data.html_url })),
        ),
      update: (repo, { commentId, body }) =>
        tryRest(() =>
          client.rest.pulls
            .updateReviewComment({
              ...ownerName(repo),
              comment_id: commentId,
              body,
            })
            .then(({ data }) => ({ id: data.id, htmlUrl: data.html_url })),
        ),
      delete: (repo, { commentId }) =>
        tryRest(() =>
          client.rest.pulls
            .deleteReviewComment({
              ...ownerName(repo),
              comment_id: commentId,
            })
            .then(() => undefined),
        ),
      reply: (repo, { prNumber, commentId, body }) =>
        tryRest(() =>
          client.rest.pulls
            .createReplyForReviewComment({
              ...ownerName(repo),
              pull_number: prNumber,
              comment_id: commentId,
              body,
            })
            .then(({ data }) => ({ id: data.id, htmlUrl: data.html_url })),
        ),
    } satisfies PullRequestReviewCommentsService;
  }),
);

const PullRequestReviewsLive = Layer.effect(
  PullRequestReviews,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      create: (repo, { prNumber, event, body, commitId }) =>
        tryRest(() =>
          client.rest.pulls
            .createReview({
              ...ownerName(repo),
              pull_number: prNumber,
              event,
              body,
              commit_id: commitId,
            })
            .then(({ data }) => ({ id: data.id, htmlUrl: data.html_url })),
        ),
      dismiss: (repo, { prNumber, reviewId, message }) =>
        tryRest(() =>
          client.rest.pulls
            .dismissReview({
              ...ownerName(repo),
              pull_number: prNumber,
              review_id: reviewId,
              message,
            })
            .then(() => undefined),
        ),
      requestReviewers: (repo, { prNumber, reviewers, teamReviewers }) =>
        tryRest(() =>
          client.rest.pulls
            .requestReviewers({
              ...ownerName(repo),
              pull_number: prNumber,
              reviewers,
              team_reviewers: teamReviewers,
            })
            .then(() => undefined),
        ),
    } satisfies PullRequestReviewsService;
  }),
);

const PullRequestsLive = Layer.effect(
  PullRequests,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      create: (repo, { head, base, title, body, draft }) =>
        tryRest(() =>
          client.rest.pulls
            .create({
              ...ownerName(repo),
              head,
              base,
              title,
              body,
              draft,
            })
            .then(({ data }) => ({
              number: data.number,
              htmlUrl: data.html_url,
            })),
        ),
      update: (repo, { prNumber, title, body, state, base }) =>
        tryRest(() =>
          client.rest.pulls
            .update({
              ...ownerName(repo),
              pull_number: prNumber,
              title,
              body,
              state,
              base,
            })
            .then(({ data }) => ({
              number: data.number,
              htmlUrl: data.html_url,
            })),
        ),
      merge: (repo, { prNumber, mergeMethod, commitTitle, commitMessage }) =>
        tryRest(() =>
          client.rest.pulls
            .merge({
              ...ownerName(repo),
              pull_number: prNumber,
              merge_method: mergeMethod,
              commit_title: commitTitle,
              commit_message: commitMessage,
            })
            .then(({ data }) => ({ sha: data.sha, merged: data.merged })),
        ),
    } satisfies PullRequestsService;
  }),
);

const GitLive = Layer.effect(
  Git,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      getRef: (repo, { ref }) =>
        tryRest(() =>
          client.rest.git
            .getRef({ ...ownerName(repo), ref })
            .then(({ data }) => ({ ref: data.ref, sha: data.object.sha })),
        ),
      createRef: (repo, { ref, sha }) =>
        tryRest(() =>
          client.rest.git
            .createRef({
              ...ownerName(repo),
              ref: ref.startsWith("refs/") ? ref : `refs/${ref}`,
              sha,
            })
            .then(({ data }) => ({ ref: data.ref, sha: data.object.sha })),
        ),
      updateRef: (repo, { ref, sha, force }) =>
        tryRest(() =>
          client.rest.git
            .updateRef({ ...ownerName(repo), ref, sha, force })
            .then(({ data }) => ({ ref: data.ref, sha: data.object.sha })),
        ),
      deleteRef: (repo, { ref }) =>
        tryRest(() =>
          client.rest.git
            .deleteRef({ ...ownerName(repo), ref })
            .then(() => undefined),
        ),
      createBlob: (repo, { content, encoding }) =>
        tryRest(() =>
          client.rest.git
            .createBlob({ ...ownerName(repo), content, encoding })
            .then(({ data }) => ({ sha: data.sha })),
        ),
      createTree: (repo, { baseTree, tree }) =>
        tryRest(() =>
          client.rest.git
            .createTree({
              ...ownerName(repo),
              base_tree: baseTree,
              tree: tree as any,
            })
            .then(({ data }) => ({ sha: data.sha })),
        ),
      createCommit: (repo, { message, tree, parents, author }) =>
        tryRest(() =>
          client.rest.git
            .createCommit({
              ...ownerName(repo),
              message,
              tree,
              parents,
              author,
            })
            .then(({ data }) => ({ sha: data.sha })),
        ),
    } satisfies GitService;
  }),
);

const ContentsLive = Layer.effect(
  Contents,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      get: (repo, { path, ref }) =>
        tryRest(async () => {
          try {
            const { data } = await client.rest.repos.getContent({
              ...ownerName(repo),
              path,
              ref,
            });
            // Single-file responses are objects with `content`; arrays are
            // directory listings (we expose `undefined` for those).
            if (Array.isArray(data) || data.type !== "file") return undefined;
            return {
              sha: data.sha,
              content: data.content,
              encoding: data.encoding,
            };
          } catch (e: any) {
            if (e.status === 404) return undefined;
            throw e;
          }
        }),
      put: (repo, { path, message, content, branch, sha }) =>
        tryRest(() =>
          client.rest.repos
            .createOrUpdateFileContents({
              ...ownerName(repo),
              path,
              message,
              content: btoa(unescape(encodeURIComponent(content))),
              branch,
              sha,
            })
            .then(({ data }) => ({
              sha: data.content?.sha ?? "",
              commitSha: data.commit.sha ?? "",
            })),
        ),
      delete: (repo, { path, message, sha, branch }) =>
        tryRest(() =>
          client.rest.repos
            .deleteFile({
              ...ownerName(repo),
              path,
              message,
              sha,
              branch,
            })
            .then(({ data }) => ({ commitSha: data.commit.sha ?? "" })),
        ),
    } satisfies ContentsService;
  }),
);

const CommitStatusesLive = Layer.effect(
  CommitStatuses,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      create: (repo, { sha, state, context, description, targetUrl }) =>
        tryRest(() =>
          client.rest.repos
            .createCommitStatus({
              ...ownerName(repo),
              sha,
              state,
              context,
              description,
              target_url: targetUrl,
            })
            .then(({ data }) => ({ id: data.id, url: data.url })),
        ),
    } satisfies CommitStatusesService;
  }),
);

const CheckRunsLive = Layer.effect(
  CheckRuns,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      create: (
        repo,
        { name, headSha, status, conclusion, detailsUrl, output },
      ) =>
        tryRest(() =>
          client.rest.checks
            .create({
              ...ownerName(repo),
              name,
              head_sha: headSha,
              status,
              conclusion,
              details_url: detailsUrl,
              output,
            })
            .then(({ data }) => ({
              id: data.id,
              htmlUrl: data.html_url ?? "",
            })),
        ),
      update: (repo, { checkRunId, status, conclusion, output }) =>
        tryRest(() =>
          client.rest.checks
            .update({
              ...ownerName(repo),
              check_run_id: checkRunId,
              status,
              conclusion,
              output,
            })
            .then(() => undefined),
        ),
    } satisfies CheckRunsService;
  }),
);

const ReactionsLive = Layer.effect(
  Reactions,
  Effect.gen(function* () {
    const { client } = yield* RuntimeOctokit;
    return {
      forIssue: (repo, { issueNumber, content }) =>
        tryRest(() =>
          client.rest.reactions
            .createForIssue({
              ...ownerName(repo),
              issue_number: issueNumber,
              content,
            })
            .then(({ data }) => ({ id: data.id })),
        ),
      forIssueComment: (repo, { commentId, content }) =>
        tryRest(() =>
          client.rest.reactions
            .createForIssueComment({
              ...ownerName(repo),
              comment_id: commentId,
              content,
            })
            .then(({ data }) => ({ id: data.id })),
        ),
      forReview: (repo, { prNumber, reviewId, content }) =>
        // GitHub doesn't expose review reactions directly; emulate by
        // creating a reaction on the PR's first review comment, falling
        // back to a comment reaction is out of scope. We attach to the
        // review's body via the PR review-comment endpoint instead.
        tryRest(async () => {
          // No first-class API; emulate via review-comment reaction by
          // grabbing the first review comment under the review. This is
          // a pragmatic fallback; callers wanting the literal review
          // reaction surface should drop down to the raw client.
          const { data } = await client.rest.pulls.listReviewComments({
            ...ownerName(repo),
            pull_number: prNumber,
            per_page: 1,
          });
          const target = data.find(
            (c) => (c as any).pull_request_review_id === reviewId,
          );
          if (!target) {
            throw new Error(
              `Reactions.forReview: no review comments found for review ${reviewId}`,
            );
          }
          const { data: r } =
            await client.rest.reactions.createForPullRequestReviewComment({
              ...ownerName(repo),
              comment_id: target.id,
              content,
            });
          return { id: r.id };
        }),
    } satisfies ReactionsService;
  }),
);

/**
 * Provides every GitHub runtime capability on a single layer. Add this to
 * the Worker init phase after providing a `RuntimeOctokit` layer.
 *
 * @example
 * ```typescript
 * Effect.gen(function* () {
 *   // ... bind resources ...
 *   return { fetch: ... };
 * }).pipe(
 *   Effect.provide(GitHub.CapabilitiesLive),
 *   Effect.provide(GitHub.RuntimeOctokit.fromEnv("GITHUB_TOKEN")),
 * );
 * ```
 */
export const CapabilitiesLive = Layer.mergeAll(
  IssueCommentsLive,
  PullRequestReviewCommentsLive,
  PullRequestReviewsLive,
  PullRequestsLive,
  GitLive,
  ContentsLive,
  CommitStatusesLive,
  CheckRunsLive,
  ReactionsLive,
);
