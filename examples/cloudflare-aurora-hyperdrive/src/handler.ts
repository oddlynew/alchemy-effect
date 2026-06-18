import { eq } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { relations, Users } from "./schema.ts";

/**
 * Shared user-CRUD HTTP handler, driven by a Drizzle/Postgres database that the
 * Worker opens over Hyperdrive. Identical for both the public-firewall and
 * Tunnel+Access paths — only how Hyperdrive reaches Aurora differs.
 */
export const makeFetch = (db: EffectPgDatabase<typeof relations>) =>
  Effect.gen(function* () {
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
          .values({ name: crypto.randomUUID(), email: crypto.randomUUID() })
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
  );

// re-export so worker files import schema bits from one place
export { relations, Users };
