import { createMiniflareFromRolldown } from "@oddlynew/distilled-test-utils/miniflare";
import { describe, expect, it } from "vitest";
import { buildFixture } from "./utils/build-fixture";

describe("regression", () => {
  it.skipIf(!process.env.TEST_MYSQL_URL)("bundles mysql2", async () => {
    const pluginOptions = {
      compatibilityDate: "2025-07-01",
      compatibilityFlags: ["nodejs_compat"],
    };
    const built = await buildFixture({
      fixture: "regression/mysql2",
      pluginOptions,
    });
    await using miniflare = await createMiniflareFromRolldown(built.output, {
      ...pluginOptions,
      bindings: {
        DATABASE_URL: process.env.TEST_MYSQL_URL,
      },
    });
    expect(await miniflare.fetchJson<{ sql: string }>("/")).toMatchObject({ sql: "SELECT 1" });
  });
});
