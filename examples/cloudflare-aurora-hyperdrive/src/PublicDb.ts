import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { makeAurora } from "./Aurora.ts";
import { HYPERDRIVE_ID } from "./names.ts";

/**
 * Public-firewall path: a publicly-accessible Aurora cluster whose security
 * group allows the database port from Cloudflare. In production, restrict the
 * ingress CIDR to Hyperdrive's published egress ranges rather than 0.0.0.0/0.
 */
export const PublicAurora = makeAurora({
  publiclyAccessible: true,
  nat: "none",
  dbIngress: [
    {
      ipProtocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      cidrIpv4: "0.0.0.0/0",
      description:
        "Postgres from Hyperdrive (restrict to Cloudflare egress ranges in production)",
    },
  ],
});

/** Hyperdrive pointed straight at the cluster's public endpoint. */
export const PublicHyperdrive = Effect.gen(function* () {
  const { cluster, dbSchema, password } = yield* PublicAurora;
  return yield* Cloudflare.Hyperdrive(HYPERDRIVE_ID, {
    origin: {
      scheme: "postgres",
      // Gate the host on `dbSchema` so the Hyperdrive (which Cloudflare
      // connection-validates at create) isn't created until the writer is
      // reachable and migrations have applied.
      host: Output.all(cluster.endpoint, dbSchema.database).pipe(
        Output.map(([endpoint]) => endpoint as string),
      ),
      port: cluster.port.as<number>(),
      database: "app",
      user: "app",
      password,
    },
  });
});
