import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AuthorizationRolesControllerCreate } from "../src/operations/AuthorizationRolesControllerCreate.ts";
import { runEffect, testRunId } from "./setup.ts";

describe("AuthorizationRolesControllerCreate", () => {
  it("creates a new environment role", { timeout: 30_000 }, async () => {
    const slug = `role_happy_${testRunId}`;
    const role = await runEffect(
      AuthorizationRolesControllerCreate({
        slug,
        name: `Happy Role ${testRunId}`,
        description: "Test role created by distilled SDK tests",
      }),
    );

    expect(role).toBeDefined();
    expect(role.slug).toBe(slug);
    expect(typeof role.id).toBe("string");
    expect(typeof role.name).toBe("string");
    expect(["EnvironmentRole", "OrganizationRole"]).toContain(role.type);
    expect(typeof role.resource_type_slug).toBe("string");
    expect(Array.isArray(role.permissions)).toBe(true);
    expect(typeof role.created_at).toBe("string");
    expect(typeof role.updated_at).toBe("string");
  });

  it(
    "fails with BadRequest when required fields are missing",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationRolesControllerCreate({
          slug: "",
          name: "",
        }).pipe(Effect.flip),
      );

      expect(["BadRequest", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with NotFound when the resource_type_slug does not exist",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationRolesControllerCreate({
          slug: `role_missing_rt_${testRunId}`,
          name: `Missing RT ${testRunId}`,
          resource_type_slug: `does_not_exist_${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect(error._tag).toBe("NotFound");
    },
  );

  it(
    "fails with Forbidden when targeting a resource_type in a different tenant",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationRolesControllerCreate({
          slug: `role_forbidden_${testRunId}`,
          name: `Forbidden ${testRunId}`,
          resource_type_slug: "resource_type_01HFGZ6QYV0000000000000000",
        }).pipe(Effect.flip),
      );

      expect(["Forbidden", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with Conflict when creating a role with an existing slug",
    { timeout: 30_000 },
    async () => {
      const slug = `role_conflict_${testRunId}`;

      // Seed: create the role once.
      await runEffect(
        AuthorizationRolesControllerCreate({
          slug,
          name: `Conflict Seed ${testRunId}`,
        }),
      );

      // Re-create with the same slug → Conflict.
      const error = await runEffect(
        AuthorizationRolesControllerCreate({
          slug,
          name: `Conflict Dup ${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect(error._tag).toBe("Conflict");
    },
  );

  it(
    "fails with UnprocessableEntity when the slug is malformed",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        AuthorizationRolesControllerCreate({
          slug: "Not A Valid Slug!!",
          name: `Bad Slug ${testRunId}`,
        }).pipe(Effect.flip),
      );

      expect(error._tag).toBe("UnprocessableEntity");
    },
  );
});
