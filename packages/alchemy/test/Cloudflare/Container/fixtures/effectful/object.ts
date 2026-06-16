import * as Cloudflare from "@/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { EffectfulContainer } from "./container.ts";

/**
 * Durable Object that binds and starts the {@link EffectfulContainer} and
 * exposes both its RPC method (`ping`) and an HTTP round-trip to the
 * container's port-3000 server (`hello`).
 */
export class EffectfulContainerObject extends Cloudflare.DurableObjectNamespace<EffectfulContainerObject>()(
  "EffectfulContainerObject",
  Effect.gen(function* () {
    const sandbox = yield* Cloudflare.Container.bind(EffectfulContainer);

    return Effect.gen(function* () {
      const container = yield* Cloudflare.start(sandbox);

      return {
        ping: () => container.ping(),
        hello: () =>
          Effect.gen(function* () {
            const { fetch } = yield* container.getTcpPort(3000);
            const response = yield* fetch(
              HttpClientRequest.get("http://container/"),
            );
            return yield* response.text;
          }),
      };
    });
  }),
) {}
