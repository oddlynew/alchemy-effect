import * as AWS from "alchemy/AWS";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { Database, DatabaseLive } from "./Db.ts";
import { relations, Users } from "./schema.ts";

/**
 * Lambda function exposing user CRUD over the Aurora cluster via Drizzle,
 * talking to the database through the **RDS Data API** (`AWS.RDSData.drizzle`).
 * No VPC attachment is required — the Data API is reached over HTTPS+IAM.
 *
 * For an in-VPC alternative that uses a pooled `postgres://` connection instead,
 * attach the function to the VPC and swap the binding for:
 *
 * ```typescript
 * const connStr = yield* AWS.RDS.connectionString(cluster, { secret, database: "app" });
 * const db = yield* Drizzle.postgres(connStr, { relations });
 * ```
 */
export default class Api extends AWS.Lambda.Function<Api>()(
  "Api",
  {
    main: import.meta.filename,
    runtime: "nodejs24.x",
    url: true,
  },
  Effect.gen(function* () {
    const { cluster, secret } = yield* Database;
    const db = yield* AWS.RDSData.drizzle(cluster, {
      secret,
      database: "app",
      relations,
    });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const pathname = new URL(request.originalUrl).pathname;

        switch (request.method) {
          case "GET": {
            if (pathname === "/") {
              const users = yield* db.select().from(Users);
              return yield* HttpServerResponse.json({ users });
            }
            const id = Number(pathname.split("/").pop());
            if (Number.isNaN(id)) {
              return yield* HttpServerResponse.json(
                { error: "Invalid user ID" },
                { status: 400 },
              );
            }
            const user = yield* db.query.Users.findFirst({
              where: { id },
              with: { posts: true },
            });
            return yield* HttpServerResponse.json({ user });
          }
          case "POST": {
            const user = yield* db
              .insert(Users)
              .values({
                name: crypto.randomUUID(),
                email: crypto.randomUUID(),
              })
              .returning();
            return yield* HttpServerResponse.json({ user });
          }
          case "DELETE": {
            const id = Number(pathname.split("/").pop());
            if (Number.isNaN(id)) {
              return yield* HttpServerResponse.json(
                { error: "Invalid user ID" },
                { status: 400 },
              );
            }
            const [user] = yield* db
              .delete(Users)
              .where(eq(Users.id, id))
              .returning();
            return yield* HttpServerResponse.json({ user });
          }
          default: {
            return yield* HttpServerResponse.json(
              { error: "Method not allowed" },
              { status: 405 },
            );
          }
        }
      }).pipe(
        Effect.catch((cause: unknown) => {
          const peel = (e: any): any => (e?.cause ? peel(e.cause) : e);
          const root = peel(cause);
          return HttpServerResponse.json(
            {
              ok: false,
              error: String(cause),
              rootError: root?.message ?? String(root),
              rootCode: root?.code,
            },
            { status: 500 },
          );
        }),
      ),
    };
  }).pipe(Effect.provide(DatabaseLive)),
) {}
