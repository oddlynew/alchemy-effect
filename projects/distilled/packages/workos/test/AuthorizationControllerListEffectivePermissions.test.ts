import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AuthorizationControllerListEffectivePermissions } from "../src/operations/AuthorizationControllerListEffectivePermissions.ts";
import { runEffect, runOrSkipOnEnvLimitation, testRunId } from "./setup.ts";

describe("AuthorizationControllerListEffectivePermissions", () => {
  it(
    "lists effective permissions for an organization membership on a resource",
    { timeout: 30_000 },
    async (ctx) => {
      const result = await runOrSkipOnEnvLimitation(
        ctx,
        AuthorizationControllerListEffectivePermissions({
          organization_membership_id: `om_${testRunId}`,
          resource_id: `resource_${testRunId}`,
          limit: 10,
        }),
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.list_metadata).toBeDefined();
    },
  );

  it(
    "fails with NotFound for a non-existent organization membership id",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationControllerListEffectivePermissions({
          organization_membership_id: `om_does_not_exist_${testRunId}`,
          resource_id: `resource_${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect(error._tag).toBe("NotFound");
    },
  );

  it(
    "fails with Forbidden when the membership belongs to a different tenant",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationControllerListEffectivePermissions({
          organization_membership_id: "om_01HFGZ6QYV0000000000000000",
          resource_id: "resource_01HFGZ6QYV0000000000000000",
        }).pipe(Effect.flip),
      );

      expect(["Forbidden", "NotFound"]).toContain(error._tag);
    },
  );

  it(
    "fails with UnprocessableEntity when the membership id is malformed",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationControllerListEffectivePermissions({
          organization_membership_id: `not-a-real-id-${testRunId}`,
          resource_id: `resource_${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect(["NotFound", "UnprocessableEntity"]).toContain(error._tag);
    },
  );
});
