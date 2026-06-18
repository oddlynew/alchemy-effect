import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { OrganizationsControllerCreate } from "../src/operations/OrganizationsControllerCreate.ts";
import { OrganizationsControllerDeleteOrganization } from "../src/operations/OrganizationsControllerDeleteOrganization.ts";
import { OrganizationsControllerUpdateOrganization } from "../src/operations/OrganizationsControllerUpdateOrganization.ts";
import { runEffect, testRunId } from "./setup.ts";

describe("OrganizationsControllerUpdateOrganization", () => {
  it("updates an organization name", { timeout: 60_000 }, async () => {
    const initialName = `distilled-workos-orgs-update-${testRunId}`;
    const updatedName = `distilled-workos-orgs-updated-${testRunId}`;
    const result = await runEffect(
      Effect.gen(function* () {
        const created = yield* OrganizationsControllerCreate({
          name: initialName,
        });
        return yield* OrganizationsControllerUpdateOrganization({
          id: created.id,
          name: updatedName,
        }).pipe(
          Effect.ensuring(
            OrganizationsControllerDeleteOrganization({
              id: created.id,
            }).pipe(Effect.ignore),
          ),
        );
      }),
    );
    expect(result).toBeDefined();
    expect(result.name).toBe(updatedName);
    expect(typeof result.id).toBe("string");
    expect(typeof result.created_at).toBe("string");
    expect(typeof result.updated_at).toBe("string");
  });

  it(
    "fails with NotFound for a non-existent organization id",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        OrganizationsControllerUpdateOrganization({
          id: `organization_does_not_exist_${testRunId}`,
          name: `distilled-workos-orgs-404-${testRunId}`,
        }).pipe(Effect.flip),
      );
      expect(error._tag).toBe("NotFound");
    },
  );

  it(
    "fails with Forbidden when updating an organization in a different tenant",
    { timeout: 30_000 },
    async () => {
      const error = await runEffect(
        OrganizationsControllerUpdateOrganization({
          id: "org_01HFGZ6QYV0000000000000000",
          name: `distilled-workos-orgs-403-${testRunId}`,
        }).pipe(Effect.flip),
      );
      expect(["Forbidden", "NotFound"]).toContain(error._tag);
    },
  );

  it(
    "fails with BadRequest for an empty name",
    { timeout: 60_000 },
    async () => {
      const error = await runEffect(
        Effect.gen(function* () {
          const created = yield* OrganizationsControllerCreate({
            name: `distilled-workos-orgs-400-${testRunId}`,
          });
          return yield* OrganizationsControllerUpdateOrganization({
            id: created.id,
            name: "",
          }).pipe(
            Effect.ensuring(
              OrganizationsControllerDeleteOrganization({
                id: created.id,
              }).pipe(Effect.ignore),
            ),
          );
        }).pipe(Effect.flip),
      );
      expect(["BadRequest", "UnprocessableEntity"]).toContain(error._tag);
    },
  );

  it(
    "fails with Conflict when updating to an already-used external_id",
    { timeout: 60_000 },
    async () => {
      const error = await runEffect(
        Effect.gen(function* () {
          const externalId = `distilled-ext-update-${testRunId}`;
          const first = yield* OrganizationsControllerCreate({
            name: `distilled-workos-orgs-conflict-a-${testRunId}`,
            external_id: externalId,
          });
          const second = yield* OrganizationsControllerCreate({
            name: `distilled-workos-orgs-conflict-b-${testRunId}`,
          });
          return yield* OrganizationsControllerUpdateOrganization({
            id: second.id,
            external_id: externalId,
          }).pipe(
            Effect.ensuring(
              OrganizationsControllerDeleteOrganization({
                id: second.id,
              }).pipe(Effect.ignore),
            ),
            Effect.ensuring(
              OrganizationsControllerDeleteOrganization({
                id: first.id,
              }).pipe(Effect.ignore),
            ),
          );
        }).pipe(Effect.flip),
      );
      expect(["BadRequest", "Conflict"]).toContain(error._tag);
    },
  );

  it(
    "fails with UnprocessableEntity for duplicate domains in domain_data",
    { timeout: 60_000 },
    async () => {
      const error = await runEffect(
        Effect.gen(function* () {
          const created = yield* OrganizationsControllerCreate({
            name: `distilled-workos-orgs-422-${testRunId}`,
          });
          return yield* OrganizationsControllerUpdateOrganization({
            id: created.id,
            domain_data: [
              {
                domain: `distilled-dup-${testRunId}.example.com`,
                state: "verified",
              },
              {
                domain: `distilled-dup-${testRunId}.example.com`,
                state: "verified",
              },
            ],
          }).pipe(
            Effect.ensuring(
              OrganizationsControllerDeleteOrganization({
                id: created.id,
              }).pipe(Effect.ignore),
            ),
          );
        }).pipe(Effect.flip),
      );
      expect(error._tag).toBe("UnprocessableEntity");
    },
  );
});
