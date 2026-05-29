import * as Cloudflare from "@/Cloudflare";
import * as Test from "@/Test/Vitest";
import * as dns from "@distilled.cloud/cloudflare/dns";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { MinimumLogLevel } from "effect/References";

const { test } = Test.make({ providers: Cloudflare.providers() });

const logLevel = Effect.provideService(
  MinimumLogLevel,
  process.env.DEBUG ? "Debug" : "Info",
);

// A real zone is required to exercise these against Cloudflare. Until a
// dedicated test zone is wired up they stay `.skip`. Set the zone id/name
// and flip `.skip` -> `.skipIf(!zoneId)` to run them.
const zoneId = process.env.CLOUDFLARE_TEST_DNS_ZONE_ID;
const zoneName =
  process.env.CLOUDFLARE_TEST_DNS_ZONE_NAME ?? "alchemy-test-2.us";

const recordName = (label: string) => `${label}.${zoneName}`;

const getLive = (recordId: string) =>
  dns.getRecord({ zoneId: zoneId!, dnsRecordId: recordId }).pipe(
    Effect.asSome,
    Effect.catchTag("CloudflareHttpError", (error) =>
      error.status === 404 ? Effect.succeedNone : Effect.fail(error),
    ),
  );

test.provider.skip(
  "creates, updates in place, and deletes an A record",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      yield* Effect.gen(function* () {
        const created = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.DnsRecord("Record", {
              zone: { zoneId: zoneId!, name: zoneName },
              name: recordName("a-record"),
              type: "A",
              content: "192.0.2.1",
              proxied: false,
            });
          }),
        );

        expect(created.zoneId).toEqual(zoneId);
        expect(created.type).toEqual("A");
        expect(created.content).toEqual("192.0.2.1");
        expect(created.recordId).toBeTruthy();

        const live = yield* getLive(created.recordId);
        expect(Option.isSome(live)).toBe(true);
        expect(Option.getOrThrow(live).content).toEqual("192.0.2.1");

        // Changing content + ttl is an in-place PUT: same record id.
        const updated = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.DnsRecord("Record", {
              zone: { zoneId: zoneId!, name: zoneName },
              name: recordName("a-record"),
              type: "A",
              content: "192.0.2.2",
              ttl: 300,
              proxied: false,
            });
          }),
        );

        expect(updated.recordId).toEqual(created.recordId);
        expect(updated.content).toEqual("192.0.2.2");
        expect(updated.ttl).toEqual(300);

        yield* stack.destroy();

        const afterDelete = yield* getLive(created.recordId);
        expect(Option.isNone(afterDelete)).toBe(true);
      }).pipe(Effect.ensuring(stack.destroy().pipe(Effect.ignore)));
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider.skip(
  "creates a proxied CNAME record",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      yield* Effect.gen(function* () {
        const created = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.DnsRecord("Cname", {
              zone: { zoneId: zoneId!, name: zoneName },
              name: recordName("docs"),
              type: "CNAME",
              content: "example.pages.dev",
              proxied: true,
            });
          }),
        );

        expect(created.type).toEqual("CNAME");
        expect(created.content).toEqual("example.pages.dev");
        expect(created.proxied).toBe(true);
      }).pipe(Effect.ensuring(stack.destroy().pipe(Effect.ignore)));
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider.skip(
  "creates an MX record with priority",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      yield* Effect.gen(function* () {
        const created = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.DnsRecord("Mx", {
              zone: { zoneId: zoneId!, name: zoneName },
              name: zoneName,
              type: "MX",
              content: recordName("mail"),
              priority: 10,
            });
          }),
        );

        expect(created.type).toEqual("MX");
        expect(created.priority).toEqual(10);
      }).pipe(Effect.ensuring(stack.destroy().pipe(Effect.ignore)));
    }).pipe(logLevel),
  { timeout: 120_000 },
);

test.provider.skip(
  "creates a TXT record",
  (stack) =>
    Effect.gen(function* () {
      yield* stack.destroy();

      yield* Effect.gen(function* () {
        const created = yield* stack.deploy(
          Effect.gen(function* () {
            return yield* Cloudflare.DnsRecord("Txt", {
              zone: { zoneId: zoneId!, name: zoneName },
              name: zoneName,
              type: "TXT",
              content: "v=spf1 include:_spf.example.com ~all",
            });
          }),
        );

        expect(created.type).toEqual("TXT");
        expect(created.content).toContain("v=spf1");
      }).pipe(Effect.ensuring(stack.destroy().pipe(Effect.ignore)));
    }).pipe(logLevel),
  { timeout: 120_000 },
);
