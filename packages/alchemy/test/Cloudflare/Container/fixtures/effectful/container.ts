import * as Cloudflare from "@/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Effect-native container (`main` variant): the entrypoint is an Effect
 * program that Alchemy bundles and bakes into a generated Docker image.
 * Exposes an RPC method (`ping`) plus an HTTP server on port 3000.
 */
export class EffectfulContainer extends Cloudflare.Container<
  EffectfulContainer,
  {
    ping: () => Effect.Effect<string>;
  }
>()("EffectfulContainer", {
  main: import.meta.filename,
}) {}

export default EffectfulContainer.make(
  Effect.gen(function* () {
    return EffectfulContainer.of({
      ping: () => Effect.succeed("pong"),
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://container");
        if (url.pathname === "/health") {
          return yield* HttpServerResponse.json({ ok: true });
        }
        return HttpServerResponse.text("hello from effectful container");
      }),
    });
  }),
);
