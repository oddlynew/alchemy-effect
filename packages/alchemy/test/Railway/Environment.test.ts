import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getEnvironment, getVariables } from "@distilled.cloud/railway";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import * as Schedule from "effect/Schedule";
import { ensureSharedProject } from "./harness.ts";

const { test } = Test.make({ providers: Railway.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// Uses the shared test project (see harness.ts) — Railway rate-limits
// project creation to 1/30s per workspace, so tests must not create one.
test.provider(
  "create, rename, fork and delete environments with shared variables",
  (stack) =>
    Effect.gen(function* () {
      const { projectId } = yield* ensureSharedProject;

      // Pre-clean: crashed runs leave orphan environments behind (scratch
      // state is in-memory, so it doesn't survive across runs). Deploy the
      // full set of names this test uses — create adopts an existing
      // environment on name conflict. The initial deploy below then
      // garbage-collects "Renamed" and "Forked" (they drop out of the
      // program) while "Env" carries straight into the test, so the names
      // this test is about to use are never deleted-and-recreated (a
      // just-deleted name can stay reserved while deletion propagates).
      yield* stack.deploy(
        Effect.gen(function* () {
          yield* Railway.Environment("Env", {
            project: { projectId },
            name: "alchemy-test-env",
          });
          yield* Railway.Environment("Renamed", {
            project: { projectId },
            name: "alchemy-test-env-renamed",
          });
          yield* Railway.Environment("Forked", {
            project: { projectId },
            name: "alchemy-test-env-fork",
          });
        }),
      );

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const environment = yield* Railway.Environment("Env", {
            project: { projectId },
            name: "alchemy-test-env",
          });
          const vars = yield* Railway.Variables("SharedVars", {
            project: { projectId },
            environment,
            variables: { LOG_LEVEL: "info", REGION: "us-west2" },
          });
          return { environment, vars };
        }),
      );
      const { environment } = initial;

      expect(environment.environmentId).toBeDefined();
      expect(environment.name).toEqual("alchemy-test-env");
      expect(environment.projectId).toEqual(projectId);
      expect(environment.isEphemeral).toBe(false);

      const fetched = yield* getEnvironment({
        id: environment.environmentId,
      });
      expect(fetched.id).toEqual(environment.environmentId);
      expect(fetched.name).toEqual("alchemy-test-env");
      expect(fetched.projectId).toEqual(projectId);

      const observedVars = (yield* getVariables({
        projectId,
        environmentId: environment.environmentId,
      })) as Record<string, string>;
      expect(observedVars.LOG_LEVEL).toEqual("info");
      expect(observedVars.REGION).toEqual("us-west2");

      // Update — rename in place, fork a second environment from it and
      // shrink the managed variable set.
      const updated = yield* stack.deploy(
        Effect.gen(function* () {
          const environment = yield* Railway.Environment("Env", {
            project: { projectId },
            name: "alchemy-test-env-renamed",
          });
          const forked = yield* Railway.Environment("Forked", {
            project: { projectId },
            name: "alchemy-test-env-fork",
            sourceEnvironment: { environmentId: environment.environmentId },
            skipInitialDeploys: true,
          });
          const vars = yield* Railway.Variables("SharedVars", {
            project: { projectId },
            environment,
            variables: { LOG_LEVEL: "debug" },
          });
          return { environment, forked, vars };
        }),
      );

      expect(updated.environment.environmentId).toEqual(
        environment.environmentId,
      );
      expect(updated.environment.name).toEqual("alchemy-test-env-renamed");

      const refetched = yield* getEnvironment({
        id: environment.environmentId,
      });
      expect(refetched.name).toEqual("alchemy-test-env-renamed");

      expect(updated.forked.environmentId).toBeDefined();
      expect(updated.forked.environmentId).not.toEqual(
        environment.environmentId,
      );
      expect(updated.forked.name).toEqual("alchemy-test-env-fork");

      const updatedVars = (yield* getVariables({
        projectId,
        environmentId: environment.environmentId,
      })) as Record<string, string>;
      expect(updatedVars.LOG_LEVEL).toEqual("debug");
      // REGION was removed from the managed set and must be deleted.
      expect(updatedVars.REGION).toBeUndefined();

      yield* stack.destroy();

      // Railway soft-deletes environments: getEnvironment keeps succeeding
      // with `deletedAt` set (and may eventually return NotAuthorized).
      // Poll until either signal shows up.
      const gone = yield* getEnvironment({
        id: environment.environmentId,
      }).pipe(
        Effect.map((env) =>
          env.deletedAt !== null ? ("deleted" as const) : ("exists" as const),
        ),
        Effect.catchTag("NotAuthorized", () =>
          Effect.succeed("deleted" as const),
        ),
        Effect.repeat({
          schedule: Schedule.spaced("2 seconds"),
          until: (state) => state === "deleted",
          times: 30,
        }),
      );
      expect(gone).toEqual("deleted");
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 900_000 },
);
