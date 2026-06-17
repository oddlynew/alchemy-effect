import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Neon from "alchemy/Neon";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import Stack from "../alchemy.run.ts";
import { TodoRpcs } from "../src/backend/rpc.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(
    Cloudflare.providers(),
    Drizzle.providers(),
    Neon.providers(),
  ),
  state: Alchemy.localState(),
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack));

// Fresh workers.dev URLs take a few seconds to start answering.
const coldStartRetry = Effect.retry({
  schedule: Schedule.spaced("500 millis").pipe(
    Schedule.both(Schedule.recurs(20)),
  ),
});

test(
  "deploys and exposes urls + db identifiers",
  Effect.gen(function* () {
    const { websiteUrl, backendUrl, branchId, hyperdriveId } = yield* stack;
    expect(websiteUrl).toBeString();
    expect(backendUrl).toBeString();
    expect(branchId).toBeString();
    expect(hyperdriveId).toBeString();
  }),
  { timeout: 180_000 },
);

test(
  "todo CRUD round-trips through the /rpc proxy into Drizzle/Neon",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const rpcUrl = new URL("/rpc", websiteUrl).toString();

    yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(TodoRpcs);

      // Cold-start the worker on the first call.
      yield* client.listTodos().pipe(coldStartRetry);

      const created = yield* client.createTodo({ text: "write the example" });
      expect(created.id).toBeNumber();
      expect(created.text).toBe("write the example");
      expect(created.done).toBe(false);

      const afterCreate = yield* client.listTodos();
      expect(afterCreate.some((t) => t.id === created.id)).toBe(true);

      const toggled = yield* client.toggleTodo({
        id: created.id,
        done: true,
      });
      expect(toggled.done).toBe(true);

      const deletedId = yield* client.deleteTodo({ id: created.id });
      expect(deletedId).toBe(created.id);

      const afterDelete = yield* client.listTodos();
      expect(afterDelete.some((t) => t.id === created.id)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(protocol(rpcUrl)));
  }),
  { timeout: 180_000 },
);

test(
  "toggling a missing todo fails with TodoNotFound",
  Effect.gen(function* () {
    const { websiteUrl } = yield* stack;
    const rpcUrl = new URL("/rpc", websiteUrl).toString();

    yield* Effect.gen(function* () {
      const client = yield* RpcClient.make(TodoRpcs);
      const result = yield* client
        .toggleTodo({ id: 2_147_483_000, done: true })
        .pipe(Effect.flip);
      expect(result._tag).toBe("TodoNotFound");
    }).pipe(Effect.scoped, Effect.provide(protocol(rpcUrl)));
  }),
  { timeout: 180_000 },
);

// Same TodoRpcs schema the app uses; drives the deployed `/rpc` proxy end to
// end (frontend proxy -> backend RpcWorker -> Drizzle -> Neon Postgres).
const protocol = (url: string) =>
  RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson),
  );
