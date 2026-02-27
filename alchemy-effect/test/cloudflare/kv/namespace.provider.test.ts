import { Account } from "@/Cloudflare/Account.ts";
import { CloudflareApi } from "@/Cloudflare/CloudflareApi.ts";
import * as KV from "@/Cloudflare/KV/index.ts";
import * as CloudflareLive from "@/Cloudflare/Live.ts";
import { apply, destroy } from "@/index.ts";
import { test } from "@/Test/Vitest.ts";
import { expect } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

test(
  "create, update, delete namespace",
  Effect.gen(function* () {
    const api = yield* CloudflareApi;
    const accountId = yield* Account;

    yield* destroy();

    {
      class TestNamespace extends KV.Namespace("TestNamespace", {
        title: "test-namespace-initial",
      }) {}

      const stack = yield* apply(TestNamespace);

      const actualNamespace = yield* api.kv.namespaces.get(
        stack.TestNamespace.namespaceId,
        {
          account_id: accountId,
        },
      );
      expect(actualNamespace.id).toEqual(stack.TestNamespace.namespaceId);
      expect(actualNamespace.title).toEqual(stack.TestNamespace.title);
    }

    class TestNamespace extends KV.Namespace("TestNamespace", {
      title: "test-namespace-updated",
    }) {}

    const stack = yield* apply(TestNamespace);

    const actualNamespace = yield* api.kv.namespaces.get(
      stack.TestNamespace.namespaceId,
      {
        account_id: accountId,
      },
    );
    expect(actualNamespace.title).toEqual("test-namespace-updated");
    expect(actualNamespace.id).toEqual(stack.TestNamespace.namespaceId);

    yield* destroy();

    yield* waitForNamespaceToBeDeleted(
      stack.TestNamespace.namespaceId,
      accountId,
    );
  }).pipe(Effect.provide(CloudflareLive.default), logLevel),
);

const waitForNamespaceToBeDeleted = Effect.fn(function* (
  namespaceId: string,
  accountId: string,
) {
  const api = yield* CloudflareApi;
  yield* api.kv.namespaces
    .get(namespaceId, {
      account_id: accountId,
    })
    .pipe(
      Effect.flatMap(() => Effect.fail(new NamespaceStillExists())),
      Effect.retry({
        while: (e): e is NamespaceStillExists =>
          e instanceof NamespaceStillExists,
        schedule: Schedule.exponential(100),
      }),
      Effect.catchTag("NotFound", () => Effect.void),
    );
});

class NamespaceStillExists extends Data.TaggedError("NamespaceStillExists") {}
