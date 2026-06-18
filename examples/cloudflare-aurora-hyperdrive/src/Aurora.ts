import * as AWS from "alchemy/AWS";
import * as Drizzle from "alchemy/Drizzle";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export interface AuroraOptions {
  /**
   * `true`  — public subnets + `publiclyAccessible` instances (public-firewall path).
   * `false` — private subnets, no public endpoint (Tunnel + Access path).
   */
  publiclyAccessible: boolean;
  /** Ingress rules for the cluster's security group (path-specific). */
  dbIngress: AWS.EC2.SecurityGroupRuleData[];
  /** NAT strategy — `"single"` when the VPC needs egress (cloudflared). */
  nat?: "none" | "single";
}

/**
 * Shared Aurora bring-up used by both Hyperdrive paths: a VPC, a cluster with a
 * **known** master password (from `DB_PASSWORD`, so a Hyperdrive origin can use
 * it without a deploy-time secret read), and Drizzle migrations applied through
 * the RDS Data API.
 *
 * Returns the cluster + resolved credentials so the caller can build the
 * appropriate Hyperdrive origin (public or Access-protected).
 */
export const makeAurora = (options: AuroraOptions) =>
  Effect.gen(function* () {
    const password = yield* Config.redacted("DB_PASSWORD");

    const network = yield* AWS.EC2.Network("Network", {
      cidrBlock: "10.0.0.0/16",
      // Explicit AZs avoid an ec2:DescribeAvailabilityZones call (the layer
      // re-runs in any bound runtime); see the RDS example's note.
      availabilityZones: ["us-west-2a", "us-west-2b"],
      nat: options.nat ?? "none",
    });

    const dbSecurityGroup = yield* AWS.EC2.SecurityGroup(
      "DatabaseSecurityGroup",
      {
        vpcId: network.vpcId,
        description: "Aurora cluster for the Hyperdrive example",
        ingress: options.dbIngress,
      },
    );

    const schema = yield* Drizzle.Schema("AppSchema", {
      schema: "./src/schema.ts",
      out: "./migrations",
    });

    const db = yield* AWS.RDS.Aurora("AppDb", {
      databaseName: "app",
      subnetIds: options.publiclyAccessible
        ? network.publicSubnetIds
        : network.privateSubnetIds,
      securityGroupIds: [dbSecurityGroup.groupId],
      secret: {
        username: "app",
        // Known password so both Hyperdrive origins can authenticate.
        secretString: Redacted.make(
          JSON.stringify({
            username: "app",
            password: Redacted.value(password),
          }),
        ),
      },
      instance: {
        dbInstanceClass: "db.serverless",
        publiclyAccessible: options.publiclyAccessible,
      },
    });

    const dbSchema = yield* AWS.RDS.Schema("AppDbSchema", {
      resourceArn: db.cluster.dbClusterArn,
      secretArn: db.secret.secretArn,
      database: "app",
      migrationsDir: schema.out,
    });

    // `dbSchema` only completes once the writer is reachable and migrations are
    // applied — downstream (the Hyperdrive) depends on it so it isn't created
    // (and connection-validated by Cloudflare) before the database is ready.
    return {
      network,
      dbSecurityGroup,
      cluster: db.cluster,
      dbSchema,
      password,
    };
  });
