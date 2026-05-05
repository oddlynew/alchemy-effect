import { adopt } from "@/AdoptPolicy";
import * as Cloudflare from "@/Cloudflare";
import { CloudflareEnvironment } from "@/Cloudflare/CloudflareEnvironment";
import { State } from "@/State";
import * as Test from "@/Test/Vitest";
import {
  Credentials,
  apiTokenCredentials,
} from "@distilled.cloud/cloudflare/Credentials";
import * as secretsStore from "@distilled.cloud/cloudflare/secrets-store";
import { expect, it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { MinimumLogLevel } from "effect/References";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

/**
 * Test harness that captures the outbound `HttpClientRequest` and lets
 * the caller plug in a canned `Response`. The motivating regression
 * (Cloudflare's `secrets_store/stores` POST receiving an array body
 * and rejecting it with `invalid_json_body`) was invisible to the type
 * system because the upstream SDK schema modeled the body as
 * `{ name }[]`. The fix is to upgrade `@distilled.cloud/cloudflare` to
 * a release with the corrected single-object schema; these tests pin
 * the wire format so a future SDK regression is caught immediately.
 */
interface Captured {
  url: string;
  method: string;
  contentType: string | undefined;
  bodyJson: unknown;
  authorization: string | undefined;
}

const harness = (response: Response) => {
  let captured: Captured | undefined;
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = request.body as HttpBody.HttpBody;
      const bodyText =
        body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
      captured = {
        url: request.url,
        method: request.method,
        contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
        bodyJson: bodyText ? JSON.parse(bodyText) : undefined,
        authorization: request.headers.authorization,
      };
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  const layer = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(
      Credentials,
      Effect.succeed(apiTokenCredentials({ apiToken: "test-token" })),
    ),
  );
  return { layer, get: () => captured! };
};

const successResponse = () =>
  new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result: {
        id: "store-id-123",
        name: "default_secrets_store",
        created: "2026-01-01T00:00:00Z",
        modified: "2026-01-01T00:00:00Z",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const errorResponse = (
  status: number,
  errors: Array<{ code: number; message: string }>,
) =>
  new Response(
    JSON.stringify({ success: false, errors, messages: [], result: null }),
    { status, headers: { "content-type": "application/json" } },
  );

it.live(
  "createStore POSTs a single JSON object body (regression: invalid_json_body)",
  () =>
    Effect.gen(function* () {
      const { layer, get } = harness(successResponse());

      const result = yield* Effect.gen(function* () {
        const create = yield* secretsStore.createStore;
        return yield* create({
          accountId: "acct-abc",
          name: "default_secrets_store",
        });
      }).pipe(Effect.provide(layer));

      expect(result.id).toBe("store-id-123");
      expect(result.name).toBe("default_secrets_store");

      const sent = get();
      expect(sent.method).toBe("POST");
      expect(sent.url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/acct-abc/secrets_store/stores",
      );
      expect(sent.contentType).toMatch(/application\/json/);
      expect(sent.authorization).toBe("Bearer test-token");

      // Cloudflare's REST API expects `{"name": "..."}` and rejects
      // `[{"name": "..."}]` with code 1001 `invalid_json_body`.
      // Earlier `@distilled.cloud/cloudflare` releases sent the array
      // shape; this test pins the corrected single-object body.
      expect(sent.bodyJson).toEqual({ name: "default_secrets_store" });
      expect(Array.isArray(sent.bodyJson)).toBe(false);
    }),
);

it.live(
  "createStore surfaces MaximumStoresExceeded as a tagged error so callers can catchTag it",
  () =>
    Effect.gen(function* () {
      const { layer } = harness(
        errorResponse(409, [
          { code: 1003, message: "maximum_stores_exceeded" },
        ]),
      );

      const result = yield* Effect.gen(function* () {
        const create = yield* secretsStore.createStore;
        return yield* create({ accountId: "acct-abc", name: "x" }).pipe(
          Effect.catchTag("MaximumStoresExceeded", (e) => Effect.succeed(e)),
        );
      }).pipe(Effect.provide(layer));

      expect(result).toBeInstanceOf(secretsStore.MaximumStoresExceeded);
      const err = result as secretsStore.MaximumStoresExceeded;
      expect(err._tag).toBe("MaximumStoresExceeded");
      expect(err.message).toBe("maximum_stores_exceeded");
    }),
);

// ---------------------------------------------------------------------------
// Lifecycle convergence tests against the live Cloudflare API.
//
// SecretsStore is special: Cloudflare enforces one store per account, the
// store cannot be deleted via this engine, and `read` adopts the existing
// account store unconditionally. The mutable surface area lives on the
// `Secret` child resource. The tests below exercise:
//   - same-props redeploy is a no-op
//   - reconcile re-syncs scopes/comment after they're mutated out-of-band
//   - rotating a secret value triggers replace and bumps the secret id
//   - reconcile re-creates a secret deleted out-of-band
//   - changing the secret name triggers replace
//   - destroying an already-deleted secret is a no-op
//   - `adopt(true)` re-claims a name-matching secret created out-of-band
// ---------------------------------------------------------------------------

const { test } = Test.make({ providers: Cloudflare.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

const findSecretByName = Effect.fn(function* (
  accountId: string,
  storeId: string,
  name: string,
) {
  return yield* secretsStore.listStoreSecrets
    .items({ accountId, storeId })
    .pipe(
      Stream.filter((s) => s.name === name),
      Stream.runHead,
      Effect.map(Option.getOrUndefined),
    );
});

class SecretStillExists extends Data.TaggedError("SecretStillExists") {}

const assertSecretDeleted = Effect.fn(function* (
  accountId: string,
  storeId: string,
  secretId: string,
) {
  yield* secretsStore
    .getStoreSecret({ accountId, storeId, secretId })
    .pipe(
      Effect.flatMap(() => Effect.fail(new SecretStillExists())),
      Effect.retry({
        while: (e): e is SecretStillExists => e instanceof SecretStillExists,
        schedule: Schedule.exponential(100).pipe(
          Schedule.both(Schedule.recurs(8)),
        ),
      }),
      Effect.catchTag("SecretNotFound", () => Effect.void),
      Effect.catchTag("StoreNotFound", () => Effect.void),
      Effect.catchTag("NotFound", () => Effect.void),
    );
});

test.provider(
  "create, redeploy with same props, delete secret",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      const secretName = `alchemy-test-secret-noop-${randomSuffix()}`;
      const value = `value-${randomSuffix()}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("NoopSecret", {
            store,
            name: secretName,
            value: Redacted.make(value),
            comment: "first",
          });
        }),
      );

      expect(initial.secretName).toEqual(secretName);
      expect(initial.status).toMatch(/active|pending/);

      // Redeploy with byte-identical props. Should be an idempotent
      // reconcile: no replace, secret id stable.
      const redeployed = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("NoopSecret", {
            store,
            name: secretName,
            value: Redacted.make(value),
            comment: "first",
          });
        }),
      );

      expect(redeployed.secretId).toEqual(initial.secretId);
      expect(redeployed.storeId).toEqual(initial.storeId);

      yield* stack.destroy();
      yield* assertSecretDeleted(accountId, initial.storeId, initial.secretId);
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider(
  "reconcile resets comment/scopes mutated out-of-band",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      const secretName = `alchemy-test-secret-drift-${randomSuffix()}`;
      const secretValue = `v-${randomSuffix()}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("DriftSecret", {
            store,
            name: secretName,
            value: Redacted.make(secretValue),
            comment: "alchemy-managed",
            scopes: ["workers"],
          });
        }),
      );

      // Mutate out-of-band via the raw API.
      yield* secretsStore.patchStoreSecret({
        accountId,
        storeId: initial.storeId,
        secretId: initial.secretId,
        comment: "drifted-by-someone-else",
      });

      // Reconcile with the same desired props (byte-identical value so this
      // is an update, not a replace).
      const reconciled = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("DriftSecret", {
            store,
            name: secretName,
            value: Redacted.make(secretValue),
            comment: "alchemy-managed",
            scopes: ["workers"],
          });
        }),
      );

      // We can't read the value back, but the comment is observable —
      // the reconciler must have re-PATCHed it back to desired.
      const observed = yield* secretsStore.getStoreSecret({
        accountId,
        storeId: reconciled.storeId,
        secretId: reconciled.secretId,
      });
      expect(observed.comment).toEqual("alchemy-managed");
      // Same physical secret; reconcile not replace.
      expect(reconciled.secretId).toEqual(initial.secretId);

      yield* stack.destroy();
      yield* assertSecretDeleted(
        accountId,
        reconciled.storeId,
        reconciled.secretId,
      );
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider(
  "rotating value triggers replace; secretId changes and old secret is gone",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      const secretName = `alchemy-test-secret-rotate-${randomSuffix()}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("RotateSecret", {
            store,
            name: secretName,
            value: Redacted.make(`v1-${randomSuffix()}`),
          });
        }),
      );

      const rotated = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("RotateSecret", {
            store,
            name: secretName,
            value: Redacted.make(`v2-${randomSuffix()}`),
          });
        }),
      );

      // Replace ⇒ new secret id; the new secret carries the same name.
      expect(rotated.secretId).not.toEqual(initial.secretId);
      expect(rotated.secretName).toEqual(secretName);

      // Old secret id must no longer exist.
      yield* assertSecretDeleted(accountId, initial.storeId, initial.secretId);

      yield* stack.destroy();
      yield* assertSecretDeleted(accountId, rotated.storeId, rotated.secretId);
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider(
  "reconcile re-creates a secret deleted out-of-band",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      const secretName = `alchemy-test-secret-recreate-${randomSuffix()}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("RecreatedSecret", {
            store,
            name: secretName,
            value: Redacted.make(`v-${randomSuffix()}`),
          });
        }),
      );

      // Delete out-of-band.
      yield* secretsStore.deleteStoreSecret({
        accountId,
        storeId: initial.storeId,
        secretId: initial.secretId,
      });

      // Re-deploy with the same desired props. The reconciler observes
      // the secret missing (via getStoreSecret + listStoreSecrets fallback)
      // and re-creates it.
      const recreated = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("RecreatedSecret", {
            store,
            name: secretName,
            value: Redacted.make(`v-${randomSuffix()}`),
          });
        }),
      );

      expect(recreated.secretName).toEqual(secretName);
      // A fresh secret id is fine (Cloudflare generates a new id on create).
      const live = yield* findSecretByName(
        accountId,
        recreated.storeId,
        secretName,
      );
      expect(live?.id).toEqual(recreated.secretId);

      yield* stack.destroy();
      yield* assertSecretDeleted(
        accountId,
        recreated.storeId,
        recreated.secretId,
      );
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider(
  "changing secret name triggers replace; old name is deleted",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      const oldName = `alchemy-test-secret-rename-old-${randomSuffix()}`;
      const newName = `alchemy-test-secret-rename-new-${randomSuffix()}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("RenamedSecret", {
            store,
            name: oldName,
            value: Redacted.make("v"),
          });
        }),
      );
      expect(initial.secretName).toEqual(oldName);

      const renamed = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("RenamedSecret", {
            store,
            name: newName,
            value: Redacted.make("v"),
          });
        }),
      );

      expect(renamed.secretName).toEqual(newName);
      expect(renamed.secretId).not.toEqual(initial.secretId);

      // Old physical secret is gone.
      yield* assertSecretDeleted(accountId, initial.storeId, initial.secretId);

      yield* stack.destroy();
      yield* assertSecretDeleted(accountId, renamed.storeId, renamed.secretId);
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider(
  "destroying an already-deleted secret is a no-op",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      const secretName = `alchemy-test-secret-doubledelete-${randomSuffix()}`;

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const store = yield* Cloudflare.SecretsStore("Store");
          return yield* Cloudflare.Secret("DoubleDelete", {
            store,
            name: secretName,
            value: Redacted.make("v"),
          });
        }),
      );

      // Delete out-of-band first.
      yield* secretsStore.deleteStoreSecret({
        accountId,
        storeId: initial.storeId,
        secretId: initial.secretId,
      });

      // Engine destroy should be a no-op; SecretNotFound / NotFound are
      // caught by the Secret provider's `delete`.
      yield* stack.destroy();
      yield* assertSecretDeleted(accountId, initial.storeId, initial.secretId);
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider(
  "adopt(true) takes over a name-matching secret created out-of-band",
  (stack) =>
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;

      yield* stack.destroy();

      // Provision the store first via the engine so we have a storeId to
      // create the foreign secret in.
      const storeAttrs = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Cloudflare.SecretsStore("Store");
        }),
      );

      const secretName = `alchemy-test-secret-adopt-${randomSuffix()}`;

      // Create the secret out-of-band — the engine has never seen it.
      const created = yield* secretsStore.createStoreSecret({
        accountId,
        storeId: storeAttrs.storeId,
        body: [
          {
            name: secretName,
            value: "out-of-band-value",
            scopes: ["workers"],
          },
        ],
      });
      const foreignId = created.result[0]!.id;

      // Without `adopt(true)`, `read` returns Unowned and the engine
      // refuses; with `adopt(true)` the engine takes over and the
      // reconciler updates scopes/comment to the desired shape.
      const adopted = yield* stack
        .deploy(
          Effect.gen(function* () {
            const store = yield* Cloudflare.SecretsStore("Store");
            return yield* Cloudflare.Secret("ForeignSecret", {
              store,
              name: secretName,
              value: Redacted.make("out-of-band-value"),
              comment: "now-managed-by-alchemy",
            });
          }),
        )
        .pipe(adopt(true));

      // Same physical secret — adoption, not re-create.
      expect(adopted.secretId).toEqual(foreignId);
      expect(adopted.secretName).toEqual(secretName);

      const observed = yield* secretsStore.getStoreSecret({
        accountId,
        storeId: adopted.storeId,
        secretId: adopted.secretId,
      });
      expect(observed.comment).toEqual("now-managed-by-alchemy");

      // Confirm state was persisted under the engine's logical id.
      const persisted = yield* Effect.gen(function* () {
        const state = yield* State;
        return yield* state.get({
          stack: stack.name,
          stage: "test",
          fqn: "ForeignSecret",
        });
      }).pipe(Effect.provide(stack.state));
      expect(persisted?.attr).toMatchObject({
        secretId: foreignId,
        secretName,
      });

      yield* stack.destroy();
      yield* assertSecretDeleted(accountId, adopted.storeId, adopted.secretId);
    }).pipe(logLevel),
  { timeout: 120_000 },
);
