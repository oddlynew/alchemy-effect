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

// DNS for this domain is never configured — the test only asserts that the
// domain attaches, reports its required DNS records, and detaches cleanly.
const TEST_DOMAIN = "alchemy-railway-test.alchemy-effect.example.com";

test.provider(
  "attach and detach a custom domain (no DNS validation)",
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
          const domain = yield* Railway.CustomDomain("WebDomain", {
            service,
            domain: TEST_DOMAIN,
          });
          return { service, domain };
        }),
      );

      expect(domain.domainId).toBeDefined();
      expect(domain.domain).toEqual(TEST_DOMAIN);
      expect(domain.serviceId).toEqual(service.serviceId);
      expect(domain.environmentId).toEqual(service.environmentId);
      expect(domain.dnsRecords.length).toBeGreaterThan(0);
      expect(domain.dnsRecords[0]!.requiredValue).toBeDefined();

      const observed = yield* getDomains({
        projectId: domain.projectId,
        environmentId: domain.environmentId,
        serviceId: domain.serviceId,
      });
      const match = observed.customDomains.find(
        (d) => d.id === domain.domainId,
      );
      expect(match?.domain).toEqual(TEST_DOMAIN);

      // Re-deploy with identical props — must be a stable no-op.
      const { domain: stable } = yield* stack.deploy(
        Effect.gen(function* () {
          const service = yield* Railway.Service("Web", {
            project: { projectId },
            environment: { environmentId },
            source: { image: "nginx:alpine" },
            deploy: false,
          });
          const domain = yield* Railway.CustomDomain("WebDomain", {
            service,
            domain: TEST_DOMAIN,
          });
          return { service, domain };
        }),
      );
      expect(stable.domainId).toEqual(domain.domainId);

      yield* stack.destroy();

      const after = yield* getDomains({
        projectId: domain.projectId,
        environmentId: domain.environmentId,
        serviceId: domain.serviceId,
      }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
      );
      expect(
        after?.customDomains.find((d) => d.id === domain.domainId),
      ).toBeUndefined();
    }).pipe(
      // Always tear down what the test deployed, even when an assertion or
      // deploy fails mid-way — keeps the shared project free of orphans.
      Effect.ensuring(Effect.ignore(stack.destroy())),
      logLevel,
    ),
  { timeout: 600_000 },
);
