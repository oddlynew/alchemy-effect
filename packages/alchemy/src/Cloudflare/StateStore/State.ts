import * as workers from "@distilled.cloud/cloudflare/workers";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import * as Cloudflare from "../../Cloudflare/Providers.ts";
import * as Plan from "../../Plan.ts";
import * as Alchemy from "../../Stack.ts";

import { STATE_STORE_SCRIPT_NAME } from "../../State/HttpStateStoreConstants.ts";
import { localState } from "../../State/LocalState.ts";
import { State } from "../../State/State.ts";
import { CloudflareEnvironment } from "../CloudflareEnvironment.ts";
import Api from "./Api.ts";
import { TokenValue } from "./Token.ts";

export const state = () =>
  Layer.effect(
    State,
    Effect.gen(function* () {
      const { accountId } = yield* CloudflareEnvironment;
      const workerExists = yield* workers
        .getScriptSetting({
          accountId,
          scriptName: STATE_STORE_SCRIPT_NAME,
        })
        .pipe(
          Effect.map((setting) => setting !== undefined),
          Effect.catchTag("WorkerNotFound", () => Effect.succeed(false)),
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

      if (!workerExists) {
        // deploy it with local state
        const stack = yield* Alchemy.Stack(
          "CloudflareStateStore",
          {
            providers: Cloudflare.providers(),
            state: localState(),
          },
          stackEff,
        );
        const plan = yield* Plan.make(stack);
        plan;
        // return plan;
      }
      return State.of({});
    }).pipe(Effect.orDie),
  );
