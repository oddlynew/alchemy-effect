import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TunnelInfra } from "./src/TunnelDb.ts";
import { TUNNEL_INFRA_STACK } from "./src/names.ts";

/**
 * Infra stack for the Tunnel + Access path: a private Aurora cluster, a
 * cloudflared connector (ECS Fargate), a Cloudflare Tunnel + Access guarding a
 * hostname, and an Access-protected Hyperdrive. Requires `CLOUDFLARE_ZONE_ID`
 * and `CLOUDFLARE_ZONE_NAME` for the Access hostname. Deploy before the app.
 */
export default Alchemy.Stack(
  TUNNEL_INFRA_STACK,
  {
    providers: Layer.mergeAll(
      AWS.providers(),
      Cloudflare.providers(),
      Drizzle.providers(),
    ),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const hyperdrive = yield* TunnelInfra;
    return { hyperdriveId: hyperdrive.hyperdriveId };
  }),
);
