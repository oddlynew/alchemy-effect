import { adopt } from "@/AdoptPolicy";
import * as AWS from "@/AWS";
import { PermissionSet } from "@/AWS/IdentityCenter";
import { listInstances } from "@/AWS/IdentityCenter/common";
import * as Test from "@/Test/Vitest";
import * as ssoAdmin from "@distilled.cloud/aws/sso-admin";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

const runLive =
  process.env.ALCHEMY_RUN_LIVE_AWS_IDENTITY_CENTER_TESTS === "true";

const { test } = Test.make({ providers: AWS.providers() });

const resolveInstanceArn = Effect.gen(function* () {
  const instances = yield* listInstances();
  const instance = instances.find((i) => i.InstanceArn);
  if (!instance?.InstanceArn) {
    return yield* Effect.fail(
      new Error("No IAM Identity Center instance available for tests"),
    );
  }
  return instance.InstanceArn;
});

test.provider.skipIf(!runLive)(
  "redeploy with same props is a no-op (reconcile is idempotent)",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const suffix = Math.random().toString(36).slice(2, 8);
      const name = `alchemy-test-ps-idempotent-${suffix}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("IdempotentPS", {
            name,
            description: "alchemy idempotent test",
            sessionDuration: "PT1H",
            tags: { env: "test" },
          });
        }),
      );

      const second = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("IdempotentPS", {
            name,
            description: "alchemy idempotent test",
            sessionDuration: "PT1H",
            tags: { env: "test" },
          });
        }),
      );

      expect(second.permissionSetArn).toEqual(initial.permissionSetArn);
      expect(second.name).toEqual(initial.name);

      yield* stack.destroy();
    }),
  { timeout: 180_000 },
);

test.provider.skipIf(!runLive)(
  "reconcile resets description and relayState mutated out-of-band",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const suffix = Math.random().toString(36).slice(2, 8);
      const name = `alchemy-test-ps-drift-${suffix}`;

      const ps = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("DriftPS", {
            name,
            description: "alchemy desired description",
            sessionDuration: "PT2H",
            relayState: "https://desired.example.com/",
          });
        }),
      );

      // Mutate description and relayState out-of-band.
      yield* ssoAdmin.updatePermissionSet({
        InstanceArn: ps.instanceArn,
        PermissionSetArn: ps.permissionSetArn,
        Description: "drifted description",
        SessionDuration: "PT2H",
        RelayState: "https://drifted.example.com/",
      });

      // Re-deploy with the original desired state — reconcile must
      // diff against observed cloud state and reset the drifted fields.
      yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("DriftPS", {
            name,
            description: "alchemy desired description",
            sessionDuration: "PT2H",
            relayState: "https://desired.example.com/",
          });
        }),
      );

      const observed = yield* ssoAdmin.describePermissionSet({
        InstanceArn: ps.instanceArn,
        PermissionSetArn: ps.permissionSetArn,
      });
      expect(observed.PermissionSet?.Description).toEqual(
        "alchemy desired description",
      );
      expect(observed.PermissionSet?.RelayState).toEqual(
        "https://desired.example.com/",
      );

      yield* stack.destroy();
    }),
  { timeout: 180_000 },
);

test.provider.skipIf(!runLive)(
  "changing name triggers replace, old permission set is deleted",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const suffix = Math.random().toString(36).slice(2, 8);
      const nameA = `alchemy-test-ps-replace-a-${suffix}`;
      const nameB = `alchemy-test-ps-replace-b-${suffix}`;

      const a = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("ReplacePS", {
            name: nameA,
          });
        }),
      );
      expect(a.name).toEqual(nameA);

      const b = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("ReplacePS", {
            name: nameB,
          });
        }),
      );
      expect(b.name).toEqual(nameB);
      expect(b.permissionSetArn).not.toEqual(a.permissionSetArn);

      // The old permission set must be gone after replace.
      const oldGone = yield* ssoAdmin
        .describePermissionSet({
          InstanceArn: a.instanceArn,
          PermissionSetArn: a.permissionSetArn,
        })
        .pipe(Effect.option);
      expect(oldGone._tag).toBe("None");

      yield* stack.destroy();
    }),
  { timeout: 180_000 },
);

test.provider.skipIf(!runLive)(
  "destroying an already-deleted permission set is a no-op",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const suffix = Math.random().toString(36).slice(2, 8);
      const name = `alchemy-test-ps-double-destroy-${suffix}`;

      const ps = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* PermissionSet("DoubleDestroyPS", {
            name,
          });
        }),
      );

      // Out-of-band: scrub the permission set entirely. The provider's
      // delete must catch `ResourceNotFoundException` and complete
      // cleanly.
      yield* ssoAdmin
        .deletePermissionSet({
          InstanceArn: ps.instanceArn,
          PermissionSetArn: ps.permissionSetArn,
        })
        .pipe(Effect.option);

      yield* stack.destroy();
    }),
  { timeout: 180_000 },
);

test.provider.skipIf(!runLive)(
  "adopt(true) re-tags a foreign permission set",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();
      const suffix = Math.random().toString(36).slice(2, 8);
      const foreignName = `alchemy-test-ps-takeover-${suffix}`;

      // Pre-create out-of-band (no alchemy tags) so the engine sees it
      // as foreign on the next `read`.
      const instanceArn = yield* resolveInstanceArn;
      const created = yield* ssoAdmin.createPermissionSet({
        InstanceArn: instanceArn,
        Name: foreignName,
        Description: "foreign — created without alchemy ownership",
        SessionDuration: "PT1H",
      });
      const foreignArn = created.PermissionSet?.PermissionSetArn!;
      // Best-effort cleanup if the test crashes mid-flight.
      yield* Effect.addFinalizer(() =>
        ssoAdmin
          .deletePermissionSet({
            InstanceArn: instanceArn,
            PermissionSetArn: foreignArn,
          })
          .pipe(Effect.option, Effect.asVoid),
      ).pipe(Effect.scoped);

      const takenOver = yield* stack
        .deploy(
          Effect.gen(function* () {
            return yield* PermissionSet("Adopted", {
              name: foreignName,
              description: "alchemy-managed after takeover",
            });
          }),
        )
        .pipe(adopt(true));

      expect(takenOver.permissionSetArn).toEqual(foreignArn);

      // After adoption, tags must identify this stack/stage/id.
      const tags = yield* ssoAdmin.listTagsForResource({
        InstanceArn: instanceArn,
        ResourceArn: foreignArn,
      });
      const tagMap = Object.fromEntries(
        (tags.Tags ?? []).map((t) => [t.Key, t.Value]),
      );
      expect(tagMap["alchemy::id"]).toEqual("Adopted");

      // Description must converge to the desired value.
      const observed = yield* ssoAdmin.describePermissionSet({
        InstanceArn: instanceArn,
        PermissionSetArn: foreignArn,
      });
      expect(observed.PermissionSet?.Description).toEqual(
        "alchemy-managed after takeover",
      );

      yield* stack.destroy();
    }),
  { timeout: 180_000 },
);
