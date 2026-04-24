import * as workers from "@distilled.cloud/cloudflare/workers";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import * as Plan from "../../Plan.ts";
import { STATE_STORE_SCRIPT_NAME } from "../../State/HttpStateStoreConstants.ts";
import { State } from "../../State/State.ts";
import { CloudflareEnvironment } from "../CloudflareEnvironment.ts";
import Api from "./Api.ts";
import { TokenValue } from "./Token.ts";

export const state = () =>
  Layer.effect(
    State,
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;
      const worker = yield* workers
        .getScriptSetting({
          accountId,
          scriptName: STATE_STORE_SCRIPT_NAME,
        })
        .pipe(
          Effect.catchTag("WorkerNotFound", () => Effect.succeed(undefined)),
        );

      const stackEff = Effect.gen(function* () {
        const token = yield* TokenValue;
        const api = yield* Api;

        // Surface the bearer token so tests and clients can authenticate
        // after deploy. The underlying value lives in the Cloudflare
        // Secrets Store; this output carries the same generated string.
        return {
          url: api.url.as<string>(),
          authToken: token.text.pipe(Output.map(Redacted.value)),
        };
      });

      if (!worker) {
        const stack = Alchemy.Stack(
          "CloudflareStateStore",
          {
            providers: Cloudflare.providers(),
          },
          stackEff,
        );
        yield* Plan.make(stack);
      }
      return State.of({});
    }).pipe(Effect.orDie),
  );
