/**
 * Tests that `find_additional_modules` correctly discovers modules for
 * dynamic imports.
 *
 * When `find_additional_modules: true` is set in wrangler config, the
 * bundler scans the filesystem for modules matching module rules and
 * includes them as separate modules in the upload. This enables
 * dynamic imports like `import(\`./lang/${lang}.js\`)` to work at runtime.
 */
import * as Effect from "effect/Effect";
import * as fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { bundleWithDistilled } from "../harness/distilled-bundler.js";
import { loadFixture } from "../harness/fixture.js";
import { withRunner } from "../harness/miniflare-runner.js";
import type { BundleConfig, BundleResult } from "../harness/types.js";
import { bundleWithWrangler } from "../harness/wrangler-bundler.js";

describe("additional-modules", () => {
  let config: BundleConfig;
  let wranglerBundle: BundleResult;

  beforeAll(async () => {
    config = await Effect.runPromise(loadFixture("additional-modules"));
    wranglerBundle = await Effect.runPromise(bundleWithWrangler(config));
  });

  describe("wrangler baseline", () => {
    it("builds successfully", () => {
      expect(wranglerBundle.entryPoint).toBeTruthy();
      expect(wranglerBundle.bundleType).toBe("esm");
    });

    it("inlines dynamic import targets into the bundle", async () => {
      // When esbuild handles dynamic imports (import(`./lang/${lang}.js`)),
      // it inlines the modules using a __glob helper pattern rather than
      // emitting them as separate files. The find_additional_modules feature
      // ensures esbuild can discover the targets, but they end up bundled.
      const entryContent = fs.readFileSync(wranglerBundle.entryPoint, "utf-8");
      expect(entryContent).toContain("Hello");
      expect(entryContent).toContain("Bonjour");
    });

    it("dynamic import /lang/en returns English", async () => {
      await Effect.runPromise(
        withRunner({ bundle: wranglerBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/lang/en");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("Hello");
        }),
      );
    });

    it("dynamic import /lang/fr returns French", async () => {
      await Effect.runPromise(
        withRunner({ bundle: wranglerBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/lang/fr");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("Bonjour");
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

    it("inlines dynamic import targets into the bundle", () => {
      const entryContent = fs.readFileSync(distilledBundle.entryPoint, "utf-8");
      expect(entryContent).toContain("Hello");
      expect(entryContent).toContain("Bonjour");
    });

    it("dynamic import /lang/en returns English", async () => {
      await Effect.runPromise(
        withRunner({ bundle: distilledBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/lang/en");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("Hello");
        }),
      );
    });

    it("dynamic import /lang/fr returns French", async () => {
      await Effect.runPromise(
        withRunner({ bundle: distilledBundle, config }, async (runner) => {
          const res = await runner.fetch("http://localhost/lang/fr");
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("Bonjour");
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

    it("matches wrangler behavior for /lang/en", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const wranglerRes = yield* withRunner(
            { bundle: wranglerBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/lang/en");
              return { status: res.status, body: await res.text() };
            },
          );
          const distilledRes = yield* withRunner(
            { bundle: distilledBundle, config },
            async (r) => {
              const res = await r.fetch("http://localhost/lang/en");
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
