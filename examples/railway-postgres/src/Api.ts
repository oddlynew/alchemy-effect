import * as Railway from "alchemy/Railway";
import * as Sql from "alchemy/Sql";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { Postgres } from "./Postgres.ts";
import { Project } from "./Project.ts";

/**
 * An Effect-native HTTP service deployed as a Railway Function:
 * the program below is bundled, shipped to Railway's build pipeline,
 * and served on a public `*.up.railway.app` domain.
 *
 * - `GET /`       — greeting read from `effect/Config` (a service variable)
 * - `GET /db`     — round-trips a query through the bound Postgres database
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
    // Resolved at deploy time, published as a Railway service variable,
    // and re-read from process.env at runtime — no binding needed.
    const greeting = yield* Config.string("GREETING").pipe(
      Config.withDefault("Hello from Railway!"),
    );

    // Deploy time: writes `POSTGRES_URL=${{<db>.DATABASE_URL}}` (plus
    // `_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_DATABASE`) onto this
    // service via Railway reference-variable syntax. Runtime: typed
    // accessors over those variables.
    const db = yield* Railway.PostgresDatabase.bind(Postgres);

    // Effect's native Postgres client (@effect/sql-pg). The pool is
    // built lazily on the first query and shared for the lifetime of
    // the process.
    const sql = yield* Sql.postgres(db.connectionString);

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;

        if (request.url.startsWith("/health")) {
          return HttpServerResponse.text("ok");
        }

        if (request.url.startsWith("/db")) {
          const rows = yield* sql<{
            now: string;
            database: string;
            version: string;
          }>`select now() as now, current_database() as database, version() as version`;
          return yield* HttpServerResponse.json(rows[0]);
        }

        return yield* HttpServerResponse.json({ message: greeting });
      }).pipe(
        Effect.catch((error) =>
          HttpServerResponse.json({ error: String(error) }, { status: 500 }),
        ),
      ),
    };
  }).pipe(Effect.provide(Railway.PostgresDatabaseBindingLive)),
) {}
