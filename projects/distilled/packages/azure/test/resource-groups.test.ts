import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ResourceGroupNotFound, ResourceNotFound } from "../src/errors";
import {
  ResourceGroupsCreateOrUpdate,
  ResourceGroupsDelete,
  ResourceGroupsGet,
  ResourceGroupsList,
} from "../src/services/resources";
import { runEffect, testRunId } from "./setup";

const rgName = (name: string) => `distilled-azure-${name}-${testRunId}`;

// Non-existent identifier for unhappy path tests
const NON_EXISTENT_RG = "distilled-azure-nonexistent-00000000";

describe("ResourceGroups", () => {
  // ============================================================================
  // ResourceGroupsList
  // ============================================================================

  describe("ResourceGroupsList", () => {
    it("can list resource groups", { timeout: 30_000 }, async () => {
      const result = await runEffect(ResourceGroupsList({}));

      expect(result).toBeDefined();
      expect(Array.isArray(result.value)).toBe(true);
    });

    it(
      "can list resource groups with $top filter",
      { timeout: 30_000 },
      async () => {
        const result = await runEffect(ResourceGroupsList({ $top: 5 }));

        expect(result).toBeDefined();
        expect(Array.isArray(result.value)).toBe(true);
        if (result.value) {
          expect(result.value.length).toBeLessThanOrEqual(5);
        }
      },
    );
  });

  // ============================================================================
  // ResourceGroupsGet
  // ============================================================================

  describe("ResourceGroupsGet", () => {
    it(
      "error - NotFound for non-existent resource group",
      { timeout: 30_000 },
      async () => {
        const error: any = await runEffect(
          ResourceGroupsGet({
            resourceGroupName: NON_EXISTENT_RG,
          }).pipe(Effect.flip),
        );

        expect(
          error instanceof ResourceNotFound ||
            error instanceof ResourceGroupNotFound ||
            (error !== null &&
              typeof error === "object" &&
              "_tag" in error &&
              (error._tag === "NotFound" ||
                error._tag === "ResourceNotFound" ||
                error._tag === "ResourceGroupNotFound")),
        ).toBe(true);
      },
    );
  });

  // ============================================================================
  // ResourceGroupsCreateOrUpdate + ResourceGroupsDelete lifecycle
  // ============================================================================

  describe("create / delete lifecycle", () => {
    const testRgName = rgName("lifecycle");

    it(
      "can create and then delete a resource group",
      { timeout: 120_000 },
      async () => {
        // Create
        const created = await runEffect(
          ResourceGroupsCreateOrUpdate({
            resourceGroupName: testRgName,
            location: "eastus",
          }).pipe(
            Effect.ensuring(
              ResourceGroupsDelete({
                resourceGroupName: testRgName,
              }).pipe(Effect.ignore),
            ),
          ),
        );

        expect(created).toBeDefined();
        expect(created.name).toBe(testRgName);
        expect(created.location).toBe("eastus");
        expect(created.properties?.provisioningState).toBeDefined();
      },
    );
  });
});
