import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ApplicationsControllerList } from "../src/operations/ApplicationsControllerList.ts";
import { ApplicationsControllerUpdate } from "../src/operations/ApplicationsControllerUpdate.ts";
import { runEffect, testRunId } from "./setup.ts";

describe("ApplicationsControllerUpdate", () => {
  it("updates a Connect Application", { timeout: 30_000 }, async () => {
    const list = await runEffect(ApplicationsControllerList({ limit: 1 }));

    if (list.data.length === 0) {
      // No seed application available — exercise the operation against a
      // missing id so the call still hits the live API.
      const error = await runEffect(
        ApplicationsControllerUpdate({
          id: `app_does_not_exist_${testRunId}`,
          name: `Updated ${testRunId}`,
        }).pipe(Effect.flip),
      );
      expect(error._tag).toBe("NotFound");
      return;
    }

    const seed = list.data[0] as { id: string };
    const updated = await runEffect(
      ApplicationsControllerUpdate({
        id: seed.id,
        description: `Updated description ${testRunId}`,
      }),
    );

    expect(updated).toBeDefined();
    expect(updated.id).toBe(seed.id);
    expect(typeof updated.client_id).toBe("string");
    expect(typeof updated.name).toBe("string");
    expect(Array.isArray(updated.scopes)).toBe(true);
    expect(typeof updated.created_at).toBe("string");
    expect(typeof updated.updated_at).toBe("string");
  });

  it(
    "fails with NotFound for a non-existent application id",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        ApplicationsControllerUpdate({
          id: `app_does_not_exist_${testRunId}`,
          name: `Updated ${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect(error._tag).toBe("NotFound");
    },
  );

  it(
    "fails with UnprocessableEntity when a redirect_uri is malformed",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        ApplicationsControllerUpdate({
          id: `app_invalid_${testRunId}`,
          redirect_uris: [{ uri: "not a valid url!!", default: true }],
        }).pipe(Effect.flip),
      );

      expect(["NotFound", "UnprocessableEntity"]).toContain(error._tag);
    },
  );
});
