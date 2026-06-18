# cloudflare-aurora-hyperdrive

A Cloudflare Worker reaching an AWS RDS **Aurora** database through
**Hyperdrive**, with Drizzle migrations applied at deploy time via the RDS Data
API. Aurora lives in a VPC, so there are two ways to let Hyperdrive reach it —
documented here as alternative paths with their trade-offs.

The example is split into an **infra stack** (AWS Aurora + the Hyperdrive
config) and an **app stack** (the Cloudflare Worker). The Worker binds the
Hyperdrive **by reference** (`Cloudflare.Hyperdrive.ref(id, { stack })`), so the
app stack — and the Worker bundle — stay Cloudflare-only; no AWS code or
credentials leak into the Worker. Deploy the infra stack first, then the app
stack.

```
src/schema.ts      Drizzle schema (Users/Posts)
src/handler.ts     shared CRUD handler (Drizzle over Hyperdrive)
src/Aurora.ts      shared: VPC + Aurora + Drizzle.Schema + RDS.Schema (Data API migrations)
src/names.ts       shared stack names + Hyperdrive logical id
src/PublicDb.ts    public path: Aurora (public) + Hyperdrive (public origin)
src/PublicApi.ts   public path: Worker binding Hyperdrive.ref(...)
public-infra.ts    public path: infra stack
public-app.ts      public path: app stack
test/integ.test.ts deploys infra → app, drives CRUD over HTTP, destroys
```

## Path A — public endpoint + firewall (implemented)

The Aurora cluster is publicly accessible; its security group allows the
database port from Cloudflare, and Hyperdrive connects to the public endpoint
directly.

```ts
Cloudflare.Hyperdrive("AppHyperdrive", {
  origin: {
    scheme: "postgres",
    host: cluster.endpoint, // public writer endpoint
    port: cluster.port,
    database: "app",
    user: "app",
    password,
  },
});
```

- **Pros:** simplest setup; lowest latency (Hyperdrive connects straight to RDS).
- **Cons:** the database has a public endpoint. Mitigate by restricting the
  security-group ingress to [Hyperdrive's published egress IP ranges](https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-settings/)
  rather than `0.0.0.0/0`, and require TLS.
- **Best for:** when a (firewalled) public endpoint is acceptable.

Run it:

```sh
DB_PASSWORD=<password> bun test          # deploy infra → app → CRUD → destroy
```

## Path B — Cloudflare Tunnel + Access (private, recommended for production)

Keep Aurora fully private (no public endpoint). Run `cloudflared` inside the VPC
(e.g. as an ECS Fargate service) connected to a Cloudflare Tunnel that
TCP-routes a hostname to the Aurora endpoint, secure the hostname with a
Cloudflare Access self-hosted app + a Service-Auth policy + a service token, and
point Hyperdrive at an **Access-protected origin**:

```ts
Cloudflare.Hyperdrive("AppHyperdrive", {
  origin: {
    scheme: "postgres",
    host: tunnelHostname, // no port for an Access origin
    database: "app",
    user: "app",
    password,
    accessClientId: token.clientId,
    accessClientSecret: token.clientSecret,
  },
  dev: { /* public localhost origin for `alchemy dev` */ },
});
```

- **Pros:** the database never leaves the VPC; strongest isolation.
- **Cons:** you run and pay for `cloudflared` (ECS), and add a tunnel hop
  (latency + connector cold-start).
- **Best for:** production databases that must stay private.

All the alchemy primitives exist (`Cloudflare.Tunnel`, `DnsRecord`,
`Access.Application/Policy/ServiceToken`, `Hyperdrive`'s Access origin, and
`AWS.ECS.*` for `cloudflared`). See Cloudflare's guide:
[Connect to a private database using Tunnel](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/).

> Cloudflare's newest option, [Workers VPC](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/),
> is a cleaner future path; alchemy has a `Cloudflare.VpcService` resource, but
> Hyperdrive's origin can't yet reference it, so it's not wired here.
