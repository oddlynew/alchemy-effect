import * as Alchemy from "alchemy";
import * as Railway from "alchemy/Railway";
import * as Effect from "effect/Effect";
import Api from "./src/Api.ts";

export default Alchemy.Stack(
  "RailwayPostgresDrizzleExample",
  {
    providers: Railway.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    // The Project and Postgres database are registered by the Api
    // Function itself (see src/Api.ts) — yielding Api deploys all three.
    const api = yield* Api;
    return {
      url: api.url.as<string>(),
      projectId: api.projectId,
    };
  }),
);
