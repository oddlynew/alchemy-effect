import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getNotificationRules } from "@distilled.cloud/railway";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { MinimumLogLevel } from "effect/References";
import { ensureSharedProject } from "./harness.ts";

const { test } = Test.make({ providers: Railway.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// A single multi-step test so the whole file costs one project creation —
// Railway rate-limits project creation aggressively at the workspace level.
test.provider(
  "create, update url and delete webhook",
  (stack) =>
    Effect.gen(function* () {
      const { projectId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const deploy = (url: string) =>
        stack.deploy(
          Effect.gen(function* () {
            const webhook = yield* Railway.Webhook("Hook", {
              project: { projectId },
              url,
              eventTypes: ["Deployment.failed", "Deployment.crashed"],
            });
            return { webhook };
          }),
        );

      const { webhook } = yield* deploy("https://example.com/hook");

      expect(webhook.webhookId).toBeDefined();
      expect(webhook.url).toEqual("https://example.com/hook");
      expect(webhook.projectId).toEqual(projectId);
      expect(webhook.workspaceId).toBeDefined();
      expect([...webhook.eventTypes].sort()).toEqual([
        "Deployment.crashed",
        "Deployment.failed",
      ]);

      const observed = yield* getNotificationRules({
        workspaceId: webhook.workspaceId,
        projectId: webhook.projectId,
      });
      const match = observed.find((r) => r.id === webhook.webhookId);
      expect(match).toBeDefined();
      expect([...match!.eventTypes].sort()).toEqual([
        "Deployment.crashed",
        "Deployment.failed",
      ]);

      // Update — change the webhook URL; the backing rule converges to the
      // new URL (in place with a personal token, by replacement with a
      // workspace token).
      const { webhook: updated } = yield* deploy("https://example.com/hook-2");

      expect(updated.url).toEqual("https://example.com/hook-2");
      expect(updated.projectId).toEqual(projectId);

      const reobserved = yield* getNotificationRules({
        workspaceId: updated.workspaceId,
        projectId: updated.projectId,
      });
      const rematch = reobserved.find((r) => r.id === updated.webhookId);
      expect(rematch).toBeDefined();

      yield* stack.destroy();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 900_000 },
);
