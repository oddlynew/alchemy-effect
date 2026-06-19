import * as PrPackage from "@oddlynew/alchemy-pr-package";
import * as Alchemy from "@oddlynew/alchemy";
import * as Cloudflare from "@oddlynew/alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import Api from "./src/Api.ts";

export default Alchemy.Stack(
  "PrPackage",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* PrPackage.AuthTokenValue;
    const api = yield* Api;
    return {
      url: api.url.as<string>(),
      authToken: "<redacted>",
    };
  }),
);
