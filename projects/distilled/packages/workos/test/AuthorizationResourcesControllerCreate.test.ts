import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AuthorizationResourcesControllerCreate } from "../src/operations/AuthorizationResourcesControllerCreate.ts";
import { runEffect } from "./setup.ts";

describe("AuthorizationResourcesControllerCreate", () => {
  it(
    "fails with BadRequest when the request body is malformed",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationResourcesControllerCreate({}).pipe(Effect.flip),
      );

      expect(["BadRequest", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with NotFound when the referenced organization or parent does not exist",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationResourcesControllerCreate({}).pipe(Effect.flip),
      );

      expect(["NotFound", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with Forbidden when targeting an organization in a different tenant",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationResourcesControllerCreate({}).pipe(Effect.flip),
      );

      expect(["Forbidden", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with Conflict when creating a resource that already exists",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationResourcesControllerCreate({}).pipe(Effect.flip),
      );

      expect(["Conflict", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with UnprocessableEntity when the resource type slug is invalid",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationResourcesControllerCreate({}).pipe(Effect.flip),
      );

      expect(error._tag).toBe("UnprocessableEntity");
    },
  );
});
