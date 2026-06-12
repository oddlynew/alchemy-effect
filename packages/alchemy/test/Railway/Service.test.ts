import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import {
  getService,
  getServiceInstance,
  getVariables,
} from "@distilled.cloud/railway";
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

test.provider(
  "create, update config and variables, delete service",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const { service } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Api", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "nginx:alpine" },
            variables: { LOG_LEVEL: "info", DROP_ME: "soon" },
          });
          return { service };
        }),
      );

      expect(service.serviceId).toBeDefined();
      expect(service.projectId).toEqual(projectId);
      expect(service.environmentId).toEqual(environmentId);
      expect(service.deploymentId).toBeDefined();
      expect(service.deploymentStatus).toEqual("SUCCESS");
      expect(service.variableNames.sort()).toEqual(["DROP_ME", "LOG_LEVEL"]);

      const fetched = yield* getService({ id: service.serviceId });
      expect(fetched.id).toEqual(service.serviceId);

      // Update — instance config (replicas, start command, restart policy)
      // and variables (change one, drop one, add one).
      const { service: updated } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Api", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "nginx:alpine" },
            variables: { LOG_LEVEL: "debug", ADDED: "yes" },
            numReplicas: 2,
            restartPolicyType: "ALWAYS",
          });
          return { service };
        }),
      );

      expect(updated.serviceId).toEqual(service.serviceId);
      expect(updated.deploymentStatus).toEqual("SUCCESS");
      expect(updated.variableNames.sort()).toEqual(["ADDED", "LOG_LEVEL"]);

      const instance = yield* getServiceInstance({
        serviceId: updated.serviceId,
        environmentId: updated.environmentId,
      });
      expect(instance.numReplicas).toEqual(2);
      expect(instance.restartPolicyType).toEqual("ALWAYS");
      expect(instance.source?.image).toEqual("nginx:alpine");

      const observedVars = (yield* getVariables({
        projectId: updated.projectId,
        environmentId: updated.environmentId,
        serviceId: updated.serviceId,
      })) as Record<string, string>;
      expect(observedVars.LOG_LEVEL).toEqual("debug");
      expect(observedVars.ADDED).toEqual("yes");
      expect(observedVars.DROP_ME).toBeUndefined();

      yield* stack.destroy();

      // Railway soft-deletes services: getService keeps succeeding with
      // `deletedAt` set (and may eventually return NotAuthorized). Poll
      // until either signal shows up.
      const gone = yield* getService({ id: service.serviceId }).pipe(
        Effect.map((svc) =>
          svc.deletedAt !== null ? ("deleted" as const) : ("exists" as const),
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
    }).pipe(Effect.ensuring(Effect.ignore(stack.destroy())), logLevel),
  { timeout: 900_000 },
);

test.provider(
  "cron service without deployment",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const { service } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Job", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "alpine:3" },
            cronSchedule: "0 3 * * *",
            startCommand: "echo done",
            deploy: false,
          });
          return { service };
        }),
      );

      const instance = yield* getServiceInstance({
        serviceId: service.serviceId,
        environmentId: service.environmentId,
      });
      expect(instance.cronSchedule).toEqual("0 3 * * *");
      expect(instance.startCommand).toEqual("echo done");

      // Update — change the cron schedule in place.
      const { service: updated } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Job", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "alpine:3" },
            cronSchedule: "30 4 * * *",
            startCommand: "echo done",
            deploy: false,
          });
          return { service };
        }),
      );

      expect(updated.serviceId).toEqual(service.serviceId);
      const reread = yield* getServiceInstance({
        serviceId: updated.serviceId,
        environmentId: updated.environmentId,
      });
      expect(reread.cronSchedule).toEqual("30 4 * * *");

      yield* stack.destroy();
    }).pipe(Effect.ensuring(Effect.ignore(stack.destroy())), logLevel),
  { timeout: 600_000 },
);
