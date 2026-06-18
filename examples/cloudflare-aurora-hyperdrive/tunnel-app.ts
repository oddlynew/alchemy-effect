import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import TunnelApi from "./src/TunnelApi.ts";
import { TUNNEL_APP_STACK } from "./src/names.ts";

/**
 * App stack for the Tunnel + Access path: a Cloudflare Worker binding the
 * Access-protected Hyperdrive from the tunnel infra stack. Cloudflare-only;
 * deploy after `tunnel-infra.ts`.
 */
export default Alchemy.Stack(
  TUNNEL_APP_STACK,
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const api = yield* TunnelApi;
    return { url: api.url.as<string>() };
  }),
);
