import * as Effect from "effect/Effect";
import type { AnyWebhookDelivery, WebhookEventName } from "./Events.ts";
import { Dispatcher, type RepoRef, type WebhookHandler } from "./Webhooks.ts";

/**
 * Generic event source — subscribe to every webhook delivery for a
 * repository. Handlers receive the discriminated `AnyWebhookDelivery` and
 * typically dispatch via `Match.discriminator("event")`.
 *
 * @example
 * ```typescript
 * yield* GitHub.events(repo).subscribe((delivery) =>
 *   Match.value(delivery).pipe(
 *     Match.discriminator("event")("pull_request", ({ payload }) =>
 *       handlePr(payload),
 *     ),
 *     Match.discriminator("event")("issue_comment", ({ payload }) =>
 *       handleComment(payload),
 *     ),
 *     Match.orElse(() => Effect.void),
 *   ),
 * );
 * ```
 *
 * Most callers will reach for the typed sugar (e.g. {@link pullRequests},
 * {@link issueComments}) — those are implemented on top of this primitive
 * and just register a handler scoped to a single event name.
 */
export const events = (repo: RepoRef) => ({
  /**
   * Register a handler invoked for every event delivered to this repository.
   * The handler may require any services that are available in the Worker's
   * fetch handler context (e.g. WorkerEnvironment, capability bindings) —
   * those are inherited from the fiber that ran the Worker init phase.
   */
  subscribe: <Req, Err>(
    handler: (delivery: AnyWebhookDelivery) => Effect.Effect<void, Err, Req>,
  ) =>
    Dispatcher.use((d) =>
      d.registerAny(
        repo,
        handler as WebhookHandler<WebhookEventName, any, any>,
      ),
    ),
  /**
   * Register a handler that runs only when `predicate` returns `true`.
   * The predicate is evaluated synchronously against the parsed delivery
   * before any handler is invoked.
   */
  filter: (predicate: (delivery: AnyWebhookDelivery) => boolean) => ({
    subscribe: <Req, Err>(
      handler: (delivery: AnyWebhookDelivery) => Effect.Effect<void, Err, Req>,
    ) =>
      Dispatcher.use((d) =>
        d.registerAny(repo, (delivery) =>
          predicate(delivery as AnyWebhookDelivery)
            ? handler(delivery as AnyWebhookDelivery)
            : Effect.void,
        ),
      ),
  }),
});

/**
 * Build a typed `subscribe(handler)` for a single GitHub event name.
 * Used to construct the public event-name helpers below; equivalent to
 * `events(repo).filter((d) => d.event === E).subscribe(...)` but with
 * the payload narrowed for the caller.
 */
const eventSource =
  <E extends WebhookEventName>(event: E) =>
  (repo: RepoRef) => ({
    subscribe: <Req, Err>(handler: WebhookHandler<E, Err, Req>) =>
      Dispatcher.use((d) => d.register(repo, event, handler)),
  });

/**
 * Subscribe to `pull_request` events for a repository. Handler receives
 * a typed delivery with the payload narrowed to {@link WebhookEventMap.pull_request}.
 */
export const pullRequests = eventSource("pull_request");

/**
 * Subscribe to `pull_request_review` events (review submitted, edited,
 * dismissed). Use this to react to "approve" / "request changes".
 */
export const pullRequestReviews = eventSource("pull_request_review");

/**
 * Subscribe to `pull_request_review_comment` events — inline review
 * comments on specific code lines.
 */
export const pullRequestReviewComments = eventSource(
  "pull_request_review_comment",
);

/**
 * Subscribe to `issue_comment` events. Covers both issue comments and
 * conversation comments on pull requests (GitHub uses one endpoint for
 * both). Filter on `payload.issue.pull_request` to narrow to PR comments.
 */
export const issueComments = eventSource("issue_comment");

/**
 * Subscribe to `issues` events.
 */
export const issues = eventSource("issues");

/**
 * Subscribe to `push` events.
 */
export const pushes = eventSource("push");

/**
 * Subscribe to `release` events.
 */
export const releases = eventSource("release");

/**
 * Subscribe to `workflow_run` events.
 */
export const workflowRuns = eventSource("workflow_run");

/**
 * Subscribe to `check_run` events. Handles re-run requests from the UI.
 */
export const checkRuns = eventSource("check_run");
