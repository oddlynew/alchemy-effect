import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getTcpProxies } from "@distilled.cloud/railway";
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
  "create and replace tcp proxy",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const initial = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("TcpProxyService", {
            project: { projectId },
            environment: { environmentId },
            // No deployment — proxy lifecycle is independent of deploys, and
            // an in-flight deployment blocks proxy deletes with
            // "operation is already in progress".
            deploy: false,
          });
          const proxy = yield* Railway.TcpProxy("TcpProxy", {
            service,
            applicationPort: 5432,
          });
          return { proxy };
        }),
      );

      expect(initial.proxy.proxyId).toBeDefined();
      expect(initial.proxy.domain).toContain(".");
      expect(initial.proxy.proxyPort).toBeGreaterThan(0);
      expect(initial.proxy.applicationPort).toEqual(5432);

      const observed = yield* getTcpProxies({
        serviceId: initial.proxy.serviceId,
        environmentId: initial.proxy.environmentId,
      });
      expect(observed.map((p) => p.id)).toContain(initial.proxy.proxyId);

      // Changing the application port replaces the proxy.
      const replaced = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("TcpProxyService", {
            project: { projectId },
            environment: { environmentId },
            deploy: false,
          });
          const proxy = yield* Railway.TcpProxy("TcpProxy", {
            service,
            applicationPort: 6543,
          });
          return { proxy };
        }),
      );

      expect(replaced.proxy.proxyId).not.toEqual(initial.proxy.proxyId);
      expect(replaced.proxy.applicationPort).toEqual(6543);

      const after = yield* getTcpProxies({
        serviceId: replaced.proxy.serviceId,
        environmentId: replaced.proxy.environmentId,
      });
      expect(after.map((p) => p.id)).toContain(replaced.proxy.proxyId);
      expect(after.map((p) => p.id)).not.toContain(initial.proxy.proxyId);

      yield* stack.destroy();
    }).pipe(Effect.ensuring(Effect.ignore(stack.destroy())), logLevel),
  { timeout: 1_500_000 },
);
