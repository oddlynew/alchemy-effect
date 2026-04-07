import cloudflarePlugin from "@distilled.cloud/cloudflare-rolldown-plugin";
import * as cf from "@distilled.cloud/cloudflare";
import * as r2Api from "@distilled.cloud/cloudflare/r2";
import * as workers from "@distilled.cloud/cloudflare/workers";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Socket from "effect/unstable/socket/Socket";
import * as NodePath from "node:path";
import * as Bundle from "@/Bundle/Bundle";
import { Account, fromEnv as accountFromEnv } from "@/Cloudflare/Account";
import { connect } from "@/Cloudflare/Local/local-client";
import { makeR2Client } from "@/Cloudflare/Local/Bindings/r2";
import { LocalRpcs } from "@/Cloudflare/Local/rpc-schema";

const PROXY_WORKER_ENTRY = NodePath.resolve(
  import.meta.dirname,
  "../../../src/Cloudflare/Local/proxy-worker.ts",
);

const credentials = Layer.mergeAll(cf.CredentialsFromEnv, FetchHttpClient.layer);
const platform = NodeServices.layer;

const configProviderLayer = Layer.effect(
  ConfigProvider.ConfigProvider,
  Effect.map(
    ConfigProvider.fromDotEnv({ path: ".env" }),
    (dotEnv) => ConfigProvider.orElse(dotEnv, ConfigProvider.fromEnv()),
  ),
);

const layers = Layer.provideMerge(
  Layer.mergeAll(credentials, accountFromEnv()),
  Layer.provideMerge(configProviderLayer, platform),
);

const bundleProxyWorker = Effect.gen(function* () {
  const { files } = yield* Bundle.build(
    {
      input: PROXY_WORKER_ENTRY,
      plugins: [
        cloudflarePlugin({
          compatibilityDate: "2026-03-10",
        }),
      ],
      checks: { unresolvedImport: false },
    },
    {
      format: "esm",
      sourcemap: "hidden",
      minify: true,
      keepNames: true,
    },
  );
  return {
    files: files.map(
      (file) =>
        new File([file.content as BlobPart], file.path, {
          type: file.path.endsWith(".js")
            ? "application/javascript+module"
            : file.path.endsWith(".map")
              ? "application/source-map"
              : "application/octet-stream",
        }),
    ),
    mainModule: files[0].path,
  };
});

const deployProxyWorker = (
  scriptName: string,
  extraBindings?: workers.PutScriptRequest["metadata"]["bindings"],
) =>
  Effect.gen(function* () {
    const accountId = yield* Account;
    const putScript = yield* workers.putScript;
    const createSubdomain = yield* workers.createScriptSubdomain;
    const getSubdomain = yield* workers.getSubdomain;

    yield* Effect.logInfo("Bundling proxy worker...");
    const bundle = yield* bundleProxyWorker;
    yield* Effect.logInfo(
      `Bundled ${bundle.files.length} files, main: ${bundle.mainModule}`,
    );

    const bindings: workers.PutScriptRequest["metadata"]["bindings"] = [
      {
        type: "durable_object_namespace",
        name: "SESSION",
        className: "Session",
      },
      ...(extraBindings ?? []),
    ];

    yield* Effect.logInfo(`Deploying proxy worker as ${scriptName}...`);

    const metadata = {
      mainModule: bundle.mainModule,
      compatibilityDate: "2026-03-10",
      compatibilityFlags: ["nodejs_compat"],
      bindings,
      migrations: {
        newTag: "v1",
        newSqliteClasses: ["Session"],
        deletedClasses: [],
        renamedClasses: [],
        transferredClasses: [],
        newClasses: [],
      },
      observability: {
        enabled: true,
        logs: { enabled: true, invocationLogs: true },
      },
    };

    yield* putScript({
      accountId,
      scriptName,
      metadata,
      files: bundle.files,
    }).pipe(
      Effect.catch((err) => {
        const msg = String(
          typeof err === "object" && err !== null && "message" in err
            ? err.message
            : err,
        );
        const expectedTag = msg.match(
          /when expected tag is ['"]?([^'"]+)['"]?/,
        )?.[1];
        const noTags = msg.includes("expected no tags");
        return putScript({
          accountId,
          scriptName,
          metadata: {
            ...metadata,
            migrations: noTags
              ? undefined
              : {
                  oldTag: expectedTag ?? "v1",
                  newTag: `v${Date.now()}`,
                  newSqliteClasses: [],
                  deletedClasses: [],
                  renamedClasses: [],
                  transferredClasses: [],
                  newClasses: [],
                },
          },
          files: bundle.files,
        });
      }),
    );

    yield* createSubdomain({
      accountId,
      scriptName,
      enabled: true,
    });
    const { subdomain } = yield* getSubdomain({ accountId });
    const workerUrl = `https://${scriptName}.${subdomain}.workers.dev`;

    yield* Effect.logInfo(`Proxy worker deployed at ${workerUrl}`);

    yield* Effect.logInfo("Waiting for worker to be reachable...");
    yield* Effect.retry(
      Effect.tryPromise(async () => {
        const res = await fetch(`${workerUrl}/health`);
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
      }),
      Schedule.exponential("500 millis").pipe(
        Schedule.compose(Schedule.recurs(20)),
      ),
    );
    yield* Effect.logInfo("Worker is reachable");

    return workerUrl;
  });

const deleteProxyWorker = (scriptName: string) =>
  Effect.gen(function* () {
    const accountId = yield* Account;
    const deleteScript = yield* workers.deleteScript;
    yield* deleteScript({ accountId, scriptName }).pipe(
      Effect.catchTag("WorkerNotFound", () => Effect.void),
    );
    yield* Effect.logInfo(`Proxy worker ${scriptName} deleted`);
  });

describe("Cloudflare Local RPC", () => {
  it.live(
    "bi-directional RPC over WebSocket",
    () =>
      Effect.gen(function* () {
        const scriptName = "alchemy-local-rpc-ws";
        yield* deleteProxyWorker(scriptName).pipe(Effect.ignore);

        const workerUrl = yield* deployProxyWorker(scriptName);

        try {
          const wsUrl = `${workerUrl}/ws`;
          yield* Effect.logInfo(`Connecting to ${wsUrl}...`);

          const { remoteClient } = yield* connect(wsUrl).pipe(
            Effect.provide(
              LocalRpcs.toLayer({
                localPing: () => Effect.succeed({ ts: Date.now() }),
                localEcho: ({ message }) => Effect.succeed({ message }),
              }),
            ),
            Effect.provide(Socket.layerWebSocketConstructorGlobal),
          );

          yield* Effect.logInfo("Testing remotePing...");
          const pingResult = yield* remoteClient.remotePing();
          expect(pingResult.ts).toBeTypeOf("number");
          expect(pingResult.ts).toBeGreaterThan(0);
          yield* Effect.logInfo(`remotePing returned ts=${pingResult.ts}`);

          yield* Effect.logInfo("Testing remoteEcho...");
          const echoResult = yield* remoteClient.remoteEcho({
            message: "hello from local",
          });
          expect(echoResult.message).toBe("hello from local");
          yield* Effect.logInfo(
            `remoteEcho returned message="${echoResult.message}"`,
          );

          yield* Effect.logInfo(
            "Testing remote -> local via /test-call-local...",
          );
          yield* Effect.sleep("1 second");

          const callLocalResult = yield* Effect.tryPromise(async () => {
            const res = await fetch(`${workerUrl}/test-call-local`);
            if (!res.ok) {
              const body = await res.text();
              throw new Error(
                `test-call-local failed: ${res.status} ${body}`,
              );
            }
            return res.json() as Promise<{
              ping: { ts: number };
              echo: { message: string };
            }>;
          });

          expect(callLocalResult.ping.ts).toBeTypeOf("number");
          expect(callLocalResult.ping.ts).toBeGreaterThan(0);
          expect(callLocalResult.echo.message).toBe("hello from remote");
          yield* Effect.logInfo("All WebSocket RPC tests passed!");
        } finally {
          yield* deleteProxyWorker(scriptName).pipe(Effect.ignore);
        }
      }).pipe(Effect.scoped, Effect.provide(layers)),
    { timeout: 120_000 },
  );

  it.live(
    "R2 binding proxy over HTTP RPC",
    () =>
      Effect.gen(function* () {
        const accountId = yield* Account;
        const scriptName = "alchemy-local-rpc-r2";
        yield* deleteProxyWorker(scriptName).pipe(Effect.ignore);

        const R2_BUCKET_NAME = "alchemy-local-r2-test";

        yield* Effect.logInfo(`Creating R2 bucket ${R2_BUCKET_NAME}...`);
        yield* r2Api
          .createBucket({ accountId, name: R2_BUCKET_NAME })
          .pipe(Effect.catchTag("BucketAlreadyExists", () => Effect.void));

        try {
          const workerUrl = yield* deployProxyWorker(scriptName, [
            {
              type: "r2_bucket",
              name: "BUCKET",
              bucketName: R2_BUCKET_NAME,
            },
          ]);

          const { r2 } = yield* makeR2Client(workerUrl);
          const bucket = r2("BUCKET");

          yield* Effect.logInfo("Testing r2 put...");
          const putResult = yield* Effect.promise(() =>
            bucket.put("hello.txt", "Hello, R2!"),
          );
          expect(putResult.key).toBe("hello.txt");
          expect(putResult.size).toBeGreaterThan(0);
          yield* Effect.logInfo(`Put hello.txt, size=${putResult.size}`);

          yield* Effect.logInfo("Testing r2 get...");
          const getResult = yield* Effect.promise(() =>
            bucket.get("hello.txt"),
          );
          expect(getResult).not.toBeNull();
          const text = yield* Effect.promise(() => getResult!.text());
          expect(text).toBe("Hello, R2!");
          yield* Effect.logInfo(`Get hello.txt, body="${text}"`);

          yield* Effect.logInfo("Testing r2 head...");
          const headResult = yield* Effect.promise(() =>
            bucket.head("hello.txt"),
          );
          expect(headResult).not.toBeNull();
          expect(headResult!.key).toBe("hello.txt");
          expect(headResult!.size).toBe(putResult.size);
          yield* Effect.logInfo(`Head hello.txt, size=${headResult!.size}`);

          yield* Effect.logInfo("Testing r2 list...");
          const listResult = yield* Effect.promise(() => bucket.list());
          expect(listResult.objects.length).toBeGreaterThanOrEqual(1);
          expect(listResult.objects.some((o) => o.key === "hello.txt")).toBe(
            true,
          );
          yield* Effect.logInfo(
            `List returned ${listResult.objects.length} objects`,
          );

          yield* Effect.logInfo("Testing r2 delete...");
          yield* Effect.promise(() => bucket.delete("hello.txt"));
          const afterDelete = yield* Effect.promise(() =>
            bucket.get("hello.txt"),
          );
          expect(afterDelete).toBeNull();
          yield* Effect.logInfo("Delete confirmed - object is gone");

          yield* Effect.logInfo("All R2 tests passed!");
        } finally {
          yield* deleteProxyWorker(scriptName).pipe(Effect.ignore);
          yield* r2Api
            .deleteBucket({ accountId, bucketName: R2_BUCKET_NAME })
            .pipe(Effect.ignore);
        }
      }).pipe(Effect.scoped, Effect.provide(layers)),
    { timeout: 120_000 },
  );
});
