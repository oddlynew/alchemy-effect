import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Redacted from "effect/Redacted";
import {
  AuthError,
  AuthProviderLayer,
  type ConfigureContext,
} from "../Auth/AuthProvider.ts";
import { CredentialsStore, displayRedacted } from "../Auth/Credentials.ts";
import { getEnvRedacted, retryOnce } from "../Auth/Env.ts";
import { AlchemyProfile } from "../Auth/Profile.ts";
import * as Clank from "../Util/Clank.ts";

export const RAILWAY_AUTH_PROVIDER_NAME = "Railway";

export type RailwayAuthConfig = { method: "env" } | { method: "stored" };

export type RailwayStoredCredentials = {
  type: "apiToken";
  apiToken: string;
};

export type RailwayResolvedCredentials = {
  type: "apiToken" | "projectToken";
  token: Redacted.Redacted<string>;
  source: { type: RailwayAuthConfig["method"]; details?: string };
};

const options: Array<{
  value: RailwayAuthConfig["method"];
  label: string;
  hint?: string;
}> = [
  {
    value: "env",
    label: "Environment Variable",
    hint: "RAILWAY_API_TOKEN or RAILWAY_PROJECT_TOKEN",
  },
  {
    value: "stored",
    label: "API Token",
    hint: "enter interactively, stored in ~/.alchemy/credentials",
  },
];

/**
 * Layer that registers the Railway {@link AuthProvider} into the
 * {@link AuthProviders} registry.
 */
export const RailwayAuth = AuthProviderLayer<
  RailwayAuthConfig,
  RailwayResolvedCredentials
>()(
  RAILWAY_AUTH_PROVIDER_NAME,
  Effect.gen(function* () {
    const profiles = yield* AlchemyProfile;
    const store = yield* CredentialsStore;

    const loginStored = Effect.fnUntraced(function* (profileName: string) {
      const apiToken = yield* Clank.password({
        message: "Railway API Token (https://railway.com/account/tokens)",
        validate: (v) => (v.length === 0 ? "Required" : undefined),
      }).pipe(retryOnce);

      yield* store.write<RailwayStoredCredentials>(
        profileName,
        "railway-stored",
        {
          type: "apiToken",
          apiToken,
        },
      );
      yield* Clank.success("Railway: credentials saved.");
      return { method: "stored" as const };
    });

    const configureInteractive = (profileName: string) =>
      Clank.select({
        message: "Railway authentication method",
        options,
      }).pipe(
        Effect.flatMap((method) =>
          Match.value(method).pipe(
            Match.when("env", () => Effect.succeed({ method: "env" as const })),
            Match.when("stored", () => loginStored(profileName)),
            Match.exhaustive,
          ),
        ),
      );

    const configureCredentials = (profileName: string, ctx: ConfigureContext) =>
      Effect.gen(function* () {
        if (ctx.ci) {
          return { method: "env" as const };
        }
        return yield* configureInteractive(profileName);
      }).pipe(
        Effect.mapError(
          (e) =>
            new AuthError({
              message: "failed to configure credentials",
              cause: e,
            }),
        ),
      );

    const resolveCredentials = (
      profileName: string,
      config: RailwayAuthConfig,
    ): Effect.Effect<RailwayResolvedCredentials, AuthError> =>
      Match.value(config).pipe(
        Match.when(
          { method: "env" },
          Effect.fnUntraced(function* () {
            const apiToken = yield* getEnvRedacted("RAILWAY_API_TOKEN");
            if (apiToken) {
              return {
                type: "apiToken" as const,
                token: apiToken,
                source: { type: "env" as const, details: "RAILWAY_API_TOKEN" },
              };
            }
            const projectToken = yield* getEnvRedacted("RAILWAY_PROJECT_TOKEN");
            if (projectToken) {
              return {
                type: "projectToken" as const,
                token: projectToken,
                source: {
                  type: "env" as const,
                  details: "RAILWAY_PROJECT_TOKEN",
                },
              };
            }
            return yield* new AuthError({
              message:
                "Railway env credentials not found. Set RAILWAY_API_TOKEN (or RAILWAY_PROJECT_TOKEN).",
            });
          }),
        ),
        Match.when({ method: "stored" }, () =>
          store
            .read<RailwayStoredCredentials>(profileName, "railway-stored")
            .pipe(
              Effect.flatMap((creds) =>
                creds == null
                  ? Effect.fail(
                      new AuthError({
                        message:
                          "Railway stored credentials not found. Run: alchemy-effect login --configure",
                      }),
                    )
                  : Effect.succeed({
                      type: "apiToken" as const,
                      token: Redacted.make(creds.apiToken),
                      source: { type: "stored" as const },
                    }),
              ),
            ),
        ),
        Match.exhaustive,
      );

    const logout = (profileName: string, config: RailwayAuthConfig) =>
      Match.value(config).pipe(
        Match.when({ method: "env" }, () => Effect.void),
        Match.when({ method: "stored" }, () =>
          store
            .delete(profileName, "railway-stored")
            .pipe(
              Effect.andThen(
                Clank.success("Railway: stored credentials removed"),
              ),
            ),
        ),
        Match.exhaustive,
      );

    const login = (profileName: string, config: RailwayAuthConfig) =>
      Match.value(config)
        .pipe(
          Match.when({ method: "env" }, () =>
            // If neither env var is set, fall through to the interactive
            // picker so the user can switch to `stored` instead of silently
            // failing later in `read`.
            getEnvRedacted("RAILWAY_API_TOKEN").pipe(
              Effect.flatMap((apiToken) =>
                apiToken
                  ? Effect.void
                  : getEnvRedacted("RAILWAY_PROJECT_TOKEN").pipe(
                      Effect.flatMap((projectToken) =>
                        projectToken
                          ? Effect.void
                          : Effect.gen(function* () {
                              const next =
                                yield* configureInteractive(profileName);
                              const existing =
                                yield* profiles.getProfile(profileName);
                              yield* profiles.setProfile(profileName, {
                                ...existing,
                                [RAILWAY_AUTH_PROVIDER_NAME]: next,
                              });
                            }),
                      ),
                    ),
              ),
            ),
          ),
          Match.when({ method: "stored" }, () =>
            store
              .read<RailwayStoredCredentials>(profileName, "railway-stored")
              .pipe(
                Effect.flatMap((creds) =>
                  creds == null ? loginStored(profileName) : Effect.void,
                ),
              ),
          ),
          Match.exhaustive,
        )
        .pipe(
          Effect.mapError(
            (e) => new AuthError({ message: "login failed", cause: e }),
          ),
        );

    const prettyPrint = (profileName: string, config: RailwayAuthConfig) =>
      resolveCredentials(profileName, config).pipe(
        Effect.tap((creds) => {
          const sourceStr = creds.source.details
            ? `${creds.source.type} - ${creds.source.details}`
            : creds.source.type;
          return Effect.all([
            Console.log(`  token: ${displayRedacted(creds.token, 9)}`),
            Console.log(`  source: ${sourceStr}`),
          ]);
        }),
        Effect.catch((e) =>
          Console.error(`  Failed to retrieve credentials: ${e}`),
        ),
      );

    return {
      configure: configureCredentials,
      logout,
      login,
      prettyPrint,
      read: resolveCredentials,
    };
  }),
);
