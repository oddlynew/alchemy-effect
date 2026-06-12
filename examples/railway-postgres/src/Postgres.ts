import * as Railway from "alchemy/Railway";
import * as Effect from "effect/Effect";
import { Project } from "./Project.ts";

/**
 * A Railway-hosted Postgres database — same image/volume/variable layout
 * as Railway's official Postgres template, fully reconciled by Alchemy.
 *
 * The project must be `yield*`ed before it can be referenced from the
 * database's props, so this is an Effect that registers (or resolves)
 * both resources.
 *
 * The connection string is consumed by the API Function through the
 * `Railway.DatabaseUrl` binding (see src/Api.ts).
 */
export const Postgres = Effect.gen(function* () {
  const project = yield* Project;
  return yield* Railway.Database("Postgres", {
    project,
    // Deploy into the project's default environment explicitly.
    environment: { environmentId: project.defaultEnvironmentId },
    kind: "postgres",
    name: "postgres",
  });
});
