/**
 * Lean type shapes for GitHub webhook payloads. These cover the fields
 * most apps reach for; the original parsed JSON is always available via
 * `raw` for callers that want to assert against `@octokit/webhooks-types`
 * themselves.
 */

export type RepositoryRef = {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: { login: string; id: number };
  default_branch: string;
  html_url: string;
  clone_url: string;
};

export type UserRef = {
  id: number;
  login: string;
  type: "User" | "Bot" | "Organization";
};

export type PullRequestRef = {
  id: number;
  number: number;
  state: "open" | "closed";
  title: string;
  body: string | null;
  draft: boolean;
  merged: boolean;
  user: UserRef;
  head: { ref: string; sha: string; repo: RepositoryRef | null };
  base: { ref: string; sha: string; repo: RepositoryRef };
  html_url: string;
};

export type IssueRef = {
  id: number;
  number: number;
  state: "open" | "closed";
  title: string;
  body: string | null;
  user: UserRef;
  pull_request?: { url: string };
  html_url: string;
};

export type CommentRef = {
  id: number;
  body: string | null;
  user: UserRef;
  html_url: string;
};

export type ReviewRef = {
  id: number;
  state:
    | "approved"
    | "changes_requested"
    | "commented"
    | "dismissed"
    | "pending";
  body: string | null;
  user: UserRef;
  html_url: string;
  commit_id: string;
};

export type PushCommit = {
  id: string;
  message: string;
  timestamp: string;
  author: { name: string; email: string };
};

/**
 * Event-name → payload shape. Names match GitHub's `X-GitHub-Event` header
 * verbatim so users can search GitHub's docs by the same identifier.
 */
export interface WebhookEventMap {
  pull_request: {
    action:
      | "opened"
      | "edited"
      | "closed"
      | "reopened"
      | "synchronize"
      | "ready_for_review"
      | "review_requested"
      | "review_request_removed"
      | "labeled"
      | "unlabeled"
      | (string & {});
    number: number;
    pull_request: PullRequestRef;
    repository: RepositoryRef;
    sender: UserRef;
  };
  pull_request_review: {
    action: "submitted" | "edited" | "dismissed" | (string & {});
    review: ReviewRef;
    pull_request: PullRequestRef;
    repository: RepositoryRef;
    sender: UserRef;
  };
  pull_request_review_comment: {
    action: "created" | "edited" | "deleted" | (string & {});
    comment: CommentRef & {
      pull_request_review_id: number;
      diff_hunk: string;
      path: string;
      line: number | null;
      side: "LEFT" | "RIGHT";
    };
    pull_request: PullRequestRef;
    repository: RepositoryRef;
    sender: UserRef;
  };
  issues: {
    action:
      | "opened"
      | "edited"
      | "closed"
      | "reopened"
      | "labeled"
      | "unlabeled"
      | "assigned"
      | "unassigned"
      | (string & {});
    issue: IssueRef;
    repository: RepositoryRef;
    sender: UserRef;
  };
  issue_comment: {
    action: "created" | "edited" | "deleted" | (string & {});
    issue: IssueRef;
    comment: CommentRef;
    repository: RepositoryRef;
    sender: UserRef;
  };
  push: {
    ref: string;
    before: string;
    after: string;
    created: boolean;
    deleted: boolean;
    forced: boolean;
    commits: PushCommit[];
    head_commit: PushCommit | null;
    repository: RepositoryRef;
    pusher: { name: string; email: string };
    sender: UserRef;
  };
  release: {
    action: "published" | "released" | "edited" | (string & {});
    release: {
      id: number;
      tag_name: string;
      name: string | null;
      body: string | null;
      draft: boolean;
      prerelease: boolean;
      html_url: string;
    };
    repository: RepositoryRef;
    sender: UserRef;
  };
  workflow_run: {
    action: "requested" | "in_progress" | "completed" | (string & {});
    workflow_run: {
      id: number;
      name: string | null;
      status: string;
      conclusion: string | null;
      head_branch: string | null;
      head_sha: string;
      html_url: string;
    };
    repository: RepositoryRef;
    sender: UserRef;
  };
  check_run: {
    action: "created" | "completed" | "rerequested" | (string & {});
    check_run: {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      head_sha: string;
      html_url: string | null;
    };
    repository: RepositoryRef;
    sender: UserRef;
  };
}

export type WebhookEventName = keyof WebhookEventMap;

/**
 * The parsed webhook delivery passed to subscriber handlers.
 *
 * Generic in the event name so handlers registered via the typed event-source
 * helpers (e.g. `pullRequests`) get a narrowed `payload`. The discriminator
 * field is `event` — matches `Match.discriminator("event")(...)` so users
 * with a generic subscription can fan out by event name.
 */
export interface WebhookDelivery<
  E extends WebhookEventName = WebhookEventName,
> {
  /** GitHub event name — the `X-GitHub-Event` header. */
  event: E;
  /** GitHub delivery id (`X-GitHub-Delivery`) — unique per delivery. */
  deliveryId: string;
  /** Hook id that produced this delivery, if reported. */
  hookId?: number;
  /** Verified payload for the event. */
  payload: WebhookEventMap[E];
  /** Original JSON parsed body, in case `payload` types miss a field. */
  raw: Record<string, any>;
}

/**
 * Discriminated union over every known event. Use this as the parameter
 * type when matching with `Match.value` + `Match.discriminator("event")`.
 */
export type AnyWebhookDelivery = {
  [E in WebhookEventName]: WebhookDelivery<E>;
}[WebhookEventName];
