import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Drizzle from "alchemy/Drizzle";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import Stack from "../alchemy.run.ts";
import type { Post, User } from "../src/schema.ts";

// Aurora serverless v2 bring-up dominates the wall clock — allow plenty of
// headroom for the deploy (cluster + writer instance) and the teardown.
const DEPLOY_TIMEOUT = 1_200_000;

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(AWS.providers(), Drizzle.providers()),
  state: Alchemy.localState(),
});

const stack = beforeAll(deploy(Stack), { timeout: DEPLOY_TIMEOUT });

afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), {
  timeout: DEPLOY_TIMEOUT,
});

test(
  "stack exposes a function URL",
  Effect.gen(function* () {
    const { url } = yield* stack;
    expect(url).toBeString();
  }),
);

const requireUrl = Effect.gen(function* () {
  const { url } = yield* stack;
  if (!url) return yield* Effect.fail(new Error("stack did not expose a URL"));
  return url.replace(/\/+$/, "");
});

// Function URLs take a few seconds to start serving 200s after creation.
const getOnce = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.filterOrFail(
      (response) => response.status === 200,
      () => new Error("function URL not yet serving"),
    ),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 30 }),
  );

test(
  "user CRUD through Drizzle over the RDS Data API",
  Effect.gen(function* () {
    const baseUrl = yield* requireUrl;

    const initialResponse = yield* getOnce(baseUrl);
    expect(initialResponse.status).toBe(200);
    const initialBody = (yield* initialResponse.json) as unknown as {
      users: User[];
    };
    expect(Array.isArray(initialBody.users)).toBe(true);

    const createResponse = yield* HttpClient.execute(
      HttpClientRequest.post(baseUrl),
    );
    expect(createResponse.status).toBe(200);
    const createBody = (yield* createResponse.json) as unknown as {
      user: User[];
    };
    expect(createBody.user).toHaveLength(1);
    const [createdUser] = createBody.user;
    expect(createdUser.id).toBeNumber();
    expect(createdUser.email).toBeString();

    const readResponse = yield* HttpClient.get(`${baseUrl}/${createdUser.id}`);
    expect(readResponse.status).toBe(200);
    const readBody = (yield* readResponse.json) as unknown as {
      user: User & { posts: Post[] };
    };
    expect(readBody.user).toMatchObject({
      id: createdUser.id,
      email: createdUser.email,
      posts: [],
    });

    const invalidRead = yield* HttpClient.get(`${baseUrl}/not-a-user`);
    expect(invalidRead.status).toBe(400);

    const methodResponse = yield* HttpClient.execute(
      HttpClientRequest.patch(baseUrl),
    );
    expect(methodResponse.status).toBe(405);

    const deleteResponse = yield* HttpClient.execute(
      HttpClientRequest.delete(`${baseUrl}/${createdUser.id}`),
    );
    expect(deleteResponse.status).toBe(200);

    const finalResponse = yield* HttpClient.get(baseUrl);
    const finalBody = (yield* finalResponse.json) as unknown as {
      users: User[];
    };
    expect(finalBody.users.some((u) => u.id === createdUser.id)).toBe(false);
  }),
  { timeout: 60_000 },
);
