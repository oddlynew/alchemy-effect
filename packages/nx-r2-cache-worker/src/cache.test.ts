import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type {
  CacheArtifact,
  CacheHandlerServices,
  CacheStorage,
  CacheWriteResult,
} from "./cache";
import { CACHE_CONTENT_TYPE, handleCacheRequest } from "./cache";
import { makeCacheAuth } from "./auth";

const trustedToken = "trusted-token";
const branchToken = "branch-token";

describe(handleCacheRequest, () => {
  it.effect("writes and reads trusted artifacts", () =>
    Effect.gen(function* () {
      const services = makeServices();

      const write = yield* request("/trusted/v1/cache/hash-1", {
        method: "PUT",
        token: trustedToken,
        body: "trusted artifact",
      }).pipe(run(services));

      expect(write.status).toBe(200);

      const read = yield* request("/trusted/v1/cache/hash-1", {
        token: trustedToken,
      }).pipe(run(services));

      expect(read.status).toBe(200);
      expect(read.headers.get("Content-Type")).toBe(CACHE_CONTENT_TYPE);
      expect(yield* Effect.promise(() => read.text())).toBe("trusted artifact");
    }),
  );

  it.effect(
    "rejects duplicate writes without overwriting the original artifact",
    () =>
      Effect.gen(function* () {
        const services = makeServices();

        yield* request("/trusted/v1/cache/hash-2", {
          method: "PUT",
          token: trustedToken,
          body: "first",
        }).pipe(run(services));

        const duplicate = yield* request("/trusted/v1/cache/hash-2", {
          method: "PUT",
          token: trustedToken,
          body: "second",
        }).pipe(run(services));

        expect(duplicate.status).toBe(409);

        const read = yield* request("/trusted/v1/cache/hash-2", {
          token: trustedToken,
        }).pipe(run(services));

        expect(yield* Effect.promise(() => read.text())).toBe("first");
      }),
  );

  it.effect(
    "reads trusted fallback for branches and keeps branch writes isolated",
    () =>
      Effect.gen(function* () {
        const services = makeServices();

        yield* request("/trusted/v1/cache/shared-hash", {
          method: "PUT",
          token: trustedToken,
          body: "trusted",
        }).pipe(run(services));

        const fallback = yield* request(
          "/branches/pr-1058/v1/cache/shared-hash",
          {
            token: branchToken,
          },
        ).pipe(run(services));

        expect(fallback.status).toBe(200);
        expect(yield* Effect.promise(() => fallback.text())).toBe("trusted");

        yield* request("/branches/pr-1058/v1/cache/shared-hash", {
          method: "PUT",
          token: branchToken,
          body: "branch",
        }).pipe(run(services));

        const branchRead = yield* request(
          "/branches/pr-1058/v1/cache/shared-hash",
          {
            token: branchToken,
          },
        ).pipe(run(services));
        const trustedRead = yield* request("/trusted/v1/cache/shared-hash", {
          token: trustedToken,
        }).pipe(run(services));

        expect(yield* Effect.promise(() => branchRead.text())).toBe("branch");
        expect(yield* Effect.promise(() => trustedRead.text())).toBe("trusted");
      }),
  );

  it.effect("forbids tokens on the wrong scope", () =>
    Effect.gen(function* () {
      const services = makeServices();

      const branchOnTrusted = yield* request("/trusted/v1/cache/hash-3", {
        token: branchToken,
      }).pipe(run(services));
      const trustedOnBranch = yield* request(
        "/branches/pr-1058/v1/cache/hash-3",
        {
          token: trustedToken,
        },
      ).pipe(run(services));

      expect(branchOnTrusted.status).toBe(403);
      expect(trustedOnBranch.status).toBe(403);
    }),
  );

  it.effect("requires a bearer token", () =>
    Effect.gen(function* () {
      const response = yield* request("/trusted/v1/cache/hash-4").pipe(
        run(makeServices()),
      );
      expect(response.status).toBe(401);
    }),
  );

  it.effect("rejects branch namespaces with encoded slashes", () =>
    Effect.gen(function* () {
      const response = yield* request("/branches/pr%2F1058/v1/cache/hash-5", {
        token: branchToken,
      }).pipe(run(makeServices()));

      expect(response.status).toBe(400);
    }),
  );

  it.effect(
    "returns 405 for matching cache routes with unsupported methods",
    () =>
      Effect.gen(function* () {
        const response = yield* request("/trusted/v1/cache/hash-6", {
          method: "POST",
          token: trustedToken,
        }).pipe(run(makeServices()));

        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET, PUT");
      }),
  );
});

function run(services: CacheHandlerServices) {
  return (req: Effect.Effect<Request>) =>
    req.pipe(
      Effect.flatMap((request) => handleCacheRequest(request, services)),
    );
}

function request(
  path: string,
  options: {
    readonly method?: string;
    readonly token?: string;
    readonly body?: string;
  } = {},
): Effect.Effect<Request> {
  return Effect.sync(() => {
    const headers = new Headers();

    if (options.token) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }

    return new Request(`https://cache.test${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
    });
  });
}

function makeServices(): CacheHandlerServices {
  return {
    auth: makeCacheAuth({
      trustedToken: Redacted.make(trustedToken),
      branchToken: Redacted.make(branchToken),
    }),
    storage: createMemoryStorage(),
  };
}

function createMemoryStorage(): CacheStorage {
  const trusted = new Map<string, Uint8Array>();
  const branches = new Map<string, Uint8Array>();

  return {
    readTrusted: (hash) => read(trusted, hash),
    readBranch: (namespace, hash) => read(branches, `${namespace}/${hash}`),
    writeTrusted: (hash, body) => write(trusted, hash, body),
    writeBranch: (namespace, hash, body) =>
      write(branches, `${namespace}/${hash}`, body),
  };
}

function read(
  store: Map<string, Uint8Array>,
  key: string,
): Effect.Effect<CacheArtifact | null> {
  const bytes = store.get(key);

  if (!bytes) {
    return Effect.succeed(null);
  }

  return Effect.succeed({
    body: streamFromBytes(bytes),
    size: bytes.byteLength,
  });
}

function write(
  store: Map<string, Uint8Array>,
  key: string,
  body: ReadableStream<Uint8Array> | null,
): Effect.Effect<CacheWriteResult> {
  if (store.has(key)) {
    return Effect.succeed("exists");
  }

  return Effect.promise(async () => {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    store.set(key, bytes);
    return "stored" as const;
  });
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
