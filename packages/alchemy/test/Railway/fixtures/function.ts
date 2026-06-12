import * as Railway from "@/Railway";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { ensureSharedProject } from "../harness.ts";

/**
 * Name of the deploy-time `process.env` variable the test populates
 * before deploying — sourced via `Config.string(...)` inside the
 * Function's init phase.
 */
export const GREETING_ENV_KEY = "ALCHEMY_RAILWAY_FN_TEST_GREETING";

/** Fallback used when the deploy-time env var is not populated. */
export const GREETING_DEFAULT = "hello-from-config-default";

/**
 * Effect-native Railway Function fixture: an HTTP service with one route
 * per behavior under test, deployed for real by `Function.test.ts`.
 *
 * Plain config flows through `effect/Config` (NOT a binding): the value
 * is resolved against the active ConfigProvider (process.env) at deploy
 * time, published as a Railway service variable by the Function
 * provider, and re-read from the container's environment at runtime.
 */
export default class TestFunction extends Railway.Function<TestFunction>()(
  "RailwayTestFn",
  Effect.gen(function* () {
    // Deploy-time only — props effects are skipped inside the deployed
    // container (ALCHEMY_PHASE=runtime). Typed lookup errors are fatal here.
    const { projectId, environmentId } =
      yield* Effect.orDie(ensureSharedProject);
    return {
      main: import.meta.filename,
      project: { projectId },
      environment: { environmentId },
      name: "alchemy-test-railway-fn-svc",
    };
  }),
  Effect.gen(function* () {
    // Captured during Init — Alchemy resolves this at deploy time,
    // reconciles it onto the service's variables, and the runtime
    // ConfigProvider re-resolves it from process.env here.
    const greeting = yield* Config.string(GREETING_ENV_KEY).pipe(
      Config.withDefault(GREETING_DEFAULT),
    );

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;

        if (request.url.startsWith("/hello")) {
          return yield* HttpServerResponse.json({
            message: "hello from railway",
          });
        }

        if (request.url.startsWith("/greeting")) {
          return yield* HttpServerResponse.json({ greeting });
        }

        return HttpServerResponse.text("ok");
      }),
    };
  }),
) {}
