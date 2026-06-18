import * as Alchemy from "alchemy";
import * as AWS from "alchemy/AWS";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import CloudflaredTask from "./CloudflaredTask.ts";
import { TUNNEL_HYPERDRIVE_ID } from "./names.ts";

/**
 * Tunnel + Access (private) path. Aurora stays in private subnets with no public
 * endpoint; a `cloudflared` connector runs in the VPC (ECS Fargate) and a
 * Cloudflare Tunnel TCP-routes a hostname to the cluster. Cloudflare Access
 * (self-hosted app + Service-Auth policy + service token) guards the hostname,
 * and Hyperdrive uses an Access-protected origin.
 */
export const TunnelInfra = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const password = yield* Config.redacted("DB_PASSWORD");
  const zoneName = yield* Config.string("CLOUDFLARE_ZONE_NAME").pipe(
    Config.withDefault("alchemy-test-2.us"),
  );
  const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
  const zone = yield* Cloudflare.findZoneByName({
    accountId,
    name: zoneName,
  }).pipe(Effect.provide(FetchHttpClient.layer), Effect.orDie);
  if (!zone) {
    return yield* Effect.die(`Cloudflare zone "${zoneName}" not found`);
  }
  const zoneId = zone.id;
  const hostname = `aurora-tunnel-${stage}.${zoneName}`;

  // ── AWS network (private subnets + a NAT for cloudflared egress) ─────────
  const network = yield* AWS.EC2.Network("Network", {
    cidrBlock: "10.0.0.0/16",
    availabilityZones: ["us-west-2a", "us-west-2b"],
    nat: "single",
  });

  const cloudflaredSecurityGroup = yield* AWS.EC2.SecurityGroup(
    "CloudflaredSecurityGroup",
    {
      vpcId: network.vpcId,
      description: "cloudflared connector",
      egress: [
        {
          ipProtocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrIpv4: "0.0.0.0/0",
          description: "HTTPS to Cloudflare edge",
        },
        {
          ipProtocol: "udp",
          fromPort: 7844,
          toPort: 7844,
          cidrIpv4: "0.0.0.0/0",
          description: "Cloudflare Tunnel QUIC",
        },
        {
          ipProtocol: "tcp",
          fromPort: 7844,
          toPort: 7844,
          cidrIpv4: "0.0.0.0/0",
          description: "Cloudflare Tunnel HTTP2 fallback",
        },
        {
          ipProtocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          cidrIpv4: "10.0.0.0/16",
          description: "Postgres to Aurora",
        },
      ],
    },
  );

  const databaseSecurityGroup = yield* AWS.EC2.SecurityGroup(
    "DatabaseSecurityGroup",
    {
      vpcId: network.vpcId,
      description: "Aurora cluster (private)",
      ingress: [
        {
          ipProtocol: "tcp",
          fromPort: 5432,
          toPort: 5432,
          referencedGroupId: cloudflaredSecurityGroup.groupId,
          description: "Postgres from cloudflared",
        },
      ],
    },
  );

  // ── Aurora (private) + Data API migrations ──────────────────────────────
  const schema = yield* Drizzle.Schema("AppSchema", {
    schema: "./src/schema.ts",
    out: "./migrations",
  });

  const db = yield* AWS.RDS.Aurora("AppDb", {
    databaseName: "app",
    subnetIds: network.privateSubnetIds,
    securityGroupIds: [databaseSecurityGroup.groupId],
    secret: {
      username: "app",
      secretString: Redacted.make(
        JSON.stringify({ username: "app", password: Redacted.value(password) }),
      ),
    },
    instance: { dbInstanceClass: "db.serverless", publiclyAccessible: false },
  });

  const dbSchema = yield* AWS.RDS.Schema("AppDbSchema", {
    resourceArn: db.cluster.dbClusterArn,
    secretArn: db.secret.secretArn,
    database: "app",
    migrationsDir: schema.out,
  });

  // ── Cloudflare Tunnel → TCP to the cluster ──────────────────────────────
  const tunnel = yield* Cloudflare.Tunnel("AppTunnel", {
    configSrc: "cloudflare",
    ingress: [
      {
        hostname,
        service: Output.interpolate`tcp://${db.cluster.endpoint}:5432`,
      },
      { service: "http_status:404" },
    ],
  });

  yield* Cloudflare.DnsRecord("TunnelCname", {
    zoneId,
    name: hostname,
    type: "CNAME",
    content: Output.interpolate`${tunnel.tunnelId}.cfargotunnel.com`,
    proxied: true,
  });

  // ── Cloudflare Access (Service-Auth) guarding the hostname ──────────────
  const token = yield* Cloudflare.AccessServiceToken("HyperdriveToken", {
    name: `aurora-hyperdrive-${stage}`,
  });

  const policy = yield* Cloudflare.AccessPolicy("AllowHyperdriveToken", {
    name: `aurora-hyperdrive-${stage}`,
    decision: "non_identity",
    include: [{ serviceToken: { tokenId: token.serviceTokenId } }],
  });

  const app = yield* Cloudflare.AccessApplication("DbAccess", {
    type: "self_hosted",
    name: `aurora-hyperdrive-${stage}`,
    domain: hostname,
    policies: [policy.policyId],
  });

  // ── cloudflared connector (ECS Fargate) ─────────────────────────────────
  const cluster = yield* AWS.ECS.Cluster("CloudflaredCluster", {});
  const task = yield* CloudflaredTask({
    tunnelToken: Output.map(tunnel.token, Redacted.value),
  });
  const service = yield* AWS.ECS.Service("CloudflaredService", {
    cluster,
    task,
    vpcId: network.vpcId,
    subnets: network.privateSubnetIds,
    securityGroups: [cloudflaredSecurityGroup.groupId],
    assignPublicIp: false,
    desiredCount: 1,
  });

  // ── Hyperdrive (Access origin) ──────────────────────────────────────────
  // Gate creation on the connector + migrations + DNS + Access, so Cloudflare's
  // connect-time validation runs only once the whole path is live.
  const hyperdrive = yield* Cloudflare.Hyperdrive(TUNNEL_HYPERDRIVE_ID, {
    origin: {
      scheme: "postgres",
      host: Output.all(
        service.serviceArn,
        dbSchema.database,
        app.applicationId,
      ).pipe(Output.map(() => hostname)),
      database: "app",
      user: "app",
      password,
      accessClientId: Output.map(token.clientId, (id) => Redacted.make(id)),
      accessClientSecret: Output.map(token.clientSecret, (s) => s!),
    },
    // Access origins can't be reached in `alchemy dev`; supply a local origin.
    dev: {
      scheme: "postgres",
      host: "localhost",
      port: 5432,
      database: "app",
      user: "app",
      password,
    },
  });

  return hyperdrive;
});
