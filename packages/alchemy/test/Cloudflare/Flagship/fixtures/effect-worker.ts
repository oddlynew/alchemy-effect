import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Flagship apps cannot be provisioned via API (private beta, dashboard-only),
 * so the app id comes from the environment at plantime. At runtime the marker
 * is only used to look up the binding by name, so the fallback is harmless.
 */
const APP_ID = globalThis.process?.env?.FLAGSHIP_APP_ID ?? "alchemy-test-app";

/**
 * Effect-native Worker fixture for the Cloudflare Flagship binding. Yielding
 * `Cloudflare.Flagship(...)` during init attaches the binding to this Worker
 * and resolves to the runtime client in one step — the marker IS the Effect.
 */
export default class FlagshipEffectWorker extends Cloudflare.Worker<FlagshipEffectWorker>()(
  "FlagshipEffectWorker",
  {
    main: import.meta.filename,
  },
  Effect.gen(function* () {
    const flags = yield* Cloudflare.Flagship({ appId: APP_ID });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;

        if (request.url.startsWith("/bool")) {
          const enabled = yield* flags
            .getBooleanValue("test-flag", false, { userId: "user-42" })
            .pipe(Effect.orDie);
          return yield* HttpServerResponse.json({ mode: "effect", enabled });
        }

        if (request.url.startsWith("/details")) {
          const details = yield* flags
            .getStringDetails("nonexistent-flag", "fallback", {
              userId: "user-42",
            })
            .pipe(Effect.orDie);
          return yield* HttpServerResponse.json({ mode: "effect", details });
        }

        return HttpServerResponse.text("ok");
      }),
    };
  }).pipe(Effect.provide(Cloudflare.FlagshipBindingLive)),
) {}
