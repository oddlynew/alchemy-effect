import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AuthorizationRoleAssignmentsControllerListRoleAssignments } from "../src/operations/AuthorizationRoleAssignmentsControllerListRoleAssignments.ts";
import { runEffect, runOrSkipOnEnvLimitation, testRunId } from "./setup.ts";

describe("AuthorizationRoleAssignmentsControllerListRoleAssignments", () => {
  it(
    "lists role assignments for an organization membership",
    { timeout: 30_000 },
    async (ctx) => {
      const result = await runOrSkipOnEnvLimitation(
        ctx,
        AuthorizationRoleAssignmentsControllerListRoleAssignments({
          organization_membership_id: `om_${testRunId}`,
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
        AuthorizationRoleAssignmentsControllerListRoleAssignments({
          organization_membership_id: `om_does_not_exist_${testRunId}`,
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
        AuthorizationRoleAssignmentsControllerListRoleAssignments({
          organization_membership_id: "om_01HFGZ6QYV0000000000000000",
        }).pipe(Effect.flip),
      );

      expect(["Forbidden", "NotFound"]).toContain(error._tag);
    },
  );
});
