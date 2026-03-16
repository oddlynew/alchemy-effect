/**
 * Tests that `find_additional_modules` correctly discovers modules for
 * dynamic imports.
 *
 * When `find_additional_modules: true` is set in wrangler config, the
 * bundler scans the filesystem for modules matching module rules and
 * includes them as separate modules in the upload. This enables
 * dynamic imports like `import(\`./lang/${lang}.js\`)` to work at runtime.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { bundleWithEsbuild } from "../harness/esbuild-bundler.js";
import { bundleWithRolldown } from "../harness/rolldown-bundler.js";
import { bundleWithRspack } from "../harness/rspack-bundler.js";
import { loadFixture } from "../harness/fixture.js";
import { withRunner } from "../harness/miniflare-runner.js";
import type { BundleConfig, BundleResult } from "../harness/types.js";
import { bundleWithWrangler } from "../harness/wrangler-bundler.js";

describe("additional-modules", () => {
  let config: BundleConfig;

  it.beforeAll(async () => {
    config = await Effect.runPromise(loadFixture("additional-modules"));
  });

  describe.each([
    {
      name: "wrangler",
      bundler: bundleWithWrangler,
    },
    {
      name: "esbuild",
      bundler: bundleWithEsbuild,
    },
      {
        name: "rolldown",
        bundler: bundleWithRolldown,
      },
      {
        name: "rspack",
        bundler: bundleWithRspack,
      },
  ])("$name", ({ bundler }) => {
    let bundle: BundleResult;

    it.beforeAll(async () => {
      bundle = await Effect.runPromise(bundler(config));
    });

    it("builds successfully", () => {
      expect(bundle.main).toBeTruthy();
      expect(bundle.type).toBe("esm");
    });

    it("makes dynamic import targets available to the worker", async () => {
      const entryContent = await fs.readFile(bundle.main, "utf-8");
      if (entryContent.includes("Hello") && entryContent.includes("Bonjour")) {
        return;
      }

      await expect(fs.readFile(path.join(bundle.outputDir, "lang", "en.js"), "utf-8")).resolves.toContain(
        "Hello",
      );
      await expect(fs.readFile(path.join(bundle.outputDir, "lang", "fr.js"), "utf-8")).resolves.toContain(
        "Bonjour",
      );
    });

    it.effect("dynamic import /lang/en returns English", () =>
      withRunner({ bundle, config }, async (runner) => {
        const res = await runner.fetch("http://localhost/lang/en");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("Hello");
      }),
    );

    it.effect("dynamic import /lang/fr returns French", () =>
      withRunner({ bundle, config }, async (runner) => {
        const res = await runner.fetch("http://localhost/lang/fr");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("Bonjour");
      }),
    );

    it.effect("responds to fetch /", () =>
      withRunner({ bundle, config }, async (runner) => {
        const res = await runner.fetch("http://localhost/");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("ok");
      }),
    );
  });
});
