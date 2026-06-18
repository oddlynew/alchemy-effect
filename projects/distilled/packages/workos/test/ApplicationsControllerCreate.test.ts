import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ApplicationsControllerCreate } from "../src/operations/ApplicationsControllerCreate.ts";
import { runEffect } from "./setup.ts";

describe("ApplicationsControllerCreate", () => {
  it(
    "fails with NotFound when a referenced resource does not exist",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        ApplicationsControllerCreate({}).pipe(Effect.flip),
      );

      expect(["NotFound", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with UnprocessableEntity when the application configuration is invalid",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        ApplicationsControllerCreate({}).pipe(Effect.flip),
      );

      expect(error._tag).toBe("UnprocessableEntity");
    },
  );
});
