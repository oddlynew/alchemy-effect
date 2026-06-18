import type * as Cloudflare from "alchemy/Cloudflare";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { CacheArtifact, CacheStorage, CacheWriteResult } from "./cache";

export class CacheStorageError extends Data.TaggedError("CacheStorageError")<{
  readonly operation: "read" | "write";
  readonly key: string;
  readonly cause: unknown;
}> {}

export type R2CacheBucket = Cloudflare.R2BucketClient;

export function makeR2CacheStorage(options: {
  readonly trusted: R2CacheBucket;
  readonly branch: R2CacheBucket;
}): CacheStorage<RuntimeContext> {
  return {
    readTrusted: (hash) => readObject(options.trusted, trustedKey(hash)),
    readBranch: (namespace, hash) =>
      readObject(options.branch, branchKey(namespace, hash)),
    writeTrusted: (hash, body, contentLength) =>
      writeObject(options.trusted, trustedKey(hash), body, contentLength),
    writeBranch: (namespace, hash, body, contentLength) =>
      writeObject(
        options.branch,
        branchKey(namespace, hash),
        body,
        contentLength,
      ),
  };
}

function readObject(
  bucket: R2CacheBucket,
  key: string,
): Effect.Effect<CacheArtifact | null, CacheStorageError, RuntimeContext> {
  return bucket.get(key).pipe(
    Effect.mapError(
      (cause) => new CacheStorageError({ operation: "read", key, cause }),
    ),
    Effect.map((object) => {
      if (!object) return null;

      return {
        body: Stream.toReadableStream(object.body),
        size: object.size,
      };
    }),
  );
}

function writeObject(
  bucket: R2CacheBucket,
  key: string,
  body: ReadableStream<Uint8Array> | null,
  contentLength: number | undefined,
): Effect.Effect<CacheWriteResult, CacheStorageError, RuntimeContext> {
  return bucket
    .put(key, body, {
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: {
        contentType: "application/octet-stream",
      },
      ...(contentLength === undefined ? {} : { contentLength }),
    })
    .pipe(
      Effect.mapError(
        (cause) => new CacheStorageError({ operation: "write", key, cause }),
      ),
      Effect.map((result) => (result === null ? "exists" : "stored")),
    );
}

function trustedKey(hash: string): string {
  return `trusted/${hash}`;
}

function branchKey(namespace: string, hash: string): string {
  return `branches/${namespace}/${hash}`;
}
