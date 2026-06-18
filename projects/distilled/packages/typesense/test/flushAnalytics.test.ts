import { Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { describe, expect, it } from "vitest";
import { Credentials } from "../src/credentials";
import { flushAnalytics } from "../src/operations/flushAnalytics";
import { runEffect, testRunId } from "./setup";

describe("flushAnalytics", () => {
  it(
    "flushes in-memory analytics to disk and returns ok: true",
    { timeout: 30_000 },
    async () => {
      const result = await runEffect(flushAnalytics({}));

      expect(result.ok).toBe(true);
    },
  );

  it(
    "returns Unauthorized when the X-TYPESENSE-API-KEY is invalid",
    { timeout: 30_000 },
    async () => {
      // Override the shared Credentials layer with an API key that the
      // Typesense server will reject. Typesense returns 401 with a JSON
      // body { message: string }, which the SDK's matchError maps to the
      // typed Unauthorized error class.
      const apiBaseUrl = process.env.TYPESENSE_API_URL;
      if (!apiBaseUrl) {
        throw new Error("TYPESENSE_API_URL must be set to run typesense tests");
      }
      const BadCredentials = Layer.succeed(
        Credentials,
        Effect.succeed({
          apiKey: Redacted.make(`invalid-key-${testRunId}`),
          apiBaseUrl,
        }),
      );

      const error = await Effect.runPromise(
        flushAnalytics({}).pipe(
          Effect.flip,
          Effect.provide(Layer.merge(BadCredentials, FetchHttpClient.layer)),
        ) as Effect.Effect<unknown, never, never>,
      );

      expect((error as { _tag: string })._tag).toBe("Unauthorized");
    },
  );
});
