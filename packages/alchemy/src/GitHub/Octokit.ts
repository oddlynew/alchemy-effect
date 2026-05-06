import { Octokit } from "@octokit/rest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

/**
 * Runtime Octokit handle used by Worker/Container capabilities. Distinct
 * from {@link GitHubCredentials} because the deploy-time service expects
 * to resolve credentials via the AuthProvider (CLI / env / stored), while
 * the runtime side must be handed a token directly through a Worker
 * binding.
 */
export interface RuntimeOctokitService {
  readonly token: Redacted.Redacted<string>;
  readonly client: Octokit;
}

export class RuntimeOctokit extends Context.Service<
  RuntimeOctokit,
  RuntimeOctokitService
>()("GitHub.RuntimeOctokit") {}

/**
 * Build a `RuntimeOctokit` layer from a literal token. The Worker stack
 * passes the token as an environment binding and constructs this layer
 * during the init phase.
 */
export const fromToken = (token: string | Redacted.Redacted<string>) => {
  const redacted = typeof token === "string" ? Redacted.make(token) : token;
  return Layer.succeed(RuntimeOctokit, {
    token: redacted,
    client: new Octokit({ auth: Redacted.value(redacted) }),
  });
};

/**
 * Build a `RuntimeOctokit` layer that reads the token from an env binding
 * (defaults to `GITHUB_TOKEN`). Use this inside a Worker init when the
 * token has been wired into the bindings as a plain env value.
 */
export const fromEnv = (varName = "GITHUB_TOKEN") =>
  Layer.effect(
    RuntimeOctokit,
    Effect.sync(() => {
      const token = (globalThis as any).process?.env?.[varName] as
        | string
        | undefined;
      if (!token) {
        throw new Error(
          `RuntimeOctokit.fromEnv: missing env var '${varName}'. Wire it into the Worker's bindings.`,
        );
      }
      const redacted = Redacted.make(token);
      return {
        token: redacted,
        client: new Octokit({ auth: token }),
      };
    }),
  );

/**
 * Pull the raw Octokit client out of the runtime service. Convenience for
 * capability implementations that just want to call `client.rest.X.Y`.
 */
export const client: Effect.Effect<Octokit, never, RuntimeOctokit> = Effect.gen(
  function* () {
    const svc = yield* RuntimeOctokit;
    return svc.client;
  },
);
