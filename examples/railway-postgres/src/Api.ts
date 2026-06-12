import * as Railway from "alchemy/Railway";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import pg from "pg";
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
      // `pg` stays external to the bundle; Railway installs it during
      // the image build (see FunctionProps.external).
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

    // Deploy time: writes `POSTGRES_URL=${{<db>.DATABASE_URL}}` onto this
    // service via Railway reference-variable syntax. Runtime: yields the
    // resolved connection string as a Redacted<string>.
    const postgres = yield* Postgres;
    const databaseUrl = yield* Railway.DatabaseUrl.bind(postgres);

    // TODO(alchemy): the Railway Function runtime does not currently
    // provide RuntimeContext to the fetch handler, so binding accessors
    // like `databaseUrl` fail with "Service not found: RuntimeContext"
    // at runtime. Capture it during Init and re-provide it below.
    const runtimeContext = yield* RuntimeContext;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;

        if (request.url.startsWith("/health")) {
          return HttpServerResponse.text("ok");
        }

        if (request.url.startsWith("/db")) {
          const url = Redacted.value(yield* databaseUrl);
          return yield* queryDb(url).pipe(
            Effect.flatMap((row) => HttpServerResponse.json(row)),
            Effect.catchTag("UnknownError", (error) =>
              HttpServerResponse.json(
                { error: String(error.cause) },
                { status: 500 },
              ),
            ),
          );
        }

        return yield* HttpServerResponse.json({ message: greeting });
      }).pipe(Effect.provideService(RuntimeContext, runtimeContext)),
    };
  }).pipe(Effect.provide(Railway.DatabaseUrlLive)),
) {}

/** Run a single query over a fresh connection and close it. */
const queryDb = (connectionString: string) =>
  Effect.tryPromise(async () => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(
        "select now() as now, current_database() as database, version() as version",
      );
      return result.rows[0] as {
        now: string;
        database: string;
        version: string;
      };
    } finally {
      await client.end();
    }
  });
