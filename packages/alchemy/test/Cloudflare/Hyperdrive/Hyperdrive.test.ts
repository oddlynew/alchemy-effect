import * as Cloudflare from "@/Cloudflare";
import { CloudflareEnvironment } from "@/Cloudflare/CloudflareEnvironment";
import * as Test from "@/Test/Vitest";
import * as hyperdrive from "@distilled.cloud/cloudflare/hyperdrive";
import { expect } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

const { test } = Test.make({ providers: Cloudflare.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// Cloudflare validates Hyperdrive origins not just by DNS lookup but by
// opening a TCP connection on the configured port and speaking the
// expected database protocol. Any placeholder host (example.com, a
// non-routable RFC1918 address, etc.) gets rejected with either
// "DNS lookup failed" or "Network connection … was refused". Running
// these tests requires a publicly-reachable Postgres origin we can
// hand to Cloudflare; the suite needs a dedicated fixture (e.g. a
// Neon project) wired up before this can be re-enabled. Until then,
// skip both cases so the rest of the live suite can stay green.
//
// TODO(hyperdrive): provision a Neon Project in beforeAll and use its
// connection string as the origin so this test exercises the real
// reconcile/update/delete path again.
const HYPERDRIVE_REQUIRES_REAL_ORIGIN = true;

const baseOrigin = {
  scheme: "postgres" as const,
  host: "example.com",
  port: 5432,
  database: "app",
  user: "app",
  password: Redacted.make("p4ssword!"),
};

const hyperdriveTest = test.provider.skipIf(HYPERDRIVE_REQUIRES_REAL_ORIGIN);

hyperdriveTest("create and delete hyperdrive with default props", (stack) =>
  Effect.gen(function* () {
    const { accountId } = yield* CloudflareEnvironment;

    yield* stack.destroy();

    const hd = yield* stack.deploy(
      Effect.gen(function* () {
        return yield* Cloudflare.Hyperdrive("DefaultHyperdrive", {
          origin: baseOrigin,
        });
      }),
    );

    expect(hd.hyperdriveId).toBeDefined();
    expect(hd.name).toBeDefined();

    const actual = yield* hyperdrive.getConfig({
      accountId,
      hyperdriveId: hd.hyperdriveId,
    });
    expect(actual.id).toEqual(hd.hyperdriveId);
    expect(actual.origin.host).toEqual(baseOrigin.host);

    yield* stack.destroy();

    yield* waitForConfigToBeDeleted(hd.hyperdriveId, accountId);
  }).pipe(logLevel),
);

hyperdriveTest("create, update, delete hyperdrive", (stack) =>
  Effect.gen(function* () {
    const { accountId } = yield* CloudflareEnvironment;

    yield* stack.destroy();

    const hd = yield* stack.deploy(
      Effect.gen(function* () {
        return yield* Cloudflare.Hyperdrive("UpdateHyperdrive", {
          origin: baseOrigin,
          caching: { disabled: false, maxAge: 60 },
        });
      }),
    );

    const updated = yield* stack.deploy(
      Effect.gen(function* () {
        return yield* Cloudflare.Hyperdrive("UpdateHyperdrive", {
          origin: baseOrigin,
          caching: { disabled: true },
        });
      }),
    );

    expect(updated.hyperdriveId).toEqual(hd.hyperdriveId);

    const actual = yield* hyperdrive.getConfig({
      accountId,
      hyperdriveId: updated.hyperdriveId,
    });
    // After PUT with `disabled: true`, caching should reflect the change.
    expect(actual.caching).toBeDefined();

    yield* stack.destroy();

    yield* waitForConfigToBeDeleted(hd.hyperdriveId, accountId);
  }).pipe(logLevel),
);

const waitForConfigToBeDeleted = Effect.fn(function* (
  hyperdriveId: string,
  accountId: string,
) {
  yield* hyperdrive.getConfig({ accountId, hyperdriveId }).pipe(
    Effect.flatMap(() => Effect.fail(new ConfigStillExists())),
    Effect.retry({
      while: (e): e is ConfigStillExists => e instanceof ConfigStillExists,
      schedule: Schedule.exponential(100),
    }),
    Effect.catchTag("HyperdriveConfigNotFound", () => Effect.void),
  );
});

class ConfigStillExists extends Data.TaggedError("ConfigStillExists") {}
