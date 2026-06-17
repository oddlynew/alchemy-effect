import { RDSDataClient } from "@aws-sdk/client-rds-data";
import type { AnyRelations, EmptyRelations } from "drizzle-orm";
import { drizzle as drizzleDataApi } from "drizzle-orm/aws-data-api/pg";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import { ExecutionContext } from "../../ExecutionContext.ts";
import { proxyChainPromise } from "../../Util/proxy-chain.ts";
import type { DBCluster } from "../RDS/DBCluster.ts";
import type { Secret } from "../SecretsManager/Secret.ts";
import { BatchExecuteStatementPolicy } from "./BatchExecuteStatement.ts";
import { BeginTransactionPolicy } from "./BeginTransaction.ts";
import { CommitTransactionPolicy } from "./CommitTransaction.ts";
import { ExecuteStatementPolicy } from "./ExecuteStatement.ts";
import { RollbackTransactionPolicy } from "./RollbackTransaction.ts";

export interface DataApiOptions<TRelations extends AnyRelations> {
  /** Secrets Manager secret holding the cluster's credentials. */
  secret: Secret;
  /**
   * Database name to connect to.
   * @default "app"
   */
  database?: string;
  /** Optional drizzle relations (for the relational query API). */
  relations?: TRelations;
}

/**
 * Runtime Drizzle client backed by the **RDS Data API** — the AWS analog of
 * {@link import("../../Drizzle/Postgres.ts").postgres}, but speaking the Data
 * API over HTTPS+IAM instead of a `postgres://` connection. Ideal for Lambda
 * functions that stay out of the VPC.
 *
 * Like `Drizzle.postgres`, it returns a chainable proxy over the drizzle
 * database — query builders can be `yield*`-ed directly. The underlying
 * `RDSDataClient` + drizzle instance are built lazily and memoized on the
 * current `ExecutionContext`, so they're created at most once per invocation.
 * IAM for every Data API operation drizzle may issue (statements +
 * transactions) is attached at deploy time via the RDSData policies, which come
 * from `AWS.providers()` on the Stack — nothing extra to provide on the Function.
 *
 * @binding
 * @example
 * ```typescript
 * const db = yield* AWS.RDSData.drizzle(cluster, { secret, relations });
 *
 * fetch: Effect.gen(function* () {
 *   const users = yield* db.select().from(Users);
 *   return yield* HttpServerResponse.json({ users });
 * });
 * ```
 */
export const drizzle = <TRelations extends AnyRelations = EmptyRelations>(
  cluster: DBCluster,
  options: DataApiOptions<TRelations>,
) =>
  Effect.gen(function* () {
    const database = options.database ?? "app";
    // Attach IAM (deploy-time) for every Data API operation drizzle may issue.
    // We yield the *policies* directly rather than the binding Services — the
    // Service `Live` layers resolve the distilled SDK ops, which would require
    // the AWS environment (Region/Credentials) at runtime; this binding talks
    // to the Data API through its own `RDSDataClient`, so it needs none of
    // that. Each policy is a no-op at runtime (its layer isn't provided).
    const policyOptions = { secret: options.secret, database };
    const execPolicy = yield* ExecuteStatementPolicy;
    const batchPolicy = yield* BatchExecuteStatementPolicy;
    const beginPolicy = yield* BeginTransactionPolicy;
    const commitPolicy = yield* CommitTransactionPolicy;
    const rollbackPolicy = yield* RollbackTransactionPolicy;
    yield* execPolicy(cluster, policyOptions);
    yield* batchPolicy(cluster, policyOptions);
    yield* beginPolicy(cluster, policyOptions);
    yield* commitPolicy(cluster, policyOptions);
    yield* rollbackPolicy(cluster, policyOptions);

    const resourceArn = yield* cluster.dbClusterArn;
    const secretArn = yield* options.secret.secretArn;

    const symbol = Symbol();
    // Typed as drizzle's effect-aware `EffectPgDatabase` — its query-builder
    // surface is structurally identical to the aws-data-api db, but every
    // terminal resolves to an `Effect`, which is exactly what `proxyChainPromise`
    // produces at runtime (it wraps the driver's `QueryPromise` thenables).
    return proxyChainPromise<
      EffectPgDatabase<TRelations> & { $client: RDSDataClient }
    >(
      Effect.gen(function* () {
        const ctx = yield* ExecutionContext;
        return yield* (ctx.cache[symbol] ??= yield* Effect.gen(function* () {
          const arn = yield* resourceArn;
          const sec = yield* secretArn;
          // Region + credentials resolve from the Lambda execution environment
          // via the AWS SDK default provider chain.
          const client = new RDSDataClient({});
          return drizzleDataApi({
            client,
            database,
            resourceArn: arn,
            secretArn: sec,
            relations: options.relations,
          });
        }).pipe(Effect.cached));
      }) as Effect.Effect<
        EffectPgDatabase<TRelations> & { $client: RDSDataClient }
      >,
    );
  });

/** Friendly alias for {@link drizzle}. */
export const dataApi = drizzle;
