import * as Cloudflare from "alchemy/Cloudflare";
import type { HttpEffect } from "alchemy/Http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import { PingRpcs } from "./group.ts";

let counter = 0;

const handlersLayer = PingRpcs.toLayer({
  Ping: ({ message }) =>
    Effect.sync(() => ({
      echo: message,
      n: ++counter,
    })),
  Slow: ({ ms }) => Effect.sleep(`${ms} millis`).pipe(Effect.as({ slept: ms })),
});

export default class RpcHttpTestWorker extends Cloudflare.Worker<RpcHttpTestWorker>()(
  "RpcHttpTestWorker",
  {
    main: import.meta.filename,
  },
  Effect.gen(function* () {
    return {
      fetch: Effect.succeed(
        RpcServer.toHttpEffect(PingRpcs).pipe(
          Effect.provide(
            Layer.mergeAll(handlersLayer, RpcSerialization.layerNdjson),
          ),
        ) as unknown as HttpEffect,
      ),
    };
  }),
) {}
