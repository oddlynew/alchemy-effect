import * as AWS from "alchemy/AWS";
import * as Drizzle from "alchemy/Drizzle";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * Aurora cluster + deploy-time migrations, exposed as a `Database` service.
 *
 * Provider order on deploy:
 *   1. `Drizzle.Schema` regenerates pending migration SQL under `./migrations`.
 *   2. `AWS.RDS.Aurora` provisions a serverless v2 cluster (Data API enabled).
 *   3. `AWS.RDS.Schema` applies the migrations through the **Data API** — no VPC
 *      reachability required from the deploy machine.
 *
 * The cluster lives in private subnets, but the Lambda reaches it over the
 * public Data API endpoint, so the function never needs to join the VPC.
 */
export class Database extends Context.Service<
  Database,
  {
    cluster: AWS.RDS.DBCluster;
    secret: AWS.SecretsManager.Secret;
  }
>()("Database") {}

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const network = yield* AWS.EC2.Network("Network", {
      cidrBlock: "10.0.0.0/16",
      // Pin explicit AZs rather than a count. `DatabaseLive` is provided to the
      // Lambda, so it re-runs at function init — and resolving a *count* would
      // call `ec2:DescribeAvailabilityZones`, which the Lambda role can't do.
      // Naming the AZs skips that lookup; the cluster/subnet resources
      // themselves resolve from injected outputs at runtime.
      availabilityZones: ["us-west-2a", "us-west-2b"],
    });

    const databaseSecurityGroup = yield* AWS.EC2.SecurityGroup(
      "DatabaseSecurityGroup",
      {
        vpcId: network.vpcId,
        description: "Security group for the Aurora cluster",
      },
    );

    const schema = yield* Drizzle.Schema("AppSchema", {
      schema: "./src/schema.ts",
      out: "./migrations",
    });

    const db = yield* AWS.RDS.Aurora("AppDb", {
      databaseName: "app",
      subnetIds: network.privateSubnetIds,
      securityGroupIds: [databaseSecurityGroup.groupId],
    });

    yield* AWS.RDS.Schema("AppDbSchema", {
      resourceArn: db.cluster.dbClusterArn,
      secretArn: db.secret.secretArn,
      database: "app",
      migrationsDir: schema.out,
    });

    return Database.of({ cluster: db.cluster, secret: db.secret });
  }),
);
