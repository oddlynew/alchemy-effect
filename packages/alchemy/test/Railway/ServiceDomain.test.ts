import * as Railway from "@/Railway";
import * as Test from "@/Test/Vitest";
import { getDomains } from "@distilled.cloud/railway";
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
  "create, update target port and delete service domain",
  (stack) =>
    Effect.gen(function* () {
      const { projectId, environmentId } = yield* ensureSharedProject;
      yield* stack.destroy();

      const { service, domain } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Web", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "nginx:alpine" },
            deploy: false,
          });
          const domain = yield* Railway.ServiceDomain("WebDomain", {
            service,
            targetPort: 80,
          });
          return { service, domain };
        }),
      );

      expect(domain.domainId).toBeDefined();
      expect(domain.domain).toContain("up.railway.app");
      expect(domain.url).toEqual(`https://${domain.domain}`);
      expect(domain.serviceId).toEqual(service.serviceId);
      expect(domain.environmentId).toEqual(service.environmentId);
      expect(domain.targetPort).toEqual(80);

      const observed = yield* getDomains({
        projectId: domain.projectId,
        environmentId: domain.environmentId,
        serviceId: domain.serviceId,
      });
      const match = observed.serviceDomains.find(
        (d) => d.id === domain.domainId,
      );
      expect(match?.domain).toEqual(domain.domain);
      expect(match?.targetPort).toEqual(80);

      // Update — change the target port in place.
      const { domain: updated } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Web", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "nginx:alpine" },
            deploy: false,
          });
          const domain = yield* Railway.ServiceDomain("WebDomain", {
            service,
            targetPort: 8080,
          });
          return { service, domain };
        }),
      );

      expect(updated.domainId).toEqual(domain.domainId);
      expect(updated.targetPort).toEqual(8080);

      const reobserved = yield* getDomains({
        projectId: updated.projectId,
        environmentId: updated.environmentId,
        serviceId: updated.serviceId,
      });
      const rematch = reobserved.serviceDomains.find(
        (d) => d.id === updated.domainId,
      );
      expect(rematch?.targetPort).toEqual(8080);

      yield* stack.destroy();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 600_000 },
);
