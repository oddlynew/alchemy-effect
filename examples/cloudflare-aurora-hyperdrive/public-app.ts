import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import PublicApi from "./src/PublicApi.ts";
import { PUBLIC_APP_STACK } from "./src/names.ts";

/**
 * App stack for the public-firewall path: a Cloudflare Worker that binds the
 * Hyperdrive from the infra stack by reference and serves user CRUD via Drizzle.
 * Cloudflare-only — deploy after `public-infra.ts`.
 */
export default Alchemy.Stack(
  PUBLIC_APP_STACK,
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const api = yield* PublicApi;
    return { url: api.url.as<string>() };
  }),
);
