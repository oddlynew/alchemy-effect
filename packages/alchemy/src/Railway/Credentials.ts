import { ConfigError } from "@distilled.cloud/core/errors";
import { Credentials, DEFAULT_API_BASE_URL } from "@distilled.cloud/railway";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { getAuthProvider } from "../Auth/AuthProvider.ts";
import { ALCHEMY_PROFILE, AlchemyProfile } from "../Auth/Profile.ts";
import {
  RAILWAY_AUTH_PROVIDER_NAME,
  type RailwayAuthConfig,
  type RailwayResolvedCredentials,
} from "./AuthProvider.ts";

export { Credentials } from "@distilled.cloud/railway";

export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const profile = yield* AlchemyProfile;
      const auth = yield* getAuthProvider<
        RailwayAuthConfig,
        RailwayResolvedCredentials
      >(RAILWAY_AUTH_PROVIDER_NAME);
      const profileName = yield* ALCHEMY_PROFILE;
      const ci = yield* Config.boolean("CI").pipe(Config.withDefault(false));
      const apiBaseUrl = yield* Config.string("RAILWAY_API_URL").pipe(
        Config.withDefault(DEFAULT_API_BASE_URL),
      );

      // Env-first: when RAILWAY_API_TOKEN / RAILWAY_PROJECT_TOKEN is set we
      // never prompt — read directly without touching the profile store.
      const envCreds = yield* auth
        .read(profileName, { method: "env" })
        .pipe(Effect.option);
      if (envCreds._tag === "Some") {
        const creds = envCreds.value;
        return Effect.succeed(
          creds.type === "projectToken"
            ? { projectToken: creds.token, apiBaseUrl }
            : { apiToken: creds.token, apiBaseUrl },
        );
      }

      return yield* profile.loadOrConfigure(auth, profileName, { ci }).pipe(
        Effect.flatMap((config) =>
          auth.read(profileName, config as RailwayAuthConfig),
        ),
        Effect.map((creds) =>
          creds.type === "projectToken"
            ? { projectToken: creds.token, apiBaseUrl }
            : { apiToken: creds.token, apiBaseUrl },
        ),
        Effect.mapError(
          (e) =>
            new ConfigError({
              message: `Failed to resolve Railway credentials for profile '${profileName}': ${(e as { message?: string }).message ?? String(e)}`,
            }),
        ),
        Effect.orDie,
        Effect.cached,
      );
    }),
  );
