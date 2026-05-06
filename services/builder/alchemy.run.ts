import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Worker from "./src/Worker.ts";

/**
 * Stack: a self-hosted CI service running on Cloudflare. Watches a single
 * GitHub repo for events, builds it in a Container, and runs coding-agent
 * tasks for review responses + release notes.
 *
 * The repo identifiers below must match the literal `REPO` constant in
 * `src/Worker.ts` — the worker source can't read this stack's resources,
 * so the (owner, name) pair is duplicated by design.
 */
const REPO = {
  owner: "alchemy-run",
  name: "alchemy-effect",
} as const;

export default Alchemy.Stack(
  "AlchemyBuilder",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // The repository we watch (adopted — it already exists on GitHub).
    yield* GitHub.Repository("repo", {
      owner: REPO.owner,
      name: REPO.name,
      adopt: true,
    });

    // Random secret for webhook HMAC. Persisted in state so subsequent
    // deploys keep the same secret unless the resource is replaced.
    const webhookSecret = yield* Alchemy.Random("webhook-secret");

    // The Worker hosts the dispatcher and reads the secret out of its
    // GITHUB_WEBHOOK_SECRET env binding (wired separately at deploy time
    // via wrangler / dashboard / Cloudflare.SecretsStore).
    const worker = yield* Worker;

    // Install the actual GitHub webhook to point at the worker URL.
    yield* GitHub.Webhook("hook", {
      owner: REPO.owner,
      repository: REPO.name,
      url: Output.interpolate`${worker.url}/__github/webhook`,
      secret: webhookSecret.text,
      events: [
        "push",
        "pull_request",
        "pull_request_review",
        "pull_request_review_comment",
        "issue_comment",
        "release",
      ],
    });

    return {
      workerUrl: worker.url,
    };
  }),
);
