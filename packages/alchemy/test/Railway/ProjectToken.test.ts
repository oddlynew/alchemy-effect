import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getProjectTokens } from "@distilled.cloud/railway";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import { ensureSharedProject } from "./harness.ts";

const { test } = Test.make({ providers: Railway.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

test.provider(
  "create and replace project token",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const token = yield* Railway.ProjectToken("CiToken", {
            project: { projectId },
            environment: { environmentId },
          });
          return { token };
        }),
      );

      expect(initial.token.tokenId).toBeDefined();
      expect(initial.token.token.length).toBeGreaterThan(0);
      expect(initial.token.name).toBeDefined();

      const tokens = yield* getProjectTokens({
        projectId: initial.token.projectId,
      });
      const found = tokens.edges.find(
        (e) => e.node.id === initial.token.tokenId,
      );
      expect(found).toBeDefined();
      expect(found!.node.environmentId).toEqual(initial.token.environmentId);

      // Re-deploying with no changes keeps the same token (and secret).
      const unchanged = yield* stack.deploy(
        Effect.gen(function* () {
          const token = yield* Railway.ProjectToken("CiToken", {
            project: { projectId },
            environment: { environmentId },
          });
          return { token };
        }),
      );
      expect(unchanged.token.tokenId).toEqual(initial.token.tokenId);
      expect(unchanged.token.token).toEqual(initial.token.token);

      // Renaming replaces the token (no update API).
      const replaced = yield* stack.deploy(
        Effect.gen(function* () {
          const token = yield* Railway.ProjectToken("CiToken", {
            project: { projectId },
            environment: { environmentId },
            name: "alchemy-test-ci-token-renamed",
          });
          return { token };
        }),
      );
      expect(replaced.token.tokenId).not.toEqual(initial.token.tokenId);
      expect(replaced.token.name).toEqual("alchemy-test-ci-token-renamed");
      expect(replaced.token.token).not.toEqual(initial.token.token);

      const after = yield* getProjectTokens({
        projectId: replaced.token.projectId,
      });
      expect(after.edges.map((e) => e.node.id)).toContain(
        replaced.token.tokenId,
      );
      expect(after.edges.map((e) => e.node.id)).not.toContain(
        initial.token.tokenId,
      );

      yield* stack.destroy();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 1_500_000 },
);
