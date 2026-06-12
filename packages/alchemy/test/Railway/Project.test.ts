import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getProject } from "@distilled.cloud/railway";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";

const { test } = Test.make({ providers: Railway.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// A single multi-step test so the whole file costs one project creation —
// Railway rate-limits project creation aggressively at the workspace level.
test.provider(
  "create, update and delete project",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Railway.Project("Project", {
            name: "alchemy-test-railway-project",
          });
        }),
      );

      expect(initial.projectId).toBeDefined();
      expect(initial.name).toEqual("alchemy-test-railway-project");
      expect(initial.defaultEnvironmentId).toBeDefined();
      expect(initial.defaultEnvironmentName).toBeDefined();
      expect(initial.description).toBeUndefined();

      const fetched = yield* getProject({ id: initial.projectId });
      expect(fetched.id).toEqual(initial.projectId);
      expect(fetched.name).toEqual(initial.name);

      // Update — rename and set a description; same physical project.
      const updated = yield* stack.deploy(
        Effect.gen(function* () {
          return yield* Railway.Project("Project", {
            name: "alchemy-test-railway-project-2",
            description: "updated by alchemy test",
          });
        }),
      );
      expect(updated.projectId).toEqual(initial.projectId);
      expect(updated.name).toEqual("alchemy-test-railway-project-2");
      expect(updated.description).toEqual("updated by alchemy test");

      const refetched = yield* getProject({ id: updated.projectId });
      expect(refetched.name).toEqual("alchemy-test-railway-project-2");
      expect(refetched.description).toEqual("updated by alchemy test");

      yield* stack.destroy();
    }).pipe(logLevel),
  { timeout: 900_000 },
);
