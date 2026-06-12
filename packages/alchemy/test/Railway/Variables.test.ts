import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getVariables } from "@distilled.cloud/railway";
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
  "create, upsert, remove and delete shared variables",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const { vars } = yield* stack.deploy(
        Effect.gen(function* () {
          const vars = yield* Railway.Variables("SharedVars", {
            project: { projectId },
            environment: { environmentId },
            variables: {
              LOG_LEVEL: "info",
              REGION: "us-west2",
            },
          });
          return { vars };
        }),
      );

      expect(vars.projectId).toEqual(projectId);
      expect(vars.environmentId).toEqual(environmentId);
      expect(vars.serviceId).toBeUndefined();
      expect(vars.names.sort()).toEqual(["LOG_LEVEL", "REGION"]);

      const observed = (yield* getVariables({
        projectId: vars.projectId,
        environmentId: vars.environmentId,
      })) as Record<string, string>;
      expect(observed.LOG_LEVEL).toEqual("info");
      expect(observed.REGION).toEqual("us-west2");

      // Update — change one value, add one, remove one.
      const { vars: updated } = yield* stack.deploy(
        Effect.gen(function* () {
          const vars = yield* Railway.Variables("SharedVars", {
            project: { projectId },
            environment: { environmentId },
            variables: {
              LOG_LEVEL: "debug",
              NEW_FLAG: "on",
            },
          });
          return { vars };
        }),
      );

      expect(updated.names.sort()).toEqual(["LOG_LEVEL", "NEW_FLAG"]);

      const reobserved = (yield* getVariables({
        projectId: updated.projectId,
        environmentId: updated.environmentId,
      })) as Record<string, string>;
      expect(reobserved.LOG_LEVEL).toEqual("debug");
      expect(reobserved.NEW_FLAG).toEqual("on");
      expect(reobserved.REGION).toBeUndefined();

      yield* stack.destroy();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 600_000 },
);

test.provider(
  "service-scoped variables only touch managed names",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const { service, vars } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Svc", {
            project: { projectId },
            environment: { environmentId },
            variables: { FOREIGN: "untouched" },
            deploy: false,
          });
          const vars = yield* Railway.Variables("SvcVars", {
            project: { projectId },
            environment: { environmentId: service.environmentId },
            service,
            variables: { MANAGED: "yes" },
          });
          return { service, vars };
        }),
      );

      expect(vars.serviceId).toEqual(service.serviceId);

      const observed = (yield* getVariables({
        projectId,
        environmentId: service.environmentId,
        serviceId: service.serviceId,
      })) as Record<string, string>;
      expect(observed.MANAGED).toEqual("yes");
      expect(observed.FOREIGN).toEqual("untouched");

      // Destroy only the Variables resource — foreign variables survive.
      const { service: remaining } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Svc", {
            project: { projectId },
            environment: { environmentId },
            variables: { FOREIGN: "untouched" },
            deploy: false,
          });
          return { service };
        }),
      );

      const after = (yield* getVariables({
        projectId,
        environmentId: remaining.environmentId,
        serviceId: remaining.serviceId,
      })) as Record<string, string>;
      expect(after.MANAGED).toBeUndefined();
      expect(after.FOREIGN).toEqual("untouched");

      yield* stack.destroy();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 600_000 },
);
