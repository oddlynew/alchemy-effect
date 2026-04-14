import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import type { PlatformError } from "effect/PlatformError";

export interface AuthProvider<Config> {
  readonly name: string;

  configure(
    profileName: string,
    isReconfigure: boolean,
  ): Effect.Effect<
    Config | "remove" | undefined,
    PlatformError,
    FileSystem.FileSystem
  >;

  login(config: Config): Effect.Effect<void, any>;

  logout(
    profileName: string,
    config: Config,
  ): Effect.Effect<void, never, FileSystem.FileSystem>;

  viewAuth(
    profileName: string,
    config: Config,
    extra?: any,
  ): Effect.Effect<void, never, FileSystem.FileSystem>;

  credentialsLayer(
    profileName: string,
    config: Config,
  ): Layer.Layer<any, any, any>;
}
