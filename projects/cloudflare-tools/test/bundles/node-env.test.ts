/**
 * Tests that `process.env.NODE_ENV` is correctly replaced via esbuild's `define`.
 *
 * Wrangler replaces `process.env.NODE_ENV` with "production" during deploy
 * (--dry-run counts as deploy context). This enables tree-shaking of
 * development-only code paths (e.g., React dev warnings).
 */
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleWithDistilled } from "../harness/distilled-bundler.js";
import { loadFixture } from "../harness/fixture.js";
import { withRunner } from "../harness/miniflare-runner.js";
import type { BundleConfig, BundleResult } from "../harness/types.js";
import { bundleWithWrangler } from "../harness/wrangler-bundler.js";

describe("node-env", () => {
  let config: BundleConfig;
  let wranglerBundle: BundleResult;

  beforeAll(async () => {
    config = await Effect.runPromise(loadFixture("node-env"));
    wranglerBundle = await Effect.runPromise(bundleWithWrangler(config));
  });

  describe("wrangler baseline", () => {
    it("builds successfully", () => {
      expect(wranglerBundle.entryPoint).toBeTruthy();
      expect(wranglerBundle.bundleType).toBe("esm");
    });

    it("replaces process.env.NODE_ENV with 'production'", async () => {
      await Effect.runPromise(
        withRunner({ bundle: wranglerBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/node-env");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("production");
        }),
      );
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

    it("inlines process.env.NODE_ENV as 'production' in output", () => {
      const code = fs.readFileSync(distilledBundle.entryPoint, "utf-8");
      // The define replacement should have inlined the value —
      // process.env.NODE_ENV should NOT appear literally in the output
      expect(code).not.toContain("process.env.NODE_ENV");
      expect(code).toContain('"production"');
    });

    it("replaces process.env.NODE_ENV with 'production'", async () => {
      await Effect.runPromise(
        withRunner({ bundle: distilledBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/node-env");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("production");
        }),
      );
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

    it("matches wrangler behavior for /node-env", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wranglerRes = yield* withRunner(
            { bundle: wranglerBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/node-env");
              return { status: res.status, body: await res.text() };
            },
          );
          const distilledRes = yield* withRunner(
            { bundle: distilledBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/node-env");
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
