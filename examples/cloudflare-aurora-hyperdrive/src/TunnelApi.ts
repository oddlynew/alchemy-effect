import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import { makeFetch, relations } from "./handler.ts";
import { TUNNEL_HYPERDRIVE_ID, TUNNEL_INFRA_STACK } from "./names.ts";

/**
 * Worker for the Tunnel + Access path. Binds the Access-protected Hyperdrive
 * from the tunnel infra stack by reference — the database is private, reached
 * via cloudflared + Cloudflare Access — and serves the same CRUD handler.
 */
export default class TunnelApi extends Cloudflare.Worker<TunnelApi>()(
  "TunnelApi",
  { main: import.meta.filename },
  Effect.gen(function* () {
    const conn = yield* Cloudflare.Hyperdrive.bind(
      Cloudflare.Hyperdrive.ref(TUNNEL_HYPERDRIVE_ID, {
        stack: TUNNEL_INFRA_STACK,
      }),
    );
    const db = yield* Drizzle.postgres(conn.connectionString, { relations });
    return { fetch: makeFetch(db) };
  }).pipe(Effect.provide(Cloudflare.HyperdriveBindingLive)),
) {}
