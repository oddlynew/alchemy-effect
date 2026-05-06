import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type { WebhookDelivery, WebhookEventName } from "./Events.ts";

/**
 * The minimum identification needed to match an inbound webhook to a
 * registered handler. Worker source code typically constructs this with
 * literal owner/name pairs because the deploy-time `Repository` resource
 * isn't available in the bundled Worker. Capability functions accept the
 * same shape.
 */
export interface RepoRef {
  owner: string;
  name: string;
}

export const repoFullName = (repo: RepoRef): string =>
  `${repo.owner}/${repo.name}`.toLowerCase();

export class WebhookSignatureError extends Data.TaggedError(
  "GitHub.WebhookSignatureError",
)<{
  readonly message: string;
}> {}

export class WebhookFormatError extends Data.TaggedError(
  "GitHub.WebhookFormatError",
)<{
  readonly message: string;
}> {}

/**
 * Signature of a typed webhook handler registered through an event source
 * helper such as {@link pullRequests} or {@link issueComments}.
 */
export type WebhookHandler<
  E extends WebhookEventName,
  Req = never,
  Err = never,
> = (delivery: WebhookDelivery<E>) => Effect.Effect<void, Err, Req>;

/**
 * Dispatcher service injected into the Worker init phase. Event-source
 * helpers register handlers on it; the Worker's `fetch` handler calls
 * {@link DispatcherService.handle} on incoming POSTs to dispatch verified
 * deliveries.
 */
export interface DispatcherService {
  /**
   * Register a handler for a specific repository + event name. The handler
   * runs once per matching delivery, forked daemonically so a slow
   * handler does not delay webhook acknowledgement.
   */
  register<E extends WebhookEventName>(
    repo: RepoRef,
    event: E,
    handler: WebhookHandler<E, any, any>,
  ): Effect.Effect<void>;

  /**
   * Register a handler that runs for every event delivered to this
   * repository. Used by `events(repo).subscribe(...)` and by filter-based
   * subscriptions; typed sugar like `pullRequests` uses `register` instead.
   */
  registerAny(
    repo: RepoRef,
    handler: WebhookHandler<WebhookEventName, any, any>,
  ): Effect.Effect<void>;

  /**
   * Dispatch an incoming webhook request. Verifies `X-Hub-Signature-256`
   * against the configured secret, parses the JSON body, and runs all
   * matching handlers concurrently. Returns:
   * - 204 No Content on a verified delivery (handlers are forked, so the
   *   reply is sent before they finish).
   * - 401 Unauthorized when signature verification fails.
   * - 400 Bad Request for malformed deliveries.
   * - `undefined` when the request is not a webhook (callers fall through
   *   to the rest of their `fetch` handler).
   */
  handle(
    request: HttpServerRequest,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse | undefined>;
}

export class Dispatcher extends Context.Service<
  Dispatcher,
  DispatcherService
>()("GitHub.Webhooks.Dispatcher") {}

/**
 * Verify the `sha256=...` signature on a GitHub webhook delivery against
 * the shared secret. Uses the SubtleCrypto API available in Cloudflare
 * Workers and modern Node / Bun runtimes — no platform fork required.
 *
 * Returns `true` on a constant-time match; `false` otherwise.
 */
export const verifySignature = (
  secret: string,
  signatureHeader: string | undefined,
  rawBody: string,
): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
        return false;
      }
      const expectedHex = signatureHeader.slice("sha256=".length);
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBytes = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(rawBody),
      );
      const sigHex = Array.from(new Uint8Array(sigBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      // Constant-time comparison.
      if (sigHex.length !== expectedHex.length) return false;
      let mismatch = 0;
      for (let i = 0; i < sigHex.length; i++) {
        mismatch |= sigHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
      }
      return mismatch === 0;
    },
    catch: (e) => e as Error,
  }).pipe(Effect.orElseSucceed(() => false));
