import {
  Credentials,
  createService,
  createServiceDomain,
  deleteService,
  deleteVariable,
  getDomains,
  getEnvironments,
  getProject,
  getService,
  getServiceInstance,
  getVariables,
  updateService,
  updateServiceInstance,
  upsertVariableCollection,
} from "@distilled.cloud/railway";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { ChildProcess } from "effect/unstable/process";
import type * as rolldown from "rolldown";
import * as Bundle from "../Bundle/Bundle.ts";
import { findCwdForBundle } from "../Bundle/TempRoot.ts";
import { isResolved } from "../Diff.ts";
import { ExecutionContext } from "../ExecutionContext.ts";
import { HttpServer, type HttpEffect } from "../Http.ts";
import * as Output from "../Output.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import {
  Platform,
  type Main,
  type PlatformProps,
  type PlatformServices,
} from "../Platform.ts";
import * as Provider from "../Provider.ts";
import type { Resource, ResourceBinding } from "../Resource.ts";
import { Self } from "../Self.ts";
import type * as Server from "../Server/Process.ts";
import { Stack } from "../Stack.ts";
import { exec } from "../Util/exec.ts";
import { sha256Object } from "../Util/sha256.ts";
import {
  resolveEnvironmentId,
  resolveProjectId,
  type EnvironmentSource,
  type ProjectSource,
} from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import {
  findServiceByName,
  syncBoundVolumes,
  waitForDeployment,
  type DeploymentStatus,
  type RailwayRestartPolicy,
  type ServiceBindingContract,
} from "./Service.ts";

export type FunctionTypeId = "Railway.Function";
export const FunctionTypeId = "Railway.Function";

/**
 * Creating the gzipped source tarball failed (the system `tar` binary
 * exited non-zero or could not be spawned).
 */
export class CodeArchiveError extends Data.TaggedError("CodeArchiveError")<{
  readonly message: string;
}> {}

/**
 * The `railway up` code upload was rejected by Railway's REST endpoint,
 * or no new deployment appeared after a successful upload.
 */
export class CodeUploadFailed extends Data.TaggedError("CodeUploadFailed")<{
  readonly message: string;
  readonly status?: number;
}> {}

export interface FunctionProps extends PlatformProps {
  /**
   * Module entrypoint for the bundled program. This should typically be
   * `import.meta.filename` from an inline Effect program.
   */
  main: string;
  /**
   * Named export to load from `main`.
   * @default "default"
   */
  handler?: string;
  /**
   * The Railway project (or `{ projectId }`) to create the service in.
   */
  project: ProjectSource;
  /**
   * The environment (or `{ environmentId }`) to deploy into. Defaults to
   * the project's base environment.
   */
  environment?: EnvironmentSource;
  /**
   * Railway service name. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`.
   */
  name?: string;
  /**
   * HTTP port the bundled program listens on. The provider sets the
   * `PORT` variable on the service and points the public domain at it.
   * @default 3000
   */
  port?: number;
  /**
   * Whether to expose the service on a Railway-generated public domain
   * (`*.up.railway.app`). The domain is reported as the `url` attribute.
   * @default true
   */
  url?: boolean;
  /**
   * Additional environment variables for the service.
   */
  env?: Record<string, any>;
  /**
   * JavaScript runtime used inside the container.
   * @default "node"
   */
  runtime?: "bun" | "node";
  /**
   * Module specifiers to leave external when bundling. The packages are
   * installed during Railway's image build before the entrypoint runs.
   */
  external?: string[];
  /**
   * Bundler configuration overrides for the entrypoint.
   */
  build?: {
    input?: Partial<rolldown.InputOptions>;
    output?: Partial<rolldown.OutputOptions>;
  };
  /**
   * Number of replicas to run.
   * @default 1
   */
  numReplicas?: number;
  /**
   * Region to deploy the service into, e.g. `us-west2`.
   */
  region?: string;
  /**
   * Path Railway probes to decide a deployment is healthy, e.g. `/health`.
   */
  healthcheckPath?: string;
  /**
   * Restart policy for crashed containers.
   * @default "ON_FAILURE"
   */
  restartPolicyType?: RailwayRestartPolicy;
  /**
   * Enable app sleeping — scale to zero when no traffic.
   * @default false
   */
  sleepApplication?: boolean;
}

export interface Function extends Resource<
  "Railway.Function",
  FunctionProps,
  {
    serviceId: string;
    name: string;
    projectId: string;
    environmentId: string;
    /** Port the program listens on (also the domain's target port). */
    port: number;
    /** Railway-generated public domain, when `url` is enabled. */
    domain: string | undefined;
    domainId: string | undefined;
    /** `https://` URL of the public domain, when `url` is enabled. */
    url: string | undefined;
    /** ID of the most recent deployment triggered/observed by Alchemy. */
    deploymentId: string | undefined;
    deploymentStatus: DeploymentStatus | undefined;
    /** Names of the service variables managed by this resource. */
    variableNames: string[];
    code: {
      hash: string;
    };
  },
  ServiceBindingContract,
  Providers
> {}

export type FunctionServices =
  | Function
  | PlatformServices
  | Server.ProcessServices;

export type FunctionShape = Main<FunctionServices>;

export interface FunctionRuntimeContext extends Server.ProcessContext {
  readonly Type: "Railway.Function";
}

/**
 * An Effect-native runnable unit on Railway — your program is bundled,
 * staged with a deterministic Dockerfile, gzipped into a source tarball,
 * and uploaded straight to Railway's build pipeline as a
 * [Railway service](https://docs.railway.com/reference/services) with its
 * variables, public domain, and deployment lifecycle fully reconciled.
 *
 * **How code gets deployed:** Railway's GraphQL API has no code-upload
 * mutation, but the Railway CLI's `railway up` uses a REST endpoint that
 * accepts a gzipped tarball of the source directory. `Railway.Function`
 * bundles your `main` entrypoint (rolldown), writes a staging directory
 * containing `index.mjs`, a minimal `package.json`, and a Dockerfile
 * (so Railway's builder is deterministic), tars it up, and POSTs it to
 * `…/project/{projectId}/environment/{environmentId}/up?serviceId={serviceId}`.
 * Railway builds the image remotely and deploys it — no local Docker
 * daemon or registry required.
 *
 * Bindings reuse the `Railway.Service` binding contract
 * (`{ env?, volumes? }`), so `Connect`, `PostgresDatabaseBinding`, `VolumeMount`,
 * and any other Railway policy attach to a Function exactly like they do
 * to a Service: the policy records env vars / volume attachments at
 * deploy time and the provider reconciles them onto the service before
 * triggering the deployment. Plain config/secrets are not bindings —
 * `yield*` an `effect/Config` in the Init phase and it is captured as a
 * service variable automatically (see the Configuration section).
 *
 * @section Creating a Function
 * @example HTTP service from an inline Effect program
 * ```typescript
 * export default class Api extends Railway.Function<Api>()(
 *   "Api",
 *   Effect.gen(function* () {
 *     const project = yield* Railway.Project("MyProject");
 *     return { main: import.meta.filename, project };
 *   }),
 *   Effect.gen(function* () {
 *     return {
 *       fetch: Effect.gen(function* () {
 *         return HttpServerResponse.text("Hello from Railway!");
 *       }),
 *     };
 *   }),
 * ) {}
 * ```
 *
 * @section Bindings
 * @example Read config/secrets with effect/Config
 * ```typescript
 * Effect.gen(function* () {
 *   // resolved at deploy time, published as a service variable, and
 *   // re-read from process.env at runtime — no binding needed.
 *   const greeting = yield* Config.string("GREETING");
 *   const apiKey = yield* Config.redacted("API_KEY");
 *   return {
 *     fetch: Effect.gen(function* () {
 *       return HttpServerResponse.text(greeting);
 *     }),
 *   };
 * })
 * ```
 *
 * @example Connect to another Railway service
 * ```typescript
 * const api = yield* Railway.Connect.bind(apiService);
 * const url = yield* api.privateUrl({ port: 8080 });
 * ```
 *
 * @example Bind a database connection URL
 * ```typescript
 * const db = yield* Railway.PostgresDatabase.bind(postgres);
 * // at runtime: Redacted.value(yield* db.connectionString)
 * ```
 *
 * @section Configuration
 * @example Healthcheck, replicas, and region
 * ```typescript
 * const fn = yield* Railway.Function("Api", {
 *   main: import.meta.filename,
 *   project,
 *   healthcheckPath: "/health",
 *   numReplicas: 2,
 *   region: "us-west2",
 * });
 * ```
 */
export const Function: Platform<
  Function,
  FunctionServices,
  FunctionShape,
  FunctionRuntimeContext
> = Platform(FunctionTypeId, {
  createRuntimeContext: (id: string): FunctionRuntimeContext => {
    const runners: Effect.Effect<void, never, any>[] = [];
    // At runtime (inside the deployed container) expose the live process
    // environment so binding accessors (Connect, database bindings, VolumeMount)
    // can read the variables that were reconciled onto the service. At plan
    // time this is a fresh record that collects Output references which
    // the provider publishes as service variables.
    const env: Record<string, any> =
      typeof process !== "undefined" && process.env.ALCHEMY_PHASE === "runtime"
        ? (process.env as Record<string, any>)
        : {};

    const serve = <Req = never>(handler: HttpEffect<Req>) =>
      // Capture the ambient context — `serve` runs inside the scope where
      // Platform.ts provides RuntimeContext / Self / the ConfigProvider
      // interceptor, but the runner executes later from the bootstrap's
      // `exports.default`, outside that scope. Without re-providing it the
      // handler dies at runtime with "Service not found: RuntimeContext".
      Effect.context<never>().pipe(
        Effect.map((ctx) => {
          runners.push(
            Effect.gen(function* () {
              const httpServer = yield* Effect.serviceOption(HttpServer).pipe(
                Effect.map(Option.getOrUndefined),
              );
              if (httpServer) {
                // A Railway Function is a long-lived process, so the
                // ExecutionContext spans the whole runtime: one scope and
                // one cache for every request the server handles. Helpers
                // like `Drizzle.postgres` / `Sql.postgres` memoize their
                // connection pool on it.
                const scope = yield* Effect.scope;
                yield* httpServer.serve(handler).pipe(
                  Effect.provideService(ExecutionContext, {
                    scope,
                    cache: {},
                  }),
                );
                yield* Effect.never;
              }
              // no HttpServer means we're at plan time — nothing to serve
            }).pipe(Effect.provide(ctx), Effect.orDie),
          );
        }),
      );

    return {
      Type: FunctionTypeId,
      id,
      env,
      set: (bindingId: string, output: Output.Output) =>
        Effect.sync(() => {
          // Key is already canonical (see RuntimeContext.sanitizeKey).
          // Preserve `Redacted`-ness across the Output → env var round
          // trip (`JSON.stringify(Redacted)` would emit `"<redacted>"`).
          env[bindingId] = output.pipe(
            Output.map((value) =>
              Redacted.isRedacted(value)
                ? JSON.stringify({
                    _tag: "Redacted",
                    value: Redacted.value(value),
                  })
                : JSON.stringify(value),
            ),
          );
          return bindingId;
        }),
      get: <T>(key: string) =>
        // Read straight from `process.env`. Going through `Config` here
        // would re-enter the ConfigProvider interceptor installed by
        // `Platform.ts` for the same key and recurse forever (see the
        // AWS Lambda runtime context for the full story).
        Effect.sync(() => {
          const val = process.env[key];
          if (val === undefined) {
            return undefined;
          }
          try {
            const value = JSON.parse(val);
            if (
              typeof value === "object" &&
              value?._tag === "Redacted" &&
              "value" in value
            ) {
              return Redacted.make(
                (value as { value: unknown }).value,
              ) as unknown as T;
            }
            return value as T;
          } catch {
            return val as unknown as T; // assume it's just a string
          }
        }),
      run: ((effect: Effect.Effect<void, never, any>) =>
        Effect.sync(() => {
          runners.push(effect);
        })) as unknown as Server.ProcessContext["run"],
      serve,
      exports: Effect.sync(() => ({
        default: Effect.all(
          runners.map((eff) =>
            Effect.forever(
              eff.pipe(
                // Log and ignore errors (daemon mode, it should re-run)
                Effect.tapError((err) => Effect.logError(err)),
                Effect.ignore,
              ),
            ),
          ),
          {
            concurrency: "unbounded",
          },
        ),
      })),
    } as FunctionRuntimeContext;
  },
});

/**
 * Result of the `railway up` REST endpoint, parsed leniently — Railway
 * has shipped different shapes over time (`url`, `logsUrl`,
 * `deploymentDomain`, sometimes a deployment id), and all fields are
 * optional from our point of view.
 */
export interface UpResponse {
  readonly url: string | undefined;
  readonly logsUrl: string | undefined;
  readonly deploymentId: string | undefined;
}

/**
 * Upload a gzipped source tarball to Railway via the same REST endpoint
 * the Railway CLI's `railway up` uses:
 *
 * `POST {host}/project/{projectId}/environment/{environmentId}/up?serviceId={serviceId}`
 *
 * where `{host}` is the GraphQL API base URL with any `/graphql/v2`
 * suffix stripped (default `https://backboard.railway.com`). The body is
 * the raw tar.gz bytes; the CLI labels them `Content-Type:
 * multipart/form-data` even though no multipart envelope is sent, so we
 * mirror that. Auth matches the GraphQL API: `Authorization: Bearer`
 * for account/workspace tokens, `Project-Access-Token` for project
 * tokens. The whole protocol lives in this one helper so the
 * content-type/body shape is trivially adjustable.
 */
export const uploadCode = Effect.fnUntraced(function* (
  projectId: string,
  environmentId: string,
  serviceId: string,
  tarGzBytes: Uint8Array,
) {
  const http = yield* HttpClient.HttpClient;
  const credentials = yield* yield* Credentials;

  const host = credentials.apiBaseUrl
    .replace(/\/graphql(\/v2)?\/?$/, "")
    .replace(/\/$/, "");
  const url = `${host}/project/${projectId}/environment/${environmentId}/up?serviceId=${serviceId}`;

  const headers: Record<string, string> = credentials.apiToken
    ? { Authorization: `Bearer ${tokenValue(credentials.apiToken)}` }
    : credentials.projectToken
      ? { "Project-Access-Token": tokenValue(credentials.projectToken) }
      : {};

  const response = yield* http.execute(
    HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders(headers),
      // Raw tar.gz bytes as the body. The CLI sends this content type
      // without an actual multipart envelope; Railway accepts the raw
      // bytes either way.
      HttpClientRequest.bodyUint8Array(tarGzBytes, "multipart/form-data"),
    ),
  );

  if (response.status >= 300) {
    const body = yield* response.text.pipe(
      Effect.catch(() => Effect.succeed("")),
    );
    return yield* new CodeUploadFailed({
      status: response.status,
      message: `Railway code upload failed (${response.status}): ${body.slice(0, 1024)}`,
    });
  }

  const json = yield* response.json.pipe(
    Effect.catch(() => Effect.succeed(undefined as unknown)),
  );
  const record =
    typeof json === "object" && json !== null
      ? (json as Record<string, unknown>)
      : {};
  const str = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : undefined;

  return {
    url: str("url"),
    logsUrl: str("logsUrl"),
    deploymentId: str("deploymentId") ?? str("deployId"),
  };
});

const tokenValue = (token: Redacted.Redacted<string> | string): string =>
  Redacted.isRedacted(token) ? Redacted.value(token) : token;

export const FunctionProvider = () =>
  Provider.effect(
    Function,
    Effect.gen(function* () {
      const stack = yield* Stack;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const virtualEntryPlugin = yield* Bundle.virtualEntryPlugin;

      const alchemyEnv = {
        ALCHEMY_STACK_NAME: stack.name,
        ALCHEMY_STAGE: stack.stage,
        ALCHEMY_PHASE: "runtime",
      };

      const createServiceName = (id: string, name: string | undefined) =>
        Effect.gen(function* () {
          // Railway service names are documented at max 32 characters.
          return (
            name ??
            (yield* createPhysicalName({ id, lowercase: true, maxLength: 32 }))
          );
        });

      const bundleProgram = Effect.fnUntraced(function* (props: FunctionProps) {
        const runtime = props.runtime ?? "node";
        const handler = props.handler ?? "default";
        const external = props.external ?? [];
        const realMain = yield* fs.realPath(props.main);
        const cwd = yield* findCwdForBundle(realMain);

        const buildBundle = Effect.fnUntraced(function* (
          entry: string,
          plugins?: rolldown.RolldownPluginOption,
        ) {
          return yield* Bundle.build(
            {
              ...props.build?.input,
              input: entry,
              cwd,
              external: [
                ...(runtime === "bun" ? ["bun", "bun:*"] : []),
                ...external,
              ],
              platform: "node",
              resolve: {
                conditionNames:
                  runtime === "bun"
                    ? ["bun", "import", "module", "default"]
                    : ["node", "import", "module", "default"],
              },
              plugins: [props.build?.input?.plugins, plugins],
              treeshake: true,
            },
            {
              ...props.build?.output,
              format: "esm",
              sourcemap: props.build?.output?.sourcemap ?? false,
              minify: props.build?.output?.minify ?? true,
              entryFileNames: "index.js",
            },
          );
        });

        const bundleOutput = props.isExternal
          ? yield* buildBundle(realMain)
          : yield* buildBundle(
              realMain,
              virtualEntryPlugin(
                (importPath) => `
${
  runtime === "bun"
    ? `
import { BunServices } from "@effect/platform-bun";
import { BunHttpServer } from "alchemy/Http";
const HttpServer = BunHttpServer;
`
    : `
import { NodeServices } from "@effect/platform-node";
import { NodeHttpServer } from "alchemy/Http";
const HttpServer = NodeHttpServer;
`
}
import { Stack } from "alchemy/Stack";
import { makeEntrypointLayer } from "alchemy/Runtime";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Context from "effect/Context";
import { MinimumLogLevel } from "effect/References";

import ${handler === "default" ? "entrypoint" : `{ ${handler} as entrypoint }`} from ${JSON.stringify(importPath)};

const tag = Context.Service("${Self.key}")
const layer = makeEntrypointLayer(tag, entrypoint);

const platform = Layer.mergeAll(
  ${runtime === "bun" ? "BunServices.layer" : "NodeServices.layer"},
  FetchHttpClient.layer,
  Logger.layer([Logger.consolePretty()]),
);

const stack = Layer.succeed(Stack, {
  name: ${JSON.stringify(stack.name)},
  stage: ${JSON.stringify(stack.stage)},
  bindings: {},
  resources: {}
});

const serverEffect = tag.pipe(
  Effect.flatMap(func => func.RuntimeContext.exports),
  Effect.flatMap(exports => exports.default),
  Effect.provide(
    layer.pipe(
      Layer.provideMerge(stack),
      Layer.provideMerge(HttpServer()),
      Layer.provideMerge(platform),
      Layer.provideMerge(
        Layer.succeed(
          MinimumLogLevel,
          process.env.DEBUG ? "Debug" : "Info",
        )
      ),
    )
  ),
  Effect.scoped
);

console.log("Railway function bootstrap starting...");
await Effect.runPromise(serverEffect).catch((err) => {
  console.error("Railway function bootstrap failed:", err);
  process.exit(1);
})`,
              ),
            );

        // Rolldown can emit multiple chunk files (entry + shared chunks);
        // every one of them must land in the source tarball.
        const files = bundleOutput.files.map((f) => ({
          path: f.path,
          content:
            typeof f.content === "string"
              ? new TextEncoder().encode(f.content)
              : f.content,
        }));

        return { files, hash: bundleOutput.hash };
      });

      /**
       * Deterministic Dockerfile included in the source tarball so
       * Railway's builder produces the same image for the same code —
       * no buildpack detection heuristics involved.
       */
      const buildDockerfile = (props: FunctionProps): string => {
        const runtime = props.runtime ?? "node";
        const external = props.external ?? [];
        const base =
          runtime === "bun" ? "FROM oven/bun:1" : "FROM node:22-slim";
        const runtimeBin = runtime === "bun" ? "bun" : "node";
        const installCmd = runtime === "bun" ? "bun add" : "npm install";
        const installStep =
          external.length > 0 ? `RUN ${installCmd} ${external.join(" ")}` : "";
        return [
          base,
          "",
          "WORKDIR /app",
          "COPY . /app",
          ...(installStep ? [installStep, ""] : []),
          `CMD ["${runtimeBin}", "/app/index.mjs"]`,
          "",
        ].join("\n");
      };

      const buildPackageJson = (props: FunctionProps): string => {
        const runtimeBin = (props.runtime ?? "node") === "bun" ? "bun" : "node";
        return JSON.stringify(
          {
            name: "alchemy-railway-function",
            private: true,
            type: "module",
            scripts: { start: `${runtimeBin} index.mjs` },
          },
          null,
          2,
        );
      };

      /**
       * Bundle the program and derive the content hash that gates
       * re-uploads. Everything that lands in the tarball participates in
       * the hash so any change to the shipped artifact triggers a deploy.
       */
      const computeCode = Effect.fnUntraced(function* (
        id: string,
        props: FunctionProps,
      ) {
        const { files, hash: bundleHash } = yield* bundleProgram(props);
        const dockerfile = buildDockerfile(props);
        const packageJson = buildPackageJson(props);
        const codeHash = (yield* sha256Object({
          bundleHash,
          dockerfile,
          packageJson,
        })).slice(0, 16);
        const name = yield* createServiceName(id, props.name);
        return { files, dockerfile, packageJson, codeHash, name };
      });

      /**
       * Write the staging directory (bundle chunks + package.json +
       * Dockerfile) and tar+gzip it with the system `tar` binary via the
       * Effect process service. Returns the tar.gz bytes.
       */
      const stageAndArchive = Effect.fnUntraced(function* ({
        files,
        dockerfile,
        packageJson,
      }: {
        files: ReadonlyArray<{ path: string; content: Uint8Array }>;
        dockerfile: string;
        packageJson: string;
      }) {
        const staging = yield* fs.makeTempDirectory({
          prefix: "alchemy-railway-up-",
        });
        const tarDir = yield* fs.makeTempDirectory({
          prefix: "alchemy-railway-tar-",
        });
        const cleanup = Effect.all([
          fs.remove(staging, { recursive: true }).pipe(Effect.ignore),
          fs.remove(tarDir, { recursive: true }).pipe(Effect.ignore),
        ]);

        return yield* Effect.gen(function* () {
          for (const [i, file] of files.entries()) {
            // Entry chunk becomes `index.mjs` (the Dockerfile CMD); every
            // other chunk keeps its rolldown-assigned filename so relative
            // imports resolve at runtime.
            const rel = i === 0 ? "index.mjs" : file.path;
            const fullPath = path.join(staging, rel);
            yield* fs.makeDirectory(path.dirname(fullPath), {
              recursive: true,
            });
            yield* fs.writeFile(fullPath, file.content);
          }
          yield* fs.writeFileString(
            path.join(staging, "package.json"),
            packageJson,
          );
          yield* fs.writeFileString(
            path.join(staging, "Dockerfile"),
            dockerfile,
          );

          const tarPath = path.join(tarDir, "code.tar.gz");
          const { exitCode, stderr } = yield* exec(
            ChildProcess.make("tar", ["-czf", tarPath, "-C", staging, "."]),
          ).pipe(
            Effect.catch((e) =>
              Effect.fail(
                new CodeArchiveError({
                  message: `Failed to run tar: ${e instanceof Error ? e.message : String(e)}`,
                }),
              ),
            ),
          );
          if (exitCode !== 0) {
            return yield* new CodeArchiveError({
              message: `tar exited with ${exitCode}: ${stderr}`,
            });
          }

          return yield* fs.readFile(tarPath);
        }).pipe(Effect.ensuring(cleanup));
      });

      /**
       * Resolve the deployment created by an upload. Newer responses
       * carry a deployment id directly; otherwise poll the service
       * instance until `latestDeployment` moves past the pre-upload one.
       */
      const awaitUploadDeployment = Effect.fnUntraced(function* (
        serviceId: string,
        environmentId: string,
        previousDeploymentId: string | undefined,
        uploadedDeploymentId: string | undefined,
      ) {
        if (uploadedDeploymentId) {
          return uploadedDeploymentId;
        }
        const instance = yield* getServiceInstance({
          serviceId,
          environmentId,
        }).pipe(
          Effect.repeat({
            schedule: Schedule.spaced("3 seconds"),
            until: (i) =>
              i.latestDeployment?.id !== undefined &&
              i.latestDeployment.id !== null &&
              i.latestDeployment.id !== previousDeploymentId,
            times: 100,
          }),
        );
        const deploymentId = instance.latestDeployment?.id ?? undefined;
        if (!deploymentId || deploymentId === previousDeploymentId) {
          return yield* new CodeUploadFailed({
            message: `Code upload for service ${serviceId} succeeded but no new deployment appeared`,
          });
        }
        return deploymentId;
      });

      const collectBindingEnv = (
        bindings: ResourceBinding<Function["Binding"]>[],
      ): Record<string, any> =>
        bindings
          .filter(
            (
              binding: ResourceBinding<Function["Binding"]> & {
                action?: string;
              },
            ) => binding.action !== "delete",
          )
          .map((binding) => binding?.data?.env ?? {})
          .reduce((acc, env) => ({ ...acc, ...env }), {});

      const stringifyEnvValue = (value: any): string =>
        typeof value === "string" ? value : JSON.stringify(value ?? null);

      const desiredVariablesFor = (
        props: FunctionProps,
        port: number,
        bindingEnv: Record<string, any>,
      ): Record<string, string> => {
        const variables: Record<string, string> = { ...alchemyEnv };
        variables.PORT = String(port);
        for (const [key, value] of Object.entries(bindingEnv)) {
          variables[key] = stringifyEnvValue(value);
        }
        for (const [key, value] of Object.entries(props.env ?? {})) {
          variables[key] = stringifyEnvValue(value);
        }
        return variables;
      };

      return Function.Provider.of({
        stables: ["serviceId", "projectId", "environmentId"],
        diff: Effect.fnUntraced(function* ({ id, news, output }) {
          if (!isResolved(news)) return undefined;
          if (!output) return undefined;
          const newProjectId = resolveProjectId(news.project as ProjectSource);
          if (newProjectId !== output.projectId) {
            return { action: "replace" } as const;
          }
          if (
            news.environment &&
            resolveEnvironmentId(news.environment as EnvironmentSource) !==
              output.environmentId
          ) {
            return { action: "replace" } as const;
          }
          // Detect code changes that are invisible to prop comparison.
          const { codeHash } = yield* computeCode(id, news);
          if (codeHash !== output.code?.hash) {
            return { action: "update" } as const;
          }
          return undefined;
        }),
        read: Effect.fnUntraced(function* ({ output }) {
          if (!output?.serviceId) return undefined;
          return yield* getService({ id: output.serviceId }).pipe(
            // Railway soft-deletes — a resolved service with `deletedAt`
            // set is gone for our purposes.
            Effect.map((service) =>
              service.deletedAt
                ? undefined
                : {
                    ...output,
                    name: service.name,
                    projectId: service.projectId,
                  },
            ),
            Effect.catchTag("NotAuthorized", () => Effect.succeed(undefined)),
            Effect.catchTag("ProjectNotFound", () => Effect.succeed(undefined)),
          );
        }),
        reconcile: Effect.fnUntraced(function* ({
          id,
          news,
          olds,
          output,
          bindings,
          session,
        }) {
          const projectId = resolveProjectId(news.project as ProjectSource);
          const environmentId = news.environment
            ? resolveEnvironmentId(news.environment as EnvironmentSource)
            : yield* defaultEnvironmentId(news.project as ProjectSource);
          const port = news.port ?? 3000;

          const { files, dockerfile, packageJson, codeHash, name } =
            yield* computeCode(id, news);

          const bindingEnv = collectBindingEnv(bindings);
          const desiredVariables = desiredVariablesFor(news, port, bindingEnv);

          // Observe — does the service still exist? (Railway soft-deletes,
          // so a resolved service with `deletedAt` set counts as missing.)
          const observed = output?.serviceId
            ? yield* getService({ id: output.serviceId }).pipe(
                Effect.map((service) =>
                  service.deletedAt ? undefined : service,
                ),
                Effect.catchTag("NotAuthorized", () =>
                  Effect.succeed(undefined),
                ),
                Effect.catchTag("ProjectNotFound", () =>
                  Effect.succeed(undefined),
                ),
              )
            : undefined;

          const codeChanged = codeHash !== output?.code?.hash;

          // Ensure — create the service if missing, otherwise sync name.
          // The service is created without a source; the code upload
          // below attaches the uploaded tarball as the deploy source.
          let serviceId: string;
          let createdNow = false;
          if (!observed) {
            const create = createService({
              input: {
                projectId,
                environmentId,
                name,
                variables: desiredVariables,
              },
            });
            const created = yield* create.pipe(
              // A same-named service already exists (orphan from a run
              // whose state was lost, or a create race). Find its id via
              // the environment's service-instance connection. A healthy
              // service (one with an instance in this environment) is
              // adopted and the sync steps below converge it; an
              // instance-less husk (interrupted create) is deleted and
              // recreated.
              Effect.catchTag(
                "ServiceNameConflict",
                Effect.fnUntraced(function* (error) {
                  const existing = yield* findServiceByName(
                    environmentId,
                    name,
                  );
                  if (!existing) {
                    return yield* Effect.fail(error);
                  }
                  const hasInstance = yield* getServiceInstance({
                    serviceId: existing.serviceId,
                    environmentId,
                  }).pipe(
                    Effect.as(true),
                    Effect.catchTag("ProblemProcessingRequest", () =>
                      Effect.succeed(false),
                    ),
                    Effect.catchTag("NotAuthorized", () =>
                      Effect.succeed(false),
                    ),
                  );
                  if (hasInstance) {
                    return { id: existing.serviceId };
                  }
                  yield* deleteService({ id: existing.serviceId }).pipe(
                    Effect.catchTag("NotAuthorized", () => Effect.void),
                  );
                  return yield* create;
                }),
              ),
            );
            serviceId = created.id;
            createdNow = true;
          } else {
            serviceId = observed.id;
            if (observed.name !== name) {
              yield* updateService({ id: serviceId, input: { name } });
            }
          }

          // Sync — service instance configuration, diffed against observed.
          const instance = yield* getServiceInstance({
            serviceId,
            environmentId,
          });
          const patch: Record<string, unknown> = {};
          const sync = (key: string, desired: unknown, current: unknown) => {
            if (desired !== undefined && desired !== (current ?? undefined)) {
              patch[key] = desired;
            }
          };
          sync("numReplicas", news.numReplicas, instance.numReplicas);
          sync("region", news.region, instance.region);
          sync(
            "healthcheckPath",
            news.healthcheckPath,
            instance.healthcheckPath,
          );
          sync(
            "restartPolicyType",
            news.restartPolicyType,
            instance.restartPolicyType,
          );
          sync(
            "sleepApplication",
            news.sleepApplication,
            instance.sleepApplication,
          );
          const configChanged = Object.keys(patch).length > 0;
          if (configChanged) {
            yield* updateServiceInstance({
              serviceId,
              environmentId,
              input: patch,
            });
          }

          // Sync — service variables, diffed against observed cloud state.
          const observedVariables = (yield* getVariables({
            projectId,
            environmentId,
            serviceId,
          })) as Record<string, string>;
          const managedNames = new Set([
            ...(output?.variableNames ?? []),
            ...Object.keys(olds?.env ?? {}),
          ]);
          const upserts: Record<string, string> = {};
          for (const [key, value] of Object.entries(desiredVariables)) {
            if (observedVariables[key] !== value) {
              upserts[key] = value;
            }
          }
          const removals = [...managedNames].filter(
            (key) =>
              !(key in desiredVariables) && key in (observedVariables ?? {}),
          );
          const variablesChanged =
            Object.keys(upserts).length > 0 || removals.length > 0;
          if (Object.keys(upserts).length > 0) {
            yield* upsertVariableCollection({
              input: {
                projectId,
                environmentId,
                serviceId,
                variables: upserts,
                skipDeploys: true,
              },
            });
          }
          for (const key of removals) {
            yield* deleteVariable({
              input: { projectId, environmentId, serviceId, name: key },
            }).pipe(Effect.catchTag("NotAuthorized", () => Effect.void));
          }

          // Sync — volume attachments requested through bindings.
          const volumesChanged = yield* syncBoundVolumes(
            serviceId,
            environmentId,
            bindings,
          );

          // Sync — public domain. Reconciled against observed domains so
          // adoption and partial-state recoveries converge.
          let domainId: string | undefined;
          let domain: string | undefined;
          if (news.url !== false) {
            const domains = yield* getDomains({
              projectId,
              environmentId,
              serviceId,
            });
            const existing =
              domains.serviceDomains.find((d) => d.id === output?.domainId) ??
              domains.serviceDomains[0];
            const ensured =
              existing ??
              (yield* createServiceDomain({
                input: { serviceId, environmentId, targetPort: port },
              }));
            domainId = ensured.id;
            domain = ensured.domain;
          }

          // Deploy — upload the source tarball when anything changed (or
          // no healthy deployment exists yet). The upload itself triggers
          // Railway's build + deployment, so config/variable-only changes
          // also go through a fresh upload of the same code.
          let deploymentId = instance.latestDeployment?.id ?? undefined;
          let deploymentStatus = (instance.latestDeployment?.status ??
            undefined) as DeploymentStatus | undefined;
          const shouldDeploy =
            createdNow ||
            codeChanged ||
            configChanged ||
            variablesChanged ||
            volumesChanged ||
            deploymentStatus === undefined ||
            deploymentStatus === "FAILED" ||
            deploymentStatus === "CRASHED" ||
            deploymentStatus === "REMOVED" ||
            deploymentStatus === "SKIPPED";
          if (shouldDeploy) {
            yield* Effect.logInfo(
              `Railway Function: uploading code for ${name} (${codeHash})`,
            );
            if (session) {
              yield* session.note(`Uploading code for ${name}...`);
            }
            const tarGzBytes = yield* stageAndArchive({
              files,
              dockerfile,
              packageJson,
            });
            const previousDeploymentId = deploymentId;
            const response = yield* uploadCode(
              projectId,
              environmentId,
              serviceId,
              tarGzBytes,
            );
            if (session) {
              yield* session.note(`Waiting for ${name} deployment...`);
            }
            deploymentId = yield* awaitUploadDeployment(
              serviceId,
              environmentId,
              previousDeploymentId,
              response.deploymentId,
            );
            deploymentStatus = yield* waitForDeployment(
              serviceId,
              deploymentId,
            );
          }

          return {
            serviceId,
            name,
            projectId,
            environmentId,
            port,
            domain,
            domainId,
            url: domain ? `https://${domain}` : undefined,
            deploymentId,
            deploymentStatus,
            variableNames: Object.keys(desiredVariables),
            code: {
              hash: codeHash,
            },
          };
        }),
        delete: Effect.fnUntraced(function* ({ output }) {
          yield* deleteService({ id: output.serviceId }).pipe(
            Effect.catchTag("NotAuthorized", () => Effect.void),
            Effect.catchTag("ProjectNotFound", () => Effect.void),
          );
        }),
      });
    }),
  );

const defaultEnvironmentId = (source: ProjectSource) =>
  Effect.gen(function* () {
    // The resolved `Railway.Project` attributes already carry the default
    // environment id — prefer it over a refetch (`getProject` can briefly
    // report no base environment for freshly-created projects).
    if (
      "defaultEnvironmentId" in source &&
      typeof source.defaultEnvironmentId === "string" &&
      source.defaultEnvironmentId
    ) {
      return source.defaultEnvironmentId;
    }
    const projectId = resolveProjectId(source);
    const project = yield* getProject({ id: projectId });
    const baseEnvironmentId =
      project.baseEnvironmentId ?? project.baseEnvironment?.id;
    if (baseEnvironmentId) {
      return baseEnvironmentId;
    }
    // Fall back to listing environments.
    const page = yield* getEnvironments({ projectId, first: 100 });
    const nodes = page.edges.map((e) => e.node);
    const match = nodes.find((n) => !n.isEphemeral) ?? nodes[0];
    if (!match) {
      return yield* Effect.die(
        `Railway project ${projectId} has no environments`,
      );
    }
    return match.id;
  });
