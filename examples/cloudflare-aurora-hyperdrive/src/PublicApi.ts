import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import { makeFetch, relations } from "./handler.ts";
import { HYPERDRIVE_ID, PUBLIC_INFRA_STACK } from "./names.ts";

/**
 * Worker for the public-firewall path. It binds the Hyperdrive **by reference**
 * into the infra stack (`Hyperdrive.ref(id, { stack })`), so the app stack —
 * and the Worker bundle — only ever touch Cloudflare. The infra stack (Aurora +
 * Hyperdrive) is deployed first; this stack references its already-deployed
 * Hyperdrive.
 */
export default class PublicApi extends Cloudflare.Worker<PublicApi>()(
  "PublicApi",
  { main: import.meta.filename },
  Effect.gen(function* () {
    const conn = yield* Cloudflare.Hyperdrive.bind(
      Cloudflare.Hyperdrive.ref(HYPERDRIVE_ID, { stack: PUBLIC_INFRA_STACK }),
    );
    const db = yield* Drizzle.postgres(conn.connectionString, { relations });
    return { fetch: makeFetch(db) };
  }).pipe(Effect.provide(Cloudflare.HyperdriveBindingLive)),
) {}
