/**
 * Tests that `cloudflare:*` imports are correctly externalized.
 *
 * Workers that import from `cloudflare:workers` (DurableObject, etc.) or
 * `cloudflare:sockets` must have those imports preserved in the bundle output
 * as external imports — they're provided by the Workers runtime.
 */
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleWithDistilled } from "../harness/distilled-bundler.js";
import { loadFixture } from "../harness/fixture.js";
import { type RunningWorker, withRunner } from "../harness/miniflare-runner.js";
import type { BundleConfig, BundleResult } from "../harness/types.js";
import { bundleWithWrangler } from "../harness/wrangler-bundler.js";

describe("cloudflare-externals", () => {
  let config: BundleConfig;
  let wranglerBundle: BundleResult;

  beforeAll(async () => {
    config = await Effect.runPromise(loadFixture("cloudflare-externals"));
    wranglerBundle = await Effect.runPromise(bundleWithWrangler(config));
  });

  describe("wrangler baseline", () => {
    it("builds successfully", () => {
      expect(wranglerBundle.entryPoint).toBeTruthy();
      expect(wranglerBundle.bundleType).toBe("esm");
    });

    it("responds to fetch /", async () => {
      await Effect.runPromise(
        withRunner({ bundle: wranglerBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("ok");
        }),
      );
    });

    it("responds to fetch /do (durable object)", async () => {
      await Effect.runPromise(
        withRunner({ bundle: wranglerBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/do");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("durable object ok");
        }),
      );
    });
  });

  describe("distilled-bundler", () => {
    let distilledBundle: BundleResult;

    beforeAll(async () => {
      distilledBundle = await Effect.runPromise(bundleWithDistilled(config));
    });

    it("builds successfully with ESM output", () => {
      expect(distilledBundle.entryPoint).toBeTruthy();
      expect(distilledBundle.bundleType).toBe("esm");
    });

    it("output file exists on disk", () => {
      expect(fs.existsSync(distilledBundle.entryPoint)).toBe(true);
    });

    it("preserves cloudflare:* imports as external", () => {
      const code = fs.readFileSync(distilledBundle.entryPoint, "utf-8");
      // cloudflare:workers should appear as an import, not inlined
      expect(code).toContain("cloudflare:workers");
    });

    it("responds to fetch /", async () => {
      await Effect.runPromise(
        withRunner({ bundle: distilledBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("ok");
        }),
      );
    });

    it("responds to fetch /do (durable object)", async () => {
      await Effect.runPromise(
        withRunner({ bundle: distilledBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/do");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("durable object ok");
        }),
      );
    });

    it("matches wrangler behavior for /", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wranglerRes = yield* withRunner(
            { bundle: wranglerBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/");
              return { status: res.status, body: await res.text() };
            },
          );
          const distilledRes = yield* withRunner(
            { bundle: distilledBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/");
              return { status: res.status, body: await res.text() };
            },
          );
          expect(distilledRes.status).toBe(wranglerRes.status);
          expect(distilledRes.body).toBe(wranglerRes.body);
        }),
      );
    });

    it("matches wrangler behavior for /do", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wranglerRes = yield* withRunner(
            { bundle: wranglerBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/do");
              return { status: res.status, body: await res.text() };
            },
          );
          const distilledRes = yield* withRunner(
            { bundle: distilledBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/do");
              return { status: res.status, body: await res.text() };
            },
          );
          expect(distilledRes.status).toBe(wranglerRes.status);
          expect(distilledRes.body).toBe(wranglerRes.body);
        }),
      );
    });
  });
});
