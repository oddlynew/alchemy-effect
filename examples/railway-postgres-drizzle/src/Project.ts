import * as Railway from "alchemy/Railway";

/**
 * The Railway project that contains every service in this example
 * (the API Function and the Postgres database).
 */
export const Project = Railway.Project("Project", {
  name: "railway-postgres-drizzle-example",
});
