import * as Cloudflare from "@/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { RemoteContainer } from "./container.ts";

/**
 * Durable Object that binds and starts the {@link RemoteContainer} and
 * proxies an HTTP request to the nginx server running on port 80 inside it.
 */
export class RemoteContainerObject extends Cloudflare.DurableObjectNamespace<RemoteContainerObject>()(
  "RemoteContainerObject",
  Effect.gen(function* () {
    const bound = yield* Cloudflare.Container.bind(RemoteContainer);

    return Effect.gen(function* () {
      const container = yield* Cloudflare.start(bound);

      return {
        hello: () =>
          Effect.gen(function* () {
            const { fetch } = yield* container.getTcpPort(80);
            const response = yield* fetch(
              HttpClientRequest.get("http://container/"),
            );
            return yield* response.text;
          }),
      };
    });
  }),
) {}
