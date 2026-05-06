import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { Builder } from "./Builder.ts";

const tail = (s: string, max = 4_000) =>
  s.length <= max ? s : `…${s.slice(-max)}`;

/**
 * Build a remote URL with the artifacts token embedded so `git clone` can
 * authenticate without a credential helper.
 */
const remoteWithToken = (remote: string, token: string) => {
  const url = new URL(remote);
  url.username = "token";
  url.password = token;
  return url.toString();
};

export default Builder.make(
  Effect.gen(function* () {
    const cp = yield* ChildProcessSpawner;

    const run = (
      cmd: string,
      options: { cwd?: string; env?: Record<string, string> } = {},
    ) =>
      cp
        .spawn(
          ChildProcess.make(cmd, {
            shell: true,
            cwd: options.cwd,
            env: options.env,
          }),
        )
        .pipe(
          Effect.flatMap((handle) =>
            Effect.all(
              [
                handle.exitCode,
                handle.stdout.pipe(Stream.decodeText, Stream.mkString),
                handle.stderr.pipe(Stream.decodeText, Stream.mkString),
              ],
              { concurrency: "unbounded" },
            ),
          ),
          Effect.map(([exitCode, stdout, stderr]) => ({
            exitCode: Number(exitCode),
            stdout,
            stderr,
          })),
          Effect.scoped,
        );

    return Builder.of({
      fetch: Effect.succeed(
        HttpServerResponse.text("alchemy/builder", { status: 200 }),
      ),
      runBuild: ({ artifactsRemote, artifactsToken, ref }) =>
        Effect.gen(function* () {
          const auth = remoteWithToken(artifactsRemote, artifactsToken);
          const clone = yield* run(
            `rm -rf /work && git clone --depth=1 --branch ${ref} ${auth} /work`,
          );
          if (clone.exitCode !== 0) {
            return { exitCode: clone.exitCode, logTail: tail(clone.stderr) };
          }

          const install = yield* run(`bun install --frozen-lockfile`, {
            cwd: "/work",
          });
          if (install.exitCode !== 0) {
            return {
              exitCode: install.exitCode,
              logTail: tail(install.stderr),
            };
          }

          const build = yield* run(`bun run build`, { cwd: "/work" });
          return {
            exitCode: build.exitCode,
            logTail: tail(`${build.stdout}\n${build.stderr}`),
          };
        }),

      runAgent: ({
        artifactsRemote,
        artifactsToken,
        ref,
        prompt,
        pushBranch,
      }) =>
        Effect.gen(function* () {
          const auth = remoteWithToken(artifactsRemote, artifactsToken);
          const clone = yield* run(
            `rm -rf /work && git clone --branch ${ref} ${auth} /work`,
          );
          if (clone.exitCode !== 0) {
            return {
              exitCode: clone.exitCode,
              logTail: tail(clone.stderr),
              pushedSha: null,
            };
          }

          const agent = yield* run(
            `printf '%s' ${JSON.stringify(prompt)} | npx @anthropic-ai/claude-code --task -`,
            { cwd: "/work" },
          );
          if (agent.exitCode !== 0) {
            return {
              exitCode: agent.exitCode,
              logTail: tail(`${agent.stdout}\n${agent.stderr}`),
              pushedSha: null,
            };
          }

          const target = pushBranch ?? ref;
          const push = yield* run(
            `git checkout -B ${target} && git push --force-with-lease ${auth} ${target}`,
            { cwd: "/work" },
          );
          const head = yield* run(`git rev-parse HEAD`, { cwd: "/work" });
          return {
            exitCode: push.exitCode,
            logTail: tail(`${agent.stdout}\n${push.stdout}\n${push.stderr}`),
            pushedSha: push.exitCode === 0 ? head.stdout.trim() : null,
          };
        }),
    });
  }),
);
