import * as Effect from "effect/Effect";
import type { CacheAuth, CacheAuthError } from "./auth";
import type { CacheStorageError } from "./storage";

export const CACHE_CONTENT_TYPE = "application/octet-stream";

const CACHE_HASH_PATTERN = /^[A-Za-z0-9._-]{1,256}$/;
const BRANCH_NAMESPACE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface CacheArtifact {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly size?: number;
}

export type CacheWriteResult = "stored" | "exists";

export interface CacheStorage<Requirements = never> {
  readonly readTrusted: (
    hash: string,
  ) => Effect.Effect<CacheArtifact | null, CacheStorageError, Requirements>;
  readonly readBranch: (
    namespace: string,
    hash: string,
  ) => Effect.Effect<CacheArtifact | null, CacheStorageError, Requirements>;
  readonly writeTrusted: (
    hash: string,
    body: ReadableStream<Uint8Array> | null,
    contentLength: number | undefined,
  ) => Effect.Effect<CacheWriteResult, CacheStorageError, Requirements>;
  readonly writeBranch: (
    namespace: string,
    hash: string,
    body: ReadableStream<Uint8Array> | null,
    contentLength: number | undefined,
  ) => Effect.Effect<CacheWriteResult, CacheStorageError, Requirements>;
}

export interface CacheHandlerServices<Requirements = never> {
  readonly auth: CacheAuth;
  readonly storage: CacheStorage<Requirements>;
}

type CacheRoute =
  | {
      readonly scope: "trusted";
      readonly hash: string;
    }
  | {
      readonly scope: "branch";
      readonly namespace: string;
      readonly hash: string;
    };

type ParsedRoute =
  | {
      readonly _tag: "Route";
      readonly route: CacheRoute;
    }
  | {
      readonly _tag: "NotFound";
    }
  | {
      readonly _tag: "BadRequest";
      readonly message: string;
    };

export function handleCacheRequest<Requirements>(
  request: Request,
  services: CacheHandlerServices<Requirements>,
): Effect.Effect<Response, never, Requirements> {
  return handleCacheRequestInternal(request, services).pipe(
    Effect.catchTags({
      CacheAuthError: (error) =>
        Effect.logWarning("nx r2 cache request rejected", {
          scope: error.scope,
          status: error.status,
        }).pipe(Effect.as(textResponse(error.message, error.status))),
      CacheStorageError: (error) =>
        Effect.logError("nx r2 cache storage failure", {
          key: error.key,
          operation: error.operation,
        }).pipe(
          Effect.as(
            textResponse(
              `Remote cache storage failed: ${error.operation}.`,
              500,
            ),
          ),
        ),
    }),
  );
}

function handleCacheRequestInternal<Requirements>(
  request: Request,
  services: CacheHandlerServices<Requirements>,
): Effect.Effect<Response, CacheAuthError | CacheStorageError, Requirements> {
  return Effect.gen(function* () {
    const parsed = parseCacheRoute(request);

    if (parsed._tag === "NotFound") {
      return textResponse("Not found.", 404);
    }

    if (parsed._tag === "BadRequest") {
      return textResponse(parsed.message, 400);
    }

    const route = parsed.route;

    if (request.method !== "GET" && request.method !== "PUT") {
      return textResponse("Method not allowed.", 405, {
        Allow: "GET, PUT",
      });
    }

    yield* services.auth.authorize(request, route.scope);

    if (request.method === "GET") {
      const artifact = yield* readArtifact(route, services.storage);

      if (!artifact) {
        yield* Effect.logInfo("nx r2 cache miss", cacheLogDetails(route));
        return textResponse("Cache artifact not found.", 404);
      }

      return new Response(artifact.body, {
        status: 200,
        headers: {
          "Content-Type": CACHE_CONTENT_TYPE,
          ...(artifact.size === undefined
            ? {}
            : { "Content-Length": String(artifact.size) }),
        },
      });
    }

    const contentLength = parseContentLength(
      request.headers.get("Content-Length"),
    );
    const result =
      route.scope === "trusted"
        ? yield* services.storage.writeTrusted(
            route.hash,
            request.body,
            contentLength,
          )
        : yield* services.storage.writeBranch(
            route.namespace,
            route.hash,
            request.body,
            contentLength,
          );

    if (result === "exists") {
      yield* Effect.logWarning(
        "nx r2 cache write conflict",
        cacheLogDetails(route),
      );
      return textResponse("Cache artifact already exists.", 409);
    }

    yield* Effect.logInfo(
      "nx r2 cache stored artifact",
      cacheLogDetails(route),
    );
    return textResponse("Stored.", 200);
  });
}

function cacheLogDetails(route: CacheRoute): Record<string, string> {
  if (route.scope === "trusted") {
    return {
      hash: route.hash,
      scope: route.scope,
    };
  }

  return {
    hash: route.hash,
    namespace: route.namespace,
    scope: route.scope,
  };
}

function readArtifact<Requirements>(
  route: CacheRoute,
  storage: CacheStorage<Requirements>,
): Effect.Effect<CacheArtifact | null, CacheStorageError, Requirements> {
  if (route.scope === "trusted") {
    return storage.readTrusted(route.hash);
  }

  return storage
    .readBranch(route.namespace, route.hash)
    .pipe(
      Effect.flatMap((artifact) =>
        artifact ? Effect.succeed(artifact) : storage.readTrusted(route.hash),
      ),
    );
}

function parseCacheRoute(request: Request): ParsedRoute {
  const { pathname } = new URL(request.url);
  const segments = pathname.split("/").filter(Boolean);
  const decoded = decodeSegments(segments);

  if (!decoded) {
    return { _tag: "BadRequest", message: "Invalid URL path." };
  }

  if (
    decoded.length === 4 &&
    decoded[0] === "trusted" &&
    decoded[1] === "v1" &&
    decoded[2] === "cache"
  ) {
    const hash = decoded[3]!;

    if (!CACHE_HASH_PATTERN.test(hash)) {
      return { _tag: "BadRequest", message: "Invalid cache hash." };
    }

    return { _tag: "Route", route: { scope: "trusted", hash } };
  }

  if (
    decoded.length === 5 &&
    decoded[0] === "branches" &&
    decoded[2] === "v1" &&
    decoded[3] === "cache"
  ) {
    const namespace = decoded[1]!;
    const hash = decoded[4]!;

    if (!BRANCH_NAMESPACE_PATTERN.test(namespace)) {
      return { _tag: "BadRequest", message: "Invalid branch namespace." };
    }

    if (!CACHE_HASH_PATTERN.test(hash)) {
      return { _tag: "BadRequest", message: "Invalid cache hash." };
    }

    return {
      _tag: "Route",
      route: { scope: "branch", namespace, hash },
    };
  }

  return { _tag: "NotFound" };
}

function decodeSegments(
  segments: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  try {
    return segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function textResponse(
  body: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "text/plain; charset=utf-8");

  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}
