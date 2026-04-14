import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import nodePath from "node:path";
import { rootDir } from "./Config.ts";

export { Redacted };

const credentialsDirPath = nodePath.join(rootDir, "credentials");

export const credentialsFilePath = (profile: string, provider: string) =>
  nodePath.join(credentialsDirPath, profile, `${provider}.json`);

export const readCredentials = <T>(
  profile: string,
  provider: string,
): Effect.Effect<T | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const data = yield* fs
      .readFileString(credentialsFilePath(profile, provider))
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (data === undefined) return undefined;
    try {
      return JSON.parse(data) as T;
    } catch {
      return undefined;
    }
  });

export const writeCredentials = <T>(
  profile: string,
  provider: string,
  credentials: T,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = credentialsFilePath(profile, provider);
    yield* fs.makeDirectory(nodePath.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(filePath, JSON.stringify(credentials, null, 2));
  });

export const deleteCredentials = (
  profile: string,
  provider: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .remove(credentialsFilePath(profile, provider))
      .pipe(Effect.catch(() => Effect.void));
  });

export function displayRedacted(
  r: Redacted.Redacted<string>,
  visibleChars = 4,
): string {
  const raw = Redacted.value(r);
  if (raw.length <= visibleChars) return "****";
  return `${raw.slice(0, visibleChars)}****`;
}
