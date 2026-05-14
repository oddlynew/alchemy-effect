import { newWebSocketRpcSession } from "capnweb";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as LocalProxyWorker from "worker:./workers/local-proxy.worker.ts";
import * as Internet from "../globals/Internet.ts";
import { findAvailablePort } from "../internal/find-available-port.ts";
import { SystemError } from "../RuntimeError.shared.ts";
import { moduleToWorkerd } from "../RuntimeWorker.ts";
import * as WorkerdConfig from "../workerd/Config.ts";
import * as Workerd from "../workerd/Workerd.ts";
import type { ProxyController } from "./ProxyApi.shared.ts";
import { CONTROLLER_SECRET_KEY, CONTROLLER_WEBSOCKET_PATH } from "./ProxyApi.shared.ts";

type ProxyControllerRpcs = {
  [K in keyof ProxyController]: (
    ...args: Parameters<ProxyController[K]>
  ) => Effect.Effect<void, SystemError>;
};

export class LocalProxy extends Context.Service<
  LocalProxy,
  {
    readonly address: string;
    readonly registerWorker: (workerName: string) => Effect.Effect<string, SystemError>;
    readonly unregisterWorker: (workerName: string) => Effect.Effect<void, SystemError>;
    readonly setLocalAddress: (
      workerName: string,
      address: string,
    ) => Effect.Effect<void, SystemError, Scope.Scope>;
    readonly setRemoteAddress: (
      workerName: string,
      address: string,
    ) => Effect.Effect<void, SystemError, Scope.Scope>;
  }
>()("cloudflare-runtime/proxy/LocalProxy") {}

export const LocalProxyLive = (port = 0) =>
  Layer.effect(
    LocalProxy,
    Effect.gen(function* () {
      const runtime = yield* Workerd.Workerd;
      const secret = crypto.randomUUID();
      const ports = yield* runtime.serve({
        sockets: [
          {
            name: "http",
            address: `127.0.0.1:${yield* findAvailablePort(port, "127.0.0.1")}`,
            service: { name: "proxy:local" },
          },
        ],
        services: [
          {
            name: "proxy:local",
            worker: {
              compatibilityDate: "2026-03-10",
              modules: LocalProxyWorker.modules.map(moduleToWorkerd),
              bindings: [
                { name: "PROXY", durableObjectNamespace: { className: "LocalProxy" } },
                { name: "PROXY_SECRET", text: secret },
              ],
              durableObjectNamespaces: [
                {
                  className: "LocalProxy",
                  ephemeralLocal: WorkerdConfig.kVoid,
                  preventEviction: true,
                },
              ],
            },
          },
          yield* Internet.Internet,
        ],
      });
      const address = `localhost:${ports.http}`;
      const session = yield* Effect.acquireDisposable(
        Effect.sync(() =>
          newWebSocketRpcSession<ProxyController>(
            `ws://${address}${CONTROLLER_WEBSOCKET_PATH}?${CONTROLLER_SECRET_KEY}=${secret}`,
          ),
        ),
      );
      const controller = new Proxy(session, {
        get(target, prop) {
          return (...args: Array<any>) =>
            Effect.tryPromise({
              try: () =>
                (target[prop as keyof typeof target] as (...args: Array<any>) => Promise<void>)(
                  ...args,
                ),
              catch: (error) =>
                new SystemError({
                  subtag: "LocalProxyControlPlane",
                  message: `Failed to call controller method "${String(prop)}".`,
                  cause: error,
                }),
            });
        },
      }) as unknown as ProxyControllerRpcs;
      return LocalProxy.of({
        address,
        registerWorker: (workerName) => {
          const subdomain = workerName.toLowerCase();
          return controller
            .registerWorker(subdomain)
            .pipe(Effect.as(`http://${subdomain}.${address}`));
        },
        unregisterWorker: (workerName) => controller.unregisterWorker(workerName.toLowerCase()),
        setLocalAddress: (workerName, address) => {
          const subdomain = workerName.toLowerCase();
          return Effect.acquireRelease(controller.setLocalAddress(subdomain, address), () =>
            controller.unsetLocalAddress(subdomain, address).pipe(Effect.ignore),
          );
        },
        setRemoteAddress: (workerName, address) => {
          const subdomain = workerName.toLowerCase();
          return Effect.acquireRelease(controller.setRemoteAddress(subdomain, address), () =>
            controller.unsetRemoteAddress(subdomain).pipe(Effect.ignore),
          );
        },
      });
    }),
  );
