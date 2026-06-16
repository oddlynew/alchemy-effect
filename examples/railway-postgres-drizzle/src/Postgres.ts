import * as Railway from "alchemy/Railway";
import * as Effect from "effect/Effect";
import { Project } from "./Project.ts";

/**
 * A Railway-hosted Postgres database — same image/volume/variable layout
 * as Railway's official Postgres template, fully reconciled by Alchemy.
 *
 * The connection details are consumed by the API Function through
 * `Railway.PostgresDatabase.bind` and handed to Drizzle (see src/Api.ts).
 */
export const Postgres = Effect.gen(function* () {
  const project = yield* Project;
  return yield* Railway.PostgresDatabase("Postgres", {
    project,
    environment: { environmentId: project.defaultEnvironmentId },
    name: "postgres",
  });
});
