import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Bindings from "./Bindings.ts";
import * as Entry from "./entry/EntryPlugin.ts";
import * as Hyperdrive from "./hyperdrive/HyperdrivePlugin.ts";
import * as Plugin from "./Plugin.ts";
import * as LocalProxy from "./proxy/LocalProxy.ts";
import * as RemoteBindings from "./remote-bindings/RemoteBindings.ts";
import type { RuntimeError } from "./RuntimeError.shared.ts";
import * as Storage from "./Storage.ts";
import type { Worker } from "./Worker.ts";
import * as Runtime from "./workerd/Runtime.ts";
import * as WorkerModule from "./WorkerModule.ts";

export interface ServeResult {
  readonly name: string;
  readonly address: string;
}

export class Server extends Context.Service<
  Server,
  {
    readonly serve: (worker: Worker) => Effect.Effect<ServeResult, RuntimeError, Scope.Scope>;
  }
>()("cloudflare-runtime/Server") {}

export const layer = Layer.effect(
  Server,
  Effect.gen(function* () {
    const runtime = yield* Runtime.Runtime;
    const localProxy = yield* LocalProxy.LocalProxy;
    const storage = yield* Storage.Storage;
    const remoteBindings = yield* RemoteBindings.RemoteBindings;

    return Server.of({
      serve: Effect.fn(function* (worker) {
        const builtBindings = yield* Bindings.buildBindings(worker.bindings);
        const { entry, bindings, services, extensions } = yield* Plugin.build(worker, [
          Entry.EntryPlugin,
          Hyperdrive.HyperdrivePlugin,
          remoteBindings(builtBindings.remoteBindings),
        ]);
        const result = yield* runtime.serve({
          sockets: [
            {
              name: "http",
              address: "127.0.0.1:0",
              service: { name: entry },
            },
          ],
          services: [
            {
              name: "user",
              worker: {
                compatibilityDate: worker.compatibilityDate,
                compatibilityFlags: worker.compatibilityFlags,
                modules: worker.modules.map(WorkerModule.toWorkerd),
                durableObjectNamespaces: worker.durableObjectNamespaces?.map((namespace) => ({
                  className: namespace.className,
                  enableSql: namespace.sql,
                  uniqueKey: namespace.uniqueKey,
                })),
                bindings: [...builtBindings.workerBindings, ...bindings],
                durableObjectStorage: {
                  localDisk: storage.name,
                },
              },
            },
            {
              name: "internet",
              network: {
                // Allow access to private/public addresses:
                // https://github.com/cloudflare/miniflare/issues/412
                allow: ["public", "private", "240.0.0.0/4"],
                deny: [],
                tlsOptions: {
                  trustBrowserCas: true,
                },
              },
            },
            ...services,
            storage,
          ],
          extensions,
        });
        const address = `http://localhost:${result[0].port}`;
        yield* localProxy.send({
          _tag: "Local.Set",
          worker: worker.name,
          address,
        });
        yield* Effect.addFinalizer(() =>
          localProxy
            .send({
              _tag: "Local.Unset",
              worker: worker.name,
              address,
            })
            // Teardown noise should not surface as a serve failure but we
            // want to keep it recoverable from logs.
            .pipe(
              Effect.tapCause((cause) => Effect.logDebug(Cause.pretty(cause))),
              Effect.ignore,
            ),
        );
        return {
          name: worker.name,
          address: `http://${worker.name}.${localProxy.address}`,
        };
      }),
    });
  }),
);
