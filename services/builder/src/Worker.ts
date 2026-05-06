import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Redacted from "effect/Redacted";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import Builds from "./Builds.ts";
import * as Prompts from "./Prompts.ts";

/**
 * Hard-coded repo this builder watches. The Worker source can't reach into
 * the deploy-time `Repository` resource, so the owner/name pair is wired
 * here as a literal — the Stack file (alchemy.run.ts) keeps the same
 * pair and uses it to install the Webhook resource at deploy time.
 */
const REPO: GitHub.RepoRef = {
  owner: "alchemy-run",
  name: "alchemy-effect",
};

const ARTIFACTS_NAME = "builder-source";

const webhookSecret = Redacted.make(
  (globalThis as any).process?.env?.GITHUB_WEBHOOK_SECRET ?? "dev-secret",
);

/**
 * Self-hosted CI Worker. Subscribes to GitHub webhook events for one
 * repository and dispatches builds + coding-agent runs to a per-SHA
 * Durable Object backed by a Cloudflare Container.
 */
export default class Worker extends Cloudflare.Worker<Worker>()(
  "Worker",
  {
    main: import.meta.path,
    compatibility: { flags: ["nodejs_compat"] },
  },
  Effect.gen(function* () {
    const builds = yield* Builds;

    // Bind the Cloudflare Artifacts namespace — the Container clones from
    // the artifact remote that this binding gives us at runtime.
    const artifacts = yield* Cloudflare.Artifacts.bind(
      yield* Cloudflare.Artifacts(ARTIFACTS_NAME),
    );

    // Resolve the runtime services up-front so the per-event handlers
    // (which run after init) can close over plain values instead of
    // re-yielding from the Effect context. Same pattern as Api.ts —
    // bindings are values inside `fetch`.
    const dispatcher = yield* GitHub.Dispatcher;
    const commitStatuses = yield* GitHub.CommitStatuses;
    const comments = yield* GitHub.IssueComments;

    // Push events trigger a build for the new sha.
    yield* GitHub.pushes(REPO).subscribe((delivery) =>
      Effect.gen(function* () {
        if (delivery.payload.deleted) return;
        const { after, ref } = delivery.payload;

        const repo = yield* artifacts.get(ARTIFACTS_NAME).pipe(Effect.orDie);
        const token = yield* repo.createToken("read", 3600).pipe(Effect.orDie);
        const id = `${REPO.owner}/${REPO.name}@${after}`;

        const result = yield* builds
          .getByName(id)
          .runBuild({
            artifactsRepo: ARTIFACTS_NAME,
            artifactsRemote: repo.raw.remote,
            artifactsToken: token.token,
            ref: ref.replace(/^refs\/heads\//, ""),
            sha: after,
          })
          .pipe(Effect.orDie);

        yield* commitStatuses
          .create(REPO, {
            sha: after,
            state: result.status === "success" ? "success" : "failure",
            context: "alchemy/builder",
            description: `build exit ${result.exitCode}`,
          })
          .pipe(Effect.orElseSucceed(() => ({ id: 0, url: "" })));
      }),
    );

    // Reviewer requested changes → run agent on the PR head, push fixup,
    // post a follow-up comment.
    yield* GitHub.pullRequestReviews(REPO).subscribe((delivery) =>
      Effect.gen(function* () {
        if (delivery.payload.action !== "submitted") return;
        if (delivery.payload.review.state !== "changes_requested") return;
        const pr = delivery.payload.pull_request;

        const repo = yield* artifacts.get(ARTIFACTS_NAME).pipe(Effect.orDie);
        const token = yield* repo.createToken("write", 3600).pipe(Effect.orDie);
        const id = `${REPO.owner}/${REPO.name}@pr-${pr.number}`;

        const result = yield* builds
          .getByName(id)
          .runAgent({
            artifactsRepo: ARTIFACTS_NAME,
            artifactsRemote: repo.raw.remote,
            artifactsToken: token.token,
            ref: pr.head.ref,
            pushBranch: pr.head.ref,
            prompt: Prompts.respondToReview({
              reviewBody: delivery.payload.review.body,
              inlineComments: [],
            }),
          })
          .pipe(Effect.orDie);

        yield* comments
          .create(REPO, {
            issueNumber: pr.number,
            body:
              result.pushedSha != null
                ? `Pushed updates addressing the review (\`${result.pushedSha.slice(0, 7)}\`).`
                : `Tried to address the review but the run failed (exit ${result.exitCode}).`,
          })
          .pipe(Effect.orElseSucceed(() => ({ id: 0, htmlUrl: "" })));
      }),
    );

    // Releases trigger a release-blog agent task.
    yield* GitHub.releases(REPO).subscribe((delivery) =>
      Effect.gen(function* () {
        if (delivery.payload.action !== "published") return;
        const tag = delivery.payload.release.tag_name;

        const repo = yield* artifacts.get(ARTIFACTS_NAME).pipe(Effect.orDie);
        const token = yield* repo.createToken("write", 3600).pipe(Effect.orDie);
        const id = `${REPO.owner}/${REPO.name}@release-${tag}`;

        yield* builds
          .getByName(id)
          .runAgent({
            artifactsRepo: ARTIFACTS_NAME,
            artifactsRemote: repo.raw.remote,
            artifactsToken: token.token,
            ref: "main",
            pushBranch: `release-blog/${tag}`,
            prompt: Prompts.releaseBlog({ fromTag: null, toTag: tag }),
          })
          .pipe(Effect.orDie);
      }),
    );

    // Catch-all that demonstrates the generic `events(repo)` primitive +
    // `Match.discriminator("event")`. Useful for adding new events
    // without a typed sugar helper.
    yield* GitHub.events(REPO).subscribe((delivery) =>
      Match.value(delivery).pipe(
        Match.discriminator("event")("issue_comment", ({ payload }) =>
          Effect.gen(function* () {
            if (payload.action !== "created") return;
            const body = payload.comment.body ?? "";
            if (!body.startsWith("/build")) return;
            if (!payload.issue.pull_request) return;
            // Chat-op: rebuild this PR. Implementation left for the
            // operator to wire up — the typed payload is right here.
          }),
        ),
        Match.orElse(() => Effect.void),
      ),
    );

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const handled = yield* dispatcher.handle(request);
        if (handled !== undefined) return handled;
        return HttpServerResponse.text("alchemy builder", { status: 200 });
      }),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Cloudflare.ArtifactsBindingLive, GitHub.CapabilitiesLive),
    ),
    Effect.provide(Cloudflare.GitHub.Webhooks.live(webhookSecret)),
    Effect.provide(GitHub.Octokit.fromEnv("GITHUB_TOKEN")),
  ),
) {}
