import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Chat from "effect/unstable/ai/Chat";

import * as Cloudflare from "../../Cloudflare/index.ts";
import { DevBox } from "./DevBox.ts";
import { ReleaseBlogger } from "./ReleaseBlogger.ts";
import { GrepLive } from "./tools/Grep.ts";
import { SqlDurableObjectLive } from "./tools/Sql.ts";

export class ReleaseVersion extends Cloudflare.DurableObjectNamespace<ReleaseVersion>()(
  "ReleaseBlogger",
  Effect.gen(function* () {
    const workerLoader = yield* Cloudflare.WorkerLoader("eval");
    const devBox = yield* Cloudflare.Container.bind(DevBox);

    return Effect.gen(function* () {
      const blogger = yield* ReleaseBlogger;
      const state = yield* Cloudflare.DurableObjectState;
      const persistence = yield* Chat.Persistence;

      return {
        generateBlog: Effect.fn(function* (request: { input: any }) {
          // request
          const isStarted = yield* state.storage.get<boolean>("isStarted");
          if (!isStarted) {
            yield* blogger
              .send(request)
              .pipe(
                Effect.provide(Layer.succeed(Chat.Persistence, persistence)),
              );
            yield* state.storage.put("isStarted", true);
          }
        }),
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          SqlDurableObjectLive,
          GrepLive,
          Cloudflare.layerChatDurableObject,
          Cloudflare.WorkerLoader.layer(workerLoader),
          Cloudflare.Container.layer(devBox, {
            enableInternet: true,
          }),
        ),
      ),
    );
  }),
) {}
