import * as Drizzle from "alchemy/Drizzle";
import * as Railway from "alchemy/Railway";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { Postgres } from "./Postgres.ts";
import { Project } from "./Project.ts";
import { Users } from "./schema.ts";

/**
 * An Effect-native HTTP service deployed as a Railway Function, querying
 * the bound Postgres database through Drizzle ORM
 * (`drizzle-orm/effect-postgres`).
 *
 * - `GET /`       — list users
 * - `POST /`      — insert a random user
 * - `GET /health` — healthcheck probed by Railway before routing traffic
 */
export default class Api extends Railway.Function<Api>()(
  "Api",
  Effect.gen(function* () {
    const project = yield* Project;
    return {
      main: import.meta.filename,
      project,
      name: "api",
      // `pg` (the driver under @effect/sql-pg) stays external to the
      // bundle; Railway installs it during the image build.
      external: ["pg"],
      healthcheckPath: "/health",
    };
  }),
  Effect.gen(function* () {
    // Deploy time: writes `POSTGRES_URL=${{<db>.DATABASE_URL}}` (plus
    // `_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_DATABASE`) onto this
    // service via Railway reference-variable syntax. Runtime: typed
    // accessors over those variables.
    const conn = yield* Railway.PostgresDatabase.bind(Postgres);

    // Drizzle over Effect's native Postgres client. The pool is built
    // lazily on the first query and shared for the process lifetime.
    const db = yield* Drizzle.postgres(conn.connectionString);

    // Idempotent schema bootstrap, run once per process before the
    // first query (a real app would apply migrations out of band).
    const ensureSchema = yield* Effect.cached(
      Effect.gen(function* () {
        yield* db.$client.unsafe(
          `create table if not exists users (
            id serial primary key,
            email text not null unique,
            name text not null,
            created_at timestamptz not null default now()
          )`,
        );
      }),
    );

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;

        if (request.url.startsWith("/health")) {
          return HttpServerResponse.text("ok");
        }

        yield* ensureSchema;

        switch (request.method) {
          case "GET": {
            const users = yield* db.select().from(Users);
            return yield* HttpServerResponse.json({ users });
          }
          case "POST": {
            const [user] = yield* db
              .insert(Users)
              .values({
                name: crypto.randomUUID(),
                email: `${crypto.randomUUID()}@example.com`,
              })
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
        Effect.catch((error) =>
          HttpServerResponse.json({ error: String(error) }, { status: 500 }),
        ),
      ),
    };
  }).pipe(Effect.provide(Railway.PostgresDatabaseBindingLive)),
) {}
