import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { PlatformError } from "effect/PlatformError";

/**
 * Builder Container — runs one job at a time inside a Cloudflare Container
 * sidecar. Each method on the RPC shape is a discrete build phase the
 * Builds DO can call by RPC.
 *
 * The class is declared in this file (the DO needs to import it for
 * `Cloudflare.Container.bind`); the runtime implementation lives in
 * `Builder.runtime.ts` so the bundler can tree-shake it out of consumers
 * that only need the binding.
 */
export class Builder extends Cloudflare.Container<
  Builder,
  {
    /**
     * Clone the artifacts repo at `ref` into `/work`, run `bun install` and
     * `bun run build`. Returns the build's exit code and tail of logs.
     */
    runBuild: (input: {
      artifactsRepo: string;
      artifactsRemote: string;
      artifactsToken: string;
      ref: string;
      sha: string;
    }) => Effect.Effect<
      {
        exitCode: number;
        logTail: string;
      },
      PlatformError
    >;

    /**
     * Run a coding-agent task in the cloned tree. The agent is invoked
     * with the supplied prompt; the container then runs `git push` to
     * propagate any commits back.
     */
    runAgent: (input: {
      artifactsRepo: string;
      artifactsRemote: string;
      artifactsToken: string;
      ref: string;
      prompt: string;
      pushBranch?: string;
    }) => Effect.Effect<
      {
        exitCode: number;
        logTail: string;
        pushedSha: string | null;
      },
      PlatformError
    >;
  }
>()("Builder", {
  main: import.meta.path,
  instanceType: "dev",
  observability: { logs: { enabled: true } },
}) {}
