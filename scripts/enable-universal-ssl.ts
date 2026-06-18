#!/usr/bin/env bun

// @ts-nocheck
/**
 * Ensure a Cloudflare zone serves a working edge certificate (default:
 * alchemy-test-2.us).
 *
 * `bun nuke` can leave the standing test zone without an active Universal
 * SSL certificate: a UniversalSsl test toggles the setting, then state is
 * wiped before the "restore to initial" delete runs, so Cloudflare ends up
 * with the setting reported `enabled: true` but **zero certificate packs**.
 * The zone then serves no edge cert — every hostname fails TLS, and
 * Hyperdrive's connect-time validation errors with
 * `HANDSHAKE_FAILURE_ON_CLIENT_HELLO`.
 *
 * This script makes the zone whole again:
 *   1. enable Universal SSL if disabled, and
 *   2. if it is enabled but no active cert pack exists, toggle it off→on to
 *      force Cloudflare to re-order the universal certificate.
 * It then polls until an active pack covering the apex + `*.zone` appears.
 *
 *   ZONE=alchemy-test-2.us ALCHEMY_PROFILE=testing bun scripts/enable-universal-ssl.ts
 *
 * Note: the SSL settings endpoint needs the "Zone SSL and Certificates"
 * token scope — the `testing` profile has it; a minimal `default` profile
 * may not.
 */
import * as ssl from "@distilled.cloud/cloudflare/ssl";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { AuthProviders } from "../packages/alchemy/src/Auth/AuthProvider.ts";
import { CredentialsStoreLive } from "../packages/alchemy/src/Auth/Credentials.ts";
import { ProfileLive } from "../packages/alchemy/src/Auth/Profile.ts";
import { CloudflareAuth } from "../packages/alchemy/src/Cloudflare/Auth/AuthProvider.ts";
import {
  CloudflareEnvironment,
  fromProfile,
} from "../packages/alchemy/src/Cloudflare/CloudflareEnvironment.ts";
import { fromAuthProvider } from "../packages/alchemy/src/Cloudflare/Credentials.ts";
import { findZoneByName } from "../packages/alchemy/src/Cloudflare/Zone/lookup.ts";
import {
  PlatformServices,
  runMain,
} from "../packages/alchemy/src/Util/PlatformServices.ts";

const ZONE = process.env.ZONE ?? "alchemy-test-2.us";

// The "edit setting" endpoint has its own per-zone rate limit; ride it out.
const patch = (zoneId: string, enabled: boolean) =>
  ssl.patchUniversalSetting({ zoneId, enabled }).pipe(
    Effect.retry({
      while: (e) => e._tag === "TooManyRequests",
      schedule: Schedule.spaced("20 seconds"),
      times: 6,
    }),
  );

const activePacks = (zoneId: string) =>
  ssl
    .listCertificatePacks({ zoneId })
    .pipe(
      Effect.map((p) =>
        (p.result ?? []).filter((pack) => pack.status === "active"),
      ),
    );

const program = Effect.gen(function* () {
  const { accountId } = yield* yield* CloudflareEnvironment;
  const zone = yield* findZoneByName({ accountId, name: ZONE });
  if (!zone) return yield* Effect.die(`zone "${ZONE}" not found`);
  const zoneId = zone.id;
  yield* Console.log(`zone ${ZONE} → ${zoneId}`);

  const before = yield* ssl.getUniversalSetting({ zoneId });
  const packs = yield* activePacks(zoneId);
  yield* Console.log(
    `universal SSL enabled=${before.enabled}, active cert packs=${packs.length}`,
  );

  if (before.enabled === true && packs.length > 0) {
    yield* Console.log("zone already serves an active edge cert — nothing to do");
    return;
  }

  if (before.enabled !== true) {
    yield* Console.log("enabling Universal SSL…");
    yield* patch(zoneId, true);
  } else {
    // Enabled but no cert pack — toggle off→on to force a re-order.
    yield* Console.log("enabled but no cert — toggling off→on to re-order…");
    yield* patch(zoneId, false);
    yield* Effect.sleep("8 seconds");
    yield* patch(zoneId, true);
  }

  const final = yield* activePacks(zoneId).pipe(
    Effect.tap((p) => Console.log(`waiting for active cert pack… (${p.length})`)),
    Effect.repeat({
      schedule: Schedule.spaced("15 seconds"),
      until: (p) => p.length > 0,
      times: 12,
    }),
  );
  if (final.length === 0) {
    return yield* Effect.die("no active cert pack after waiting");
  }
  yield* Console.log(
    `active edge cert: ${final[0].hosts?.join(", ")} (issuer ${final[0].issuer})`,
  );
});

const authLayer = Layer.provideMerge(
  CloudflareAuth,
  Layer.succeed(AuthProviders, {}),
);
const profile = Layer.mergeAll(
  Layer.provide(ProfileLive, PlatformServices),
  Layer.provide(CredentialsStoreLive, PlatformServices),
);
const cloudflare = Layer.mergeAll(fromAuthProvider(), fromProfile()).pipe(
  Layer.provide(authLayer),
  Layer.provide(profile),
);

runMain(
  program.pipe(Effect.provide(Layer.mergeAll(cloudflare, FetchHttpClient.layer))),
);
