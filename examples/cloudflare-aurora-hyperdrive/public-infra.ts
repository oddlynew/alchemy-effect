import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PublicHyperdrive } from "./src/PublicDb.ts";
import { PUBLIC_INFRA_STACK } from "./src/names.ts";

/**
 * Infra stack for the public-firewall path: a publicly-accessible Aurora
 * cluster (migrations applied via the RDS Data API) fronted by a Hyperdrive
 * whose origin is the cluster's public endpoint. Deploy this first; the app
 * stack's Worker references the Hyperdrive created here.
 */
export default Alchemy.Stack(
  PUBLIC_INFRA_STACK,
  {
    providers: Layer.mergeAll(
      AWS.providers(),
      Cloudflare.providers(),
      Drizzle.providers(),
    ),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const hyperdrive = yield* PublicHyperdrive;
    return { hyperdriveId: hyperdrive.hyperdriveId };
  }),
);
