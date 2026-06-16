import * as Cloudflare from "@/Cloudflare";
import * as Test from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import EffectfulStack from "./fixtures/effectful/stack.ts";
import ExternalStack from "./fixtures/external/stack.ts";
import RemoteStack from "./fixtures/remote/stack.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
});

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// Container image build + push + worker/DO deploy comfortably exceeds the
// default 120s hook budget, so give every deploy/destroy plenty of room.
const HOOK_TIMEOUT = 600_000;
const TEST_TIMEOUT = 300_000;

// Cap exponential backoff at 3s — keeps the fast path snappy but stops the
// geometric blow-up from dominating wall time when CF edge is slow.
const readinessSchedule = Schedule.exponential("500 millis").pipe(
  Schedule.either(Schedule.spaced("3 seconds")),
);
const readinessRetries = 30;

// While a freshly pre-created worker propagates, Cloudflare's edge serves
// Alchemy's pre-create stub (200 with this body); any poll that sees it retries.
const DEPLOY_PLACEHOLDER = "Alchemy worker is being deployed...";

// Force `Connection: close` so each readiness attempt opens a fresh connection
// and can land on an edge that already has the new deploy (a pooled keep-alive
// socket stays pinned to one edge metal and can keep reading the stale body).
const freshConn = HttpClient.mapRequest(
  HttpClientRequest.setHeader("connection", "close"),
);

// Retry a freshly-deployed worker route until it answers 200 with a body that
// contains `expected` — rejecting both transient non-200s and the deploy stub.
const fetchReady = (url: string, expected: string) =>
  Effect.gen(function* () {
    const client = freshConn(yield* HttpClient.HttpClient);
    return yield* client.get(url).pipe(
      Effect.flatMap((r) =>
        r.status !== 200
          ? Effect.fail(new Error(`Worker not ready: ${r.status}`))
          : Effect.flatMap(r.text, (body) =>
              body.includes(DEPLOY_PLACEHOLDER) || !body.includes(expected)
                ? Effect.fail(new Error(`not ready: got ${body}`))
                : Effect.succeed(body),
            ),
      ),
      Effect.retry({ schedule: readinessSchedule, times: readinessRetries }),
    );
  });

/**
 * Effect-native container (`main`): the entrypoint Effect is bundled into a
 * generated image. Exercises both the container's RPC method (`/ping`) and an
 * HTTP round-trip to its port-3000 server (`/hello`).
 */
describe("effectful container (main)", () => {
  const stack = beforeAll(deploy(EffectfulStack), { timeout: HOOK_TIMEOUT });
  afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(EffectfulStack), {
    timeout: HOOK_TIMEOUT,
  });

  test.skipIf(!!process.env.NO_SLOW_TESTS)(
    "deploys, answers RPC, and serves over its TCP port",
    Effect.gen(function* () {
      const { url } = yield* stack;

      const pong = yield* fetchReady(`${url}/ping`, "pong");
      expect(pong).toBe("pong");

      const hello = yield* fetchReady(`${url}/hello`, "effectful container");
      expect(hello).toContain("effectful container");
    }).pipe(logLevel),
    { timeout: TEST_TIMEOUT },
  );
});

/**
 * External container (`context` / `dockerfile`): Alchemy builds the user's
 * Dockerfile against the context directory (here: nginx serving a static
 * page on port 80) and the DO proxies a request to it.
 */
describe("external container (context/dockerfile)", () => {
  const stack = beforeAll(deploy(ExternalStack), { timeout: HOOK_TIMEOUT });
  afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(ExternalStack), {
    timeout: HOOK_TIMEOUT,
  });

  test.skipIf(!!process.env.NO_SLOW_TESTS)(
    "builds the user Dockerfile and serves it over its TCP port",
    Effect.gen(function* () {
      const { url } = yield* stack;

      const hello = yield* fetchReady(`${url}/hello`, "external container");
      expect(hello).toContain("external container");
    }).pipe(logLevel),
    { timeout: TEST_TIMEOUT },
  );
});

/**
 * Remote container (`image`): Alchemy pulls the public `nginx:alpine` image
 * and re-pushes it to Cloudflare's registry without building anything; the DO
 * proxies a request to it.
 */
describe("remote container (image)", () => {
  const stack = beforeAll(deploy(RemoteStack), { timeout: HOOK_TIMEOUT });
  afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(RemoteStack), {
    timeout: HOOK_TIMEOUT,
  });

  test.skipIf(!!process.env.NO_SLOW_TESTS)(
    "pulls and re-pushes the remote image and serves it over its TCP port",
    Effect.gen(function* () {
      const { url } = yield* stack;

      const hello = yield* fetchReady(`${url}/hello`, "nginx");
      expect(hello).toContain("nginx");
    }).pipe(logLevel),
    { timeout: TEST_TIMEOUT },
  );
});
