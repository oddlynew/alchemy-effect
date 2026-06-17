import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Api from "./src/Api.ts";

export default Alchemy.Stack(
  "AwsLambdaRdsAuroraDrizzleExample",
  {
    providers: Layer.mergeAll(AWS.providers(), Drizzle.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const api = yield* Api;
    return {
      url: api.functionUrl,
    };
  }),
);
