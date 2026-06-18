import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import PublicAppStack from "../public-app.ts";
import PublicInfraStack from "../public-infra.ts";
import type { Post, User } from "../src/schema.ts";

// Aurora bring-up + writer readiness + migrations + Hyperdrive dominate the
// wall clock; allow generous headroom.
const DEPLOY_TIMEOUT = 2_400_000;

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(
    AWS.providers(),
    Cloudflare.providers(),
    Drizzle.providers(),
  ),
  state: Alchemy.localState(),
});

// Deploy the infra stack (Aurora + Hyperdrive) first, then the app stack whose
// Worker binds that Hyperdrive by reference. Tear down in reverse.
beforeAll(deploy(PublicInfraStack), { timeout: DEPLOY_TIMEOUT });
const app = beforeAll(deploy(PublicAppStack), { timeout: DEPLOY_TIMEOUT });
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(PublicAppStack), {
  timeout: DEPLOY_TIMEOUT,
});
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(PublicInfraStack), {
  timeout: DEPLOY_TIMEOUT,
});

const getReady = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.filterOrFail(
      (r) => r.status === 200,
      () => new Error("worker not serving yet"),
    ),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 45 }),
  );

test(
  "CRUD over Hyperdrive → public Aurora",
  Effect.gen(function* () {
    const { url } = yield* app;
    expect(url).toBeString();
    const baseUrl = url.replace(/\/+$/, "");

    const initial = yield* getReady(baseUrl);
    expect(initial.status).toBe(200);
    const initialBody = (yield* initial.json) as unknown as { users: User[] };
    expect(Array.isArray(initialBody.users)).toBe(true);

    const created = yield* HttpClient.execute(HttpClientRequest.post(baseUrl));
    expect(created.status).toBe(200);
    const createdBody = (yield* created.json) as unknown as { user: User[] };
    const [user] = createdBody.user;
    expect(user.id).toBeNumber();

    const read = yield* HttpClient.get(`${baseUrl}/${user.id}`);
    const readBody = (yield* read.json) as unknown as {
      user: User & { posts: Post[] };
    };
    expect(readBody.user).toMatchObject({ id: user.id, posts: [] });

    const deleted = yield* HttpClient.execute(
      HttpClientRequest.delete(`${baseUrl}/${user.id}`),
    );
    expect(deleted.status).toBe(200);

    const final = yield* HttpClient.get(baseUrl);
    const finalBody = (yield* final.json) as unknown as { users: User[] };
    expect(finalBody.users.some((u) => u.id === user.id)).toBe(false);
  }),
  { timeout: 120_000 },
);
