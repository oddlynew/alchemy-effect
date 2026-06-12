import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
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
  "create, remount and delete volume attached to a service",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const { service, volume } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Db", {
            project: { projectId },
            environment: { environmentId },
            deploy: false,
          });
          const volume = yield* Railway.Volume("Data", {
            project: { projectId },
            environment: { environmentId: service.environmentId },
            service,
            mountPath: "/data",
          });
          return { service, volume };
        }),
      );

      expect(volume.volumeId).toBeDefined();
      expect(volume.projectId).toEqual(projectId);
      expect(volume.serviceId).toEqual(service.serviceId);
      expect(volume.mountPath).toEqual("/data");

      // Update — change the mount path in place.
      const { volume: remounted } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Db", {
            project: { projectId },
            environment: { environmentId },
            deploy: false,
          });
          const volume = yield* Railway.Volume("Data", {
            project: { projectId },
            environment: { environmentId: service.environmentId },
            service,
            mountPath: "/data-v2",
          });
          return { service, volume };
        }),
      );

      expect(remounted.volumeId).toEqual(volume.volumeId);
      expect(remounted.mountPath).toEqual("/data-v2");

      yield* stack.destroy();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  // Generous timeout: Railway rate-limits project creation to 1 per 30s per
  // workspace, so concurrent test runs can spend minutes waiting to create.
  { timeout: 1_200_000 },
);
