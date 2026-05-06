import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Builder } from "./Builder.ts";

/**
 * Per-SHA build orchestrator. One Durable Object instance per (repo, sha):
 * holds run state in `state.storage`, dispatches to a Container by RPC,
 * and reports back via the GitHub.CommitStatuses capability.
 *
 * Routing convention: callers do `builds.getByName(\`${repo.fullName}@${sha}\`)`
 * so each sha gets its own DO and runs are naturally serialized.
 */
export type BuildState = {
  status: "pending" | "running" | "success" | "failure";
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  logTail?: string;
};

export default class Builds extends Cloudflare.DurableObjectNamespace<Builds>()(
  "Builds",
  Effect.gen(function* () {
    // Outer init: bind the Container class once per Worker. The bound
    // value is an Effect that resolves the container handle inside each
    // DO instance via `Cloudflare.start`.
    const builderEff = yield* Cloudflare.Container.bind(Builder);

    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;
      const builder = yield* Cloudflare.start(builderEff);

      return {
        get: () =>
          Effect.gen(function* () {
            const raw = yield* state.storage.get<BuildState>("state");
            return raw ?? { status: "pending" as const };
          }),

        runBuild: (input: {
          artifactsRepo: string;
          artifactsRemote: string;
          artifactsToken: string;
          ref: string;
          sha: string;
        }) =>
          Effect.gen(function* () {
            yield* state.storage.put<BuildState>("state", {
              status: "running",
              startedAt: Date.now(),
            });
            const result = yield* builder
              .runBuild(input)
              .pipe(
                Effect.catch((e) =>
                  Effect.succeed({ exitCode: 1, logTail: String(e) }),
                ),
              );
            const finalState: BuildState = {
              status: result.exitCode === 0 ? "success" : "failure",
              startedAt: Date.now(),
              completedAt: Date.now(),
              exitCode: result.exitCode,
              logTail: result.logTail,
            };
            yield* state.storage.put<BuildState>("state", finalState);
            return finalState;
          }),

        runAgent: (input: {
          artifactsRepo: string;
          artifactsRemote: string;
          artifactsToken: string;
          ref: string;
          prompt: string;
          pushBranch?: string;
        }) =>
          builder.runAgent(input).pipe(
            Effect.catch((e) =>
              Effect.succeed({
                exitCode: 1,
                logTail: String(e),
                pushedSha: null,
              }),
            ),
          ),
      };
    });
  }),
) {}
