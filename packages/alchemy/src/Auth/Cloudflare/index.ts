import * as p from "@clack/prompts";
import * as CfCredentialsModule from "@distilled.cloud/cloudflare/Credentials";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import type { PlatformError } from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import { StageConfig } from "../../Cloudflare/StageConfig.ts";
import type { AuthProvider } from "../AuthProvider.ts";
import {
  credentialsFilePath,
  deleteCredentials,
  displayRedacted,
  readCredentials,
  writeCredentials,
} from "../Credentials.ts";

export type CloudflareAuthConfig =
  | { method: "env"; accountId?: string }
  | { method: "stored"; credentialType: "apiToken"; accountId?: string }
  | { method: "stored"; credentialType: "apiKey"; accountId?: string };

export type CloudflareStoredCredentials =
  | { type: "apiToken"; apiToken: string }
  | { type: "apiKey"; apiKey: string; email: string };

export type CloudflareResolvedCredentials =
  | {
      type: "apiToken";
      apiToken: Redacted.Redacted<string>;
      source: string;
    }
  | {
      type: "apiKey";
      apiKey: Redacted.Redacted<string>;
      email: string;
      source: string;
    };

export function resolveFromEnv(): CloudflareResolvedCredentials | undefined {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (apiToken) {
    return {
      type: "apiToken",
      apiToken: Redacted.make(apiToken),
      source: "environment variables",
    };
  }
  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL;
  if (apiKey && email) {
    return {
      type: "apiKey",
      apiKey: Redacted.make(apiKey),
      email,
      source: "environment variables",
    };
  }
  return undefined;
}

export const resolveFromStored = (
  profileName: string,
): Effect.Effect<
  CloudflareResolvedCredentials | undefined,
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const creds = yield* readCredentials<CloudflareStoredCredentials>(
      profileName,
      "cloudflare",
    );
    if (!creds) return undefined;
    const source = credentialsFilePath(profileName, "cloudflare");
    return Match.value(creds).pipe(
      Match.when({ type: "apiToken" }, (c) => ({
        type: "apiToken" as const,
        apiToken: Redacted.make(c.apiToken),
        source,
      })),
      Match.when({ type: "apiKey" }, (c) => ({
        type: "apiKey" as const,
        apiKey: Redacted.make(c.apiKey),
        email: c.email,
        source,
      })),
      Match.exhaustive,
    );
  });

const promptAccountId = (): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const envAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const result = yield* Effect.promise(() =>
      p.text({
        message: "Cloudflare Account ID (Enter to skip)",
        placeholder: envAccountId ?? "",
        defaultValue: envAccountId ?? "",
      }),
    );
    if (p.isCancel(result)) return undefined;
    return result || undefined;
  });

export const configure = (
  profileName: string,
  isReconfigure = false,
): Effect.Effect<
  CloudflareAuthConfig | "remove" | undefined,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const options: {
      value: "env" | "stored" | "remove";
      label: string;
      hint?: string;
    }[] = [
      {
        value: "env",
        label: "Environment Variables",
        hint: "CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL",
      },
      {
        value: "stored",
        label: "Stored",
        hint: "stored in ~/.alchemy/credentials",
      },
    ];
    if (isReconfigure) {
      options.push({
        value: "remove",
        label: "Remove",
        hint: "remove Cloudflare from this profile",
      });
    }

    const method = yield* Effect.promise(() =>
      p.select({
        message: "Cloudflare authentication method",
        options,
      }),
    );
    if (p.isCancel(method)) return undefined;

    return yield* Match.value(method).pipe(
      Match.when("remove", () => Effect.succeed("remove" as const)),
      Match.when("env", () =>
        Effect.gen(function* () {
          const accountId = yield* promptAccountId();
          if (accountId === undefined) return undefined;
          return {
            method: "env" as const,
            ...(accountId ? { accountId } : {}),
          };
        }),
      ),
      Match.when("stored", () =>
        Effect.gen(function* () {
          const credentialType = yield* Effect.promise(() =>
            p.select({
              message: "Cloudflare credential type",
              options: [
                {
                  value: "apiToken" as const,
                  label: "API Token",
                  hint: "recommended",
                },
                { value: "apiKey" as const, label: "API Key + Email" },
              ],
            }),
          );
          if (p.isCancel(credentialType)) return undefined;

          return yield* Match.value(credentialType).pipe(
            Match.when("apiToken", () =>
              Effect.gen(function* () {
                const apiToken = yield* Effect.promise(() =>
                  p.password({
                    message: "Cloudflare API Token",
                    validate: (v) => (v.length === 0 ? "Required" : undefined),
                  }),
                );
                if (p.isCancel(apiToken)) return undefined;

                yield* writeCredentials<CloudflareStoredCredentials>(
                  profileName,
                  "cloudflare",
                  { type: "apiToken", apiToken },
                );
                p.log.success("Cloudflare credentials saved.");
                const accountId = yield* promptAccountId();
                if (accountId === undefined) return undefined;
                return {
                  method: "stored" as const,
                  credentialType: "apiToken" as const,
                  ...(accountId ? { accountId } : {}),
                };
              }),
            ),
            Match.when("apiKey", () =>
              Effect.gen(function* () {
                const apiKey = yield* Effect.promise(() =>
                  p.text({
                    message: "Cloudflare API Key",
                    validate: (v) => (v.length === 0 ? "Required" : undefined),
                  }),
                );
                if (p.isCancel(apiKey)) return undefined;

                const email = yield* Effect.promise(() =>
                  p.text({
                    message: "Cloudflare Email",
                    validate: (v) => (v.length === 0 ? "Required" : undefined),
                  }),
                );
                if (p.isCancel(email)) return undefined;

                yield* writeCredentials<CloudflareStoredCredentials>(
                  profileName,
                  "cloudflare",
                  { type: "apiKey", apiKey, email },
                );
                p.log.success("Cloudflare credentials saved.");
                const accountId = yield* promptAccountId();
                if (accountId === undefined) return undefined;
                return {
                  method: "stored" as const,
                  credentialType: "apiKey" as const,
                  ...(accountId ? { accountId } : {}),
                };
              }),
            ),
            Match.exhaustive,
          );
        }),
      ),
      Match.exhaustive,
    );
  });

const matchMethod = Match.discriminator("method");

export const login = (config: CloudflareAuthConfig): Effect.Effect<void> =>
  Match.value(config).pipe(
    matchMethod("env", () =>
      Effect.sync(() =>
        p.log.info(
          "Cloudflare: using environment variables — no login required.",
        ),
      ),
    ),
    matchMethod("stored", () =>
      Effect.sync(() =>
        p.log.info("Cloudflare: using stored credentials — no login required."),
      ),
    ),
    Match.exhaustive,
  );

export const logout = (
  profileName: string,
  config: CloudflareAuthConfig,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Match.value(config).pipe(
    matchMethod("stored", () =>
      Effect.gen(function* () {
        yield* deleteCredentials(profileName, "cloudflare");
        p.log.success("Cloudflare stored credentials removed.");
      }),
    ),
    matchMethod("env", () =>
      Effect.sync(() =>
        p.log.info(
          "Cloudflare: using environment variables — nothing to log out of.",
        ),
      ),
    ),
    Match.exhaustive,
  ) as Effect.Effect<void, never, FileSystem.FileSystem>;

function printAccountId(accountId: string | undefined): void {
  const resolved = accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  console.log(
    `  accountId: ${resolved ?? "(not set — configure or set CLOUDFLARE_ACCOUNT_ID)"}`,
  );
}

function printCredentials(creds: CloudflareResolvedCredentials): void {
  Match.value(creds).pipe(
    Match.when({ type: "apiToken" }, (c) => {
      console.log(`  apiToken: ${displayRedacted(c.apiToken, 9)}`);
    }),
    Match.when({ type: "apiKey" }, (c) => {
      console.log(`  apiKey: ${displayRedacted(c.apiKey)}`);
      console.log(`  email:  ${c.email}`);
    }),
    Match.exhaustive,
  );
  console.log(`  source: ${creds.source}`);
}

export const viewAuth = (
  profileName: string,
  config: CloudflareAuthConfig,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Match.value(config).pipe(
    matchMethod("env", (c) =>
      Effect.sync(() => {
        console.log("Cloudflare: env");
        const resolved = resolveFromEnv();
        if (!resolved) {
          console.log("  CLOUDFLARE_API_TOKEN: (not set)");
          console.log("  CLOUDFLARE_API_KEY:   (not set)");
          console.log("  CLOUDFLARE_EMAIL:     (not set)");
        } else {
          printCredentials(resolved);
        }
        printAccountId(c.accountId);
      }),
    ),
    matchMethod("stored", (c) =>
      Effect.gen(function* () {
        console.log(`Cloudflare: stored (${c.credentialType})`);
        const resolved = yield* resolveFromStored(profileName);
        if (!resolved) {
          console.log(
            "  ERROR: credentials not found. Run: alchemy-effect login --configure",
          );
        } else {
          printCredentials(resolved);
        }
        printAccountId(c.accountId);
      }),
    ),
    Match.exhaustive,
  ) as Effect.Effect<void, never, FileSystem.FileSystem>;

export const credentialsLayer = (
  profileName: string,
  config: CloudflareAuthConfig,
): Layer.Layer<CfCredentialsModule.Credentials, any, any> =>
  Match.value(config).pipe(
    matchMethod("env", () => CfCredentialsModule.fromEnv()),
    matchMethod("stored", () =>
      Layer.unwrap(
        readCredentials<CloudflareStoredCredentials>(
          profileName,
          "cloudflare",
        ).pipe(
          Effect.map((creds) => {
            if (!creds) {
              return Layer.effectDiscard(
                Effect.die(
                  "Cloudflare stored credentials not found. Run: alchemy-effect login --configure",
                ),
              ) as Layer.Layer<CfCredentialsModule.Credentials>;
            }
            return Match.value(creds).pipe(
              Match.when({ type: "apiToken" }, (c) =>
                CfCredentialsModule.fromApiToken({ apiToken: c.apiToken }),
              ),
              Match.when({ type: "apiKey" }, (c) =>
                CfCredentialsModule.fromApiKey({
                  apiKey: c.apiKey,
                  email: c.email,
                }),
              ),
              Match.exhaustive,
            );
          }),
        ),
      ),
    ),
    Match.exhaustive,
  );

export const stageConfigLayer = (
  config: CloudflareAuthConfig,
): Layer.Layer<StageConfig> =>
  Layer.succeed(StageConfig, {
    account: config.accountId,
  });

export const provider: AuthProvider<CloudflareAuthConfig> = {
  name: "Cloudflare",
  configure,
  login,
  logout,
  viewAuth,
  credentialsLayer,
};
