import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getService, getVariables } from "@distilled.cloud/railway";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import TestFunction, { GREETING_ENV_KEY } from "./fixtures/function.ts";

const { test } = Test.make({ providers: Railway.providers() });

/**
 * `Config.string(GREETING_ENV_KEY)` resolves against the active
 * ConfigProvider at deploy time. The default provider reads from
 * `process.env`, so populate it before `stack.deploy` compiles the
 * stack — proving the deploy-time → service variable → runtime
 * round-trip rather than the bundled default.
 */
const GREETING_VALUE = "hello-from-config";
process.env[GREETING_ENV_KEY] = GREETING_VALUE;

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

/**
 * Retry the first request through Railway's edge propagation — fresh
 * `*.up.railway.app` domains take a few seconds to start serving 200s.
 */
const getOk = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.flatMap((response) =>
      response.status === 200
        ? Effect.succeed(response)
        : Effect.fail(new Error(`${url} returned ${response.status}`)),
    ),
    Effect.tapError((error) => Effect.logError(error)),
    Effect.retry({
      schedule: Schedule.exponential(1000).pipe(
        Schedule.both(Schedule.recurs(12)),
      ),
    }),
  );

test.provider(
  "deploy, serve HTTP, update code, delete",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const { fn } = yield* stack.deploy(
        Effect.gen(function* () {
          const fn = yield* TestFunction;
          return { fn };
        }),
      );

      expect(fn.serviceId).toBeDefined();
      expect(fn.projectId).toBeDefined();
      expect(fn.environmentId).toBeDefined();
      expect(fn.deploymentId).toBeDefined();
      expect(fn.deploymentStatus).toEqual("SUCCESS");
      expect(fn.port).toEqual(3000);
      expect(fn.domain).toBeTruthy();
      expect(fn.url).toMatch(/^https:\/\//);
      expect(fn.code.hash).toBeDefined();

      // PORT + alchemy phase markers are reconciled onto the service.
      const variables = (yield* getVariables({
        projectId: fn.projectId,
        environmentId: fn.environmentId,
        serviceId: fn.serviceId,
      })) as Record<string, string>;
      expect(variables.PORT).toEqual("3000");
      expect(variables.ALCHEMY_PHASE).toEqual("runtime");
      // The Init-phase Config was captured and published as a variable.
      expect(variables[GREETING_ENV_KEY]).toBeDefined();

      // Drive the deployed program over HTTP — one route per behavior.
      const hello = yield* getOk(`${fn.url}/hello`);
      const helloBody = (yield* hello.json) as { message: string };
      expect(helloBody.message).toEqual("hello from railway");

      // effect/Config round-trip: the Init-phase `Config.string` was
      // captured at deploy time, published as a service variable, and
      // re-read from the container's environment at runtime.
      const greeting = yield* getOk(`${fn.url}/greeting`);
      const greetingBody = (yield* greeting.json) as { greeting: string };
      expect(greetingBody.greeting).toEqual(GREETING_VALUE);

      // Re-deploy with no changes — the code hash gates the upload, so
      // the same deployment remains in place.
      const { fn: unchanged } = yield* stack.deploy(
        Effect.gen(function* () {
          const fn = yield* TestFunction;
          return { fn };
        }),
      );
      expect(unchanged.serviceId).toEqual(fn.serviceId);
      expect(unchanged.code.hash).toEqual(fn.code.hash);

      yield* stack.destroy();

      // Railway soft-deletes: getService may still resolve the service
      // with `deletedAt` set, return NotAuthorized, or ProjectNotFound
      // once the containing project is gone — all of these mean deleted.
      const gone = yield* getService({ id: fn.serviceId }).pipe(
        Effect.map((service) => (service.deletedAt ? "deleted" : "exists")),
        Effect.catchTag("NotAuthorized", () => Effect.succeed("deleted")),
        Effect.catchTag("ProjectNotFound", () => Effect.succeed("deleted")),
      );
      expect(gone).toEqual("deleted");
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 1_800_000 },
);
