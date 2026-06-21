import cloudflare, {
  type CloudflareVitePluginOptions,
} from "@oddlynew/distilled-cloudflare-vite-plugin";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import { createRequire } from "node:module";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import type * as vite from "vite";
import * as Bundle from "../../Bundle/Bundle.ts";
import { sha256 } from "../../Util/sha256.ts";

const DISTILLED_BUILD_MANIFEST_NAME = "__distilled-build.json";

export type DistilledWorkerModuleType =
  | "esm"
  | "wasm"
  | "data"
  | "text"
  | "json";

export interface DistilledWorkerModule {
  path: string;
  type: DistilledWorkerModuleType;
}

export interface DistilledBuildManifest {
  version: 2;
  workers: {
    app: {
      main: string;
      modules: Array<DistilledWorkerModule>;
      compatibilityDate?: string;
      compatibilityFlags?: Array<string>;
    };
  };
  assets?: {
    directory: string;
    htmlHandling?:
      | "auto-trailing-slash"
      | "force-trailing-slash"
      | "drop-trailing-slash"
      | "none";
    notFoundHandling?: "none" | "404-page" | "single-page-application";
    runWorkerFirst?: Array<string> | boolean;
  };
}

export interface DistilledBuildOutput {
  manifest: DistilledBuildManifest;
  manifestPath: string;
  manifestDirectory: string;
  bundle: Bundle.BundleOutput;
  assetsDirectory: string | undefined;
}

export interface ViteBuildOutput {
  serverBundle: vite.Rolldown.OutputBundle | undefined;
  assetsDirectory: string | undefined;
  distilled: DistilledBuildOutput | undefined;
}

export interface ViteEnvironmentOptions {
  name?: string;
  childEnvironments?: Array<string>;
}

export type CloudflareVitePluginOptionsWithAssets =
  CloudflareVitePluginOptions & {
    assets?: Omit<NonNullable<DistilledBuildManifest["assets"]>, "directory">;
    viteEnvironment?: ViteEnvironmentOptions;
  };

export const viteDev = (
  rootDir: string = process.cwd(),
  env: Record<string, unknown>,
  pluginOptions: CloudflareVitePluginOptionsWithAssets,
  serverOptions: vite.ServerOptions,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const vite = await loadVite(rootDir);
      const devServer = await vite.createServer({
        root: rootDir,
        define: getDefine(env),
        plugins: cloudflarePluginOptions(pluginOptions),
        server: serverOptions,
      });
      await devServer.listen();
      return devServer;
    }),
    (devServer) =>
      Effect.promise(async () => {
        await devServer.close();
      }),
  );

export const viteBuild = (
  rootDir: string = process.cwd(),
  env: Record<string, unknown>,
  pluginOptions: CloudflareVitePluginOptionsWithAssets,
) =>
  Effect.gen(function* () {
    const build = yield* Effect.promise(async () => {
      let serverBundle: vite.Rolldown.OutputBundle | undefined;
      let assetsDirectory: string | undefined;
      const vite = await loadVite(rootDir);
      const outputSsrPlugin: vite.Plugin = {
        name: "output:ssr",
        applyToEnvironment(environment) {
          return environment.name === "ssr";
        },
        generateBundle(_outputOptions, bundle) {
          serverBundle = bundle;
        },
      };
      const outputClientPlugin: vite.Plugin = {
        name: "output:client",
        applyToEnvironment(environment) {
          return environment.name === "client";
        },
        generateBundle(outputOptions) {
          assetsDirectory = outputOptions.dir;
        },
      };
      const builder = await vite.createBuilder(
        {
          root: rootDir,
          define: getDefine(env),
          plugins: [
            ...cloudflarePluginOptions(pluginOptions),
            outputSsrPlugin,
            outputClientPlugin,
          ],
        },
        // This is the `useLegacyBuilder` option. The Vite CLI implementation uses `null` here.
        // Originally we used `undefined` here, but this caused the static site build to fail.
        // https://github.com/vitejs/vite/blob/a07a4bd052ac75f916391c999c408ad5f2867e61/packages/vite/src/node/cli.ts#L367
        null,
      );
      await builder.buildApp();
      const outputDirectories = Object.values(builder.environments).flatMap(
        (environment) =>
          environment.config.build.outDir
            ? [
                nodePath.resolve(
                  builder.config.root,
                  environment.config.build.outDir,
                ),
              ]
            : [],
      );
      if (assetsDirectory) {
        outputDirectories.push(
          nodePath.resolve(builder.config.root, assetsDirectory),
        );
      }
      return {
        serverBundle,
        assetsDirectory,
        outputDirectories: Array.from(new Set(outputDirectories)),
      };
    });
    const distilled = yield* readDistilledBuildOutput(build.outputDirectories);
    return {
      serverBundle: build.serverBundle,
      assetsDirectory: build.assetsDirectory,
      distilled,
    } satisfies ViteBuildOutput;
  });

// Emulate `vite build` env semantics for `props.env`: only
// keys with Vite's default `VITE_` prefix are inlined into
// the bundle as `import.meta.env.*`. `Redacted` values are
// unwrapped — by prefixing with `VITE_` the user is opting
// them into the public bundle.
const getDefine = (env: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(env).flatMap(([key, raw]) => {
      if (!key.startsWith("VITE_")) return [];
      const value = Redacted.isRedacted(raw) ? Redacted.value(raw) : raw;
      return [[`import.meta.env.${key}`, JSON.stringify(value)] as const];
    }),
  );

type ViteModule = typeof import("vite");

/**
 * Dynamically load Vite from the project root. Falls back to the bundled
 * copy if the project doesn't have its own Vite installation.
 */
async function loadVite(
  projectRoot: string = process.cwd(),
): Promise<ViteModule> {
  try {
    const require = createRequire(nodePath.join(projectRoot, "package.json"));
    const vitePath = require.resolve("vite");
    // On Windows, absolute paths must be file:// URLs for ESM import().
    const viteUrl = pathToFileURL(vitePath);
    return await import(/* @vite-ignore */ viteUrl.href);
  } catch {
    // Fallback: try to import vite from the global node_modules (works for non-linked installs)
    // The fallback is a bare specifier and works as-is.
    return await import("vite");
  }
}

const cloudflarePluginOptions = (
  pluginOptions: CloudflareVitePluginOptionsWithAssets,
) => {
  const plugins = cloudflare(pluginOptions);
  const filtered: Array<vite.Plugin> = [];
  for (const plugin of Array.isArray(plugins) ? plugins : [plugins]) {
    if (plugin) {
      filtered.push(plugin as vite.Plugin);
    }
  }
  return filtered;
};

const readDistilledBuildOutput = Effect.fnUntraced(function* (
  outputDirectories: ReadonlyArray<string>,
) {
  const path = yield* Path.Path;
  const manifestPaths = Array.from(
    new Set(
      outputDirectories.flatMap((directory) => [
        path.join(path.dirname(directory), DISTILLED_BUILD_MANIFEST_NAME),
      ]),
    ),
  );

  for (const manifestPath of manifestPaths) {
    const text = yield* readOptionalString(manifestPath);
    if (text === undefined) continue;
    const manifest = yield* parseDistilledBuildManifest(manifestPath, text);
    const manifestDirectory = path.dirname(manifestPath);
    const bundle = yield* readDistilledWorkerBundle(
      manifestDirectory,
      manifest,
    );
    const assetsDirectory = manifest.assets
      ? yield* resolveManifestPath(
          manifestDirectory,
          manifest.assets.directory,
          "assets directory",
        )
      : undefined;
    return {
      manifest,
      manifestPath,
      manifestDirectory,
      bundle,
      assetsDirectory,
    } satisfies DistilledBuildOutput;
  }
  return undefined;
});

const readOptionalString = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(file)
    .pipe(
      Effect.catchIf(isNotFoundPlatformError, () => Effect.succeed(undefined)),
    );
});

const readDistilledWorkerBundle = Effect.fnUntraced(function* (
  manifestDirectory: string,
  manifest: DistilledBuildManifest,
) {
  const mainModule = manifest.workers.app.modules.find(
    (module) => module.path === manifest.workers.app.main,
  );
  if (!mainModule) {
    return yield* new Bundle.BundleError({
      message: `Distilled build manifest main module "${manifest.workers.app.main}" is not listed in workers.app.modules`,
    });
  }
  const modules = [
    mainModule,
    ...manifest.workers.app.modules.filter(
      (module) => module.path !== mainModule.path,
    ),
  ] as [DistilledWorkerModule, ...DistilledWorkerModule[]];
  const files = yield* Effect.forEach(
    modules,
    (module) => readDistilledModuleFile(manifestDirectory, module),
    { concurrency: "unbounded" },
  );
  return yield* Bundle.bundleOutputFromFiles(
    files as [Bundle.BundleFile, ...Bundle.BundleFile[]],
  );
});

const readDistilledModuleFile = Effect.fnUntraced(function* (
  manifestDirectory: string,
  module: DistilledWorkerModule,
) {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* resolveManifestPath(
    manifestDirectory,
    module.path,
    `worker module "${module.path}"`,
  );
  const content = yield* fs.readFile(file).pipe(
    Effect.mapError(
      (cause) =>
        new Bundle.BundleError({
          message: `Failed to read distilled worker module "${file}"`,
          cause,
        }),
    ),
  );
  const hash = yield* sha256(content);
  return {
    path: module.path,
    content,
    hash,
    contentType: contentTypeFromDistilledModuleType(module.type),
  } satisfies Bundle.BundleFile;
});

const resolveManifestPath = Effect.fnUntraced(function* (
  manifestDirectory: string,
  relativePath: string,
  label: string,
) {
  const path = yield* Path.Path;
  const resolved = path.resolve(manifestDirectory, relativePath);
  if (!isPathInside(manifestDirectory, resolved)) {
    return yield* new Bundle.BundleError({
      message: `Distilled build manifest ${label} resolves outside the manifest directory`,
    });
  }
  return resolved;
});

const parseDistilledBuildManifest = (manifestPath: string, text: string) =>
  Effect.try({
    try: () => validateDistilledBuildManifest(JSON.parse(text)),
    catch: (cause) =>
      new Bundle.BundleError({
        message: `Invalid distilled build manifest at "${manifestPath}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        cause,
      }),
  });

function validateDistilledBuildManifest(
  value: unknown,
): DistilledBuildManifest {
  assertRecord(value, "manifest");
  if (value.version !== 2) {
    throw new Error("expected version 2");
  }
  assertRecord(value.workers, "workers");
  const unsupportedWorkers = Object.keys(value.workers).filter(
    (name) => name !== "app",
  );
  if (unsupportedWorkers.length > 0) {
    throw new Error(
      `workers contains unsupported entries: ${unsupportedWorkers.join(", ")}`,
    );
  }
  assertRecord(value.workers.app, "workers.app");
  const app = value.workers.app;
  assertString(app.main, "workers.app.main");
  assertRelativeManifestPath(app.main, "workers.app.main");
  if (!Array.isArray(app.modules) || app.modules.length === 0) {
    throw new Error("workers.app.modules must be a non-empty array");
  }
  const modules = app.modules.map((module, index) => {
    assertRecord(module, `workers.app.modules[${index}]`);
    assertString(module.path, `workers.app.modules[${index}].path`);
    assertRelativeManifestPath(
      module.path,
      `workers.app.modules[${index}].path`,
    );
    if (!isDistilledWorkerModuleType(module.type)) {
      throw new Error(
        `workers.app.modules[${index}].type must be one of esm, wasm, data, text, json`,
      );
    }
    return {
      path: module.path,
      type: module.type,
    };
  });
  if (new Set(modules.map((module) => module.path)).size !== modules.length) {
    throw new Error("workers.app.modules must not contain duplicate paths");
  }
  const compatibilityDate = optionalString(
    app.compatibilityDate,
    "workers.app.compatibilityDate",
  );
  const compatibilityFlags = optionalStringArray(
    app.compatibilityFlags,
    "workers.app.compatibilityFlags",
  );
  const assets = validateOptionalDistilledAssets(value.assets);
  return {
    version: 2,
    workers: {
      app: {
        main: app.main,
        modules,
        ...(compatibilityDate !== undefined ? { compatibilityDate } : {}),
        ...(compatibilityFlags !== undefined ? { compatibilityFlags } : {}),
      },
    },
    ...(assets !== undefined ? { assets } : {}),
  };
}

function validateOptionalDistilledAssets(
  value: unknown,
): DistilledBuildManifest["assets"] | undefined {
  if (value === undefined) return undefined;
  assertRecord(value, "assets");
  assertString(value.directory, "assets.directory");
  assertRelativeManifestPath(value.directory, "assets.directory");
  const htmlHandling = optionalString(
    value.htmlHandling,
    "assets.htmlHandling",
  );
  if (
    htmlHandling !== undefined &&
    !isDistilledAssetHtmlHandling(htmlHandling)
  ) {
    throw new Error("assets.htmlHandling has an unsupported value");
  }
  const notFoundHandling = optionalString(
    value.notFoundHandling,
    "assets.notFoundHandling",
  );
  if (
    notFoundHandling !== undefined &&
    !isDistilledAssetNotFoundHandling(notFoundHandling)
  ) {
    throw new Error("assets.notFoundHandling has an unsupported value");
  }
  const runWorkerFirst = validateOptionalRunWorkerFirst(value.runWorkerFirst);
  return {
    directory: value.directory,
    ...(htmlHandling !== undefined ? { htmlHandling } : {}),
    ...(notFoundHandling !== undefined ? { notFoundHandling } : {}),
    ...(runWorkerFirst !== undefined ? { runWorkerFirst } : {}),
  };
}

function validateOptionalRunWorkerFirst(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value;
  }
  throw new Error("assets.runWorkerFirst must be a boolean or string array");
}

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
}

function assertRelativeManifestPath(value: string, label: string) {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  ) {
    throw new Error(`${label} must be a relative manifest path`);
  }
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) return undefined;
  assertString(value, label);
  return value;
}

function optionalStringArray(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function isDistilledWorkerModuleType(
  value: unknown,
): value is DistilledWorkerModuleType {
  return (
    value === "esm" ||
    value === "wasm" ||
    value === "data" ||
    value === "text" ||
    value === "json"
  );
}

function isDistilledAssetHtmlHandling(
  value: string,
): value is NonNullable<
  NonNullable<DistilledBuildManifest["assets"]>["htmlHandling"]
> {
  return (
    value === "auto-trailing-slash" ||
    value === "force-trailing-slash" ||
    value === "drop-trailing-slash" ||
    value === "none"
  );
}

function isDistilledAssetNotFoundHandling(
  value: string,
): value is NonNullable<
  NonNullable<DistilledBuildManifest["assets"]>["notFoundHandling"]
> {
  return (
    value === "none" ||
    value === "404-page" ||
    value === "single-page-application"
  );
}

function contentTypeFromDistilledModuleType(type: DistilledWorkerModuleType) {
  switch (type) {
    case "esm":
      return "application/javascript+module";
    case "wasm":
      return "application/wasm";
    case "text":
      return "text/plain";
    case "json":
      return "application/json";
    case "data":
      return "application/octet-stream";
  }
}

function isPathInside(root: string, file: string) {
  const relative = nodePath.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !nodePath.isAbsolute(relative))
  );
}

function isNotFoundPlatformError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "PlatformError" &&
    "reason" in error &&
    typeof error.reason === "object" &&
    error.reason !== null &&
    "_tag" in error.reason &&
    error.reason._tag === "NotFound"
  );
}
