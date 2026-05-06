import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import type {
  AnyWebhookDelivery,
  WebhookDelivery,
  WebhookEventName,
} from "../../GitHub/Events.ts";
import {
  Dispatcher,
  repoFullName,
  verifySignature,
  type DispatcherService,
  type RepoRef,
  type WebhookHandler,
} from "../../GitHub/Webhooks.ts";

interface NamedHandler {
  /** Repository fully-qualified name (`owner/name`) the handler is bound to. */
  repoFullName: string;
  /** GitHub event name, or "*" for any. */
  event: WebhookEventName | "*";
  /**
   * The actual handler. We type-erase on `any` because each registration
   * may have its own `Req`/`Err`; the dispatcher invokes the effect inside
   * `Effect.forkDetach` where the parent fiber's context provides any
   * services the handler needs.
   */
  handler: WebhookHandler<WebhookEventName, any, any>;
}

/**
 * Build the Cloudflare-side `Dispatcher` Live layer. The webhook secret is
 * passed in (the Worker stack typically wires it as a Cloudflare Secret env
 * binding, then constructs this layer in the init phase).
 *
 * The dispatcher accumulates `NamedHandler[]` as event-source helpers
 * register handlers. `handle` then delivers verified webhooks to all
 * matching handlers concurrently via `Effect.fork`, returning 204
 * immediately so the GitHub delivery is acked even if a handler is slow.
 */
export const live = (
  secret: Redacted.Redacted<string>,
  options: {
    /**
     * Path the Worker should treat as the webhook endpoint. `handle`
     * returns `undefined` for requests on other paths so callers can fall
     * through to their normal `fetch` routing.
     * @default "/__github/webhook"
     */
    path?: string;
  } = {},
): Layer.Layer<Dispatcher> => {
  const path = options.path ?? "/__github/webhook";

  return Layer.effect(
    Dispatcher,
    Effect.gen(function* () {
      const handlers = yield* Ref.make<NamedHandler[]>([]);

      const append = (h: NamedHandler) =>
        Ref.update(handlers, (xs) => [...xs, h]);

      const service: DispatcherService = {
        register: (repo: RepoRef, event, handler) =>
          append({
            repoFullName: repoFullName(repo),
            event,
            handler: handler as WebhookHandler<WebhookEventName, never, never>,
          }),
        registerAny: (repo, handler) =>
          append({
            repoFullName: repoFullName(repo),
            event: "*",
            handler,
          }),
        handle: (request) =>
          Effect.gen(function* () {
            const url = new URL(request.url, "http://localhost");
            if (request.method !== "POST" || url.pathname !== path) {
              return undefined;
            }

            const eventHeader = request.headers["x-github-event"];
            const sig = request.headers["x-hub-signature-256"];
            const deliveryId = request.headers["x-github-delivery"];
            const hookId = request.headers["x-github-hook-id"];
            if (!eventHeader || !deliveryId) {
              return HttpServerResponse.text("missing GitHub headers", {
                status: 400,
              });
            }

            const rawBody = yield* request.text;
            const verified = yield* verifySignature(
              Redacted.value(secret),
              sig,
              rawBody,
            );
            if (!verified) {
              return HttpServerResponse.text("invalid signature", {
                status: 401,
              });
            }

            let payload: Record<string, any>;
            try {
              payload = JSON.parse(rawBody);
            } catch {
              return HttpServerResponse.text("invalid json", {
                status: 400,
              });
            }

            const delivery: WebhookDelivery<WebhookEventName> = {
              event: eventHeader as WebhookEventName,
              deliveryId,
              hookId: hookId ? Number(hookId) : undefined,
              payload: payload as any,
              raw: payload,
            };

            const repoFromPayload = (
              (payload.repository as { full_name?: string } | undefined)
                ?.full_name ?? ""
            ).toLowerCase();

            const xs = yield* Ref.get(handlers);
            const matching = xs.filter(
              (h) =>
                h.repoFullName === repoFromPayload &&
                (h.event === "*" || h.event === eventHeader),
            );

            // Fork each matching handler. We deliberately don't await them
            // — GitHub's webhook timeout is 10s and we want the 204 ack to
            // go out promptly.
            yield* Effect.forEach(
              matching,
              (h) =>
                Effect.forkDetach(
                  h
                    .handler(delivery as AnyWebhookDelivery)
                    .pipe(Effect.catchCause(() => Effect.void)),
                ),
              { discard: true },
            );

            return HttpServerResponse.empty({ status: 204 });
          }).pipe(Effect.orDie) as Effect.Effect<
            HttpServerResponse.HttpServerResponse | undefined
          >,
      };

      return service;
    }),
  );
};
