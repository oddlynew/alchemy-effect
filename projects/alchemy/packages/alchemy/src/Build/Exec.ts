import * as Effect from "effect/Effect";
import type { FileSystem } from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { isResolved } from "../Diff.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { sha256Object } from "../Util/sha256.ts";
import { runBuildCommand } from "./Command.ts";
import { hashDirectory, type MemoOptions } from "./Memo.ts";

export interface ExecProps {
  /**
   * The shell command to run. The command must be safe to re-run: the engine
   * may execute it again after a crash between the run and state
   * persistence, and any change to the command itself triggers a run.
   * @example "bun run src/seed.ts"
   */
  command: string;
  /**
   * Working directory for the command.
   * Defaults to the current working directory.
   */
  cwd?: string;
  /**
   * Controls which files are hashed to decide whether the command should
   * re-run. By default every non-gitignored file in `cwd` is hashed, plus
   * the nearest lockfile. Provide explicit globs to narrow the scope.
   *
   * Exclude (or gitignore) files the command itself writes inside `cwd` —
   * otherwise each run changes the hash and re-triggers the next one.
   *
   * @see {@link MemoOptions}
   */
  memo?: MemoOptions;
  /**
   * Environment variables to pass to the command. Changes to these values
   * re-run the command (secret values are folded into the stored run key as
   * a one-way hash, so a rotated secret re-runs too).
   */
  env?: Record<string, string | Redacted.Redacted<string>>;
}

export interface Exec extends Resource<
  "Build.Exec",
  ExecProps,
  {
    /**
     * Hash of the run inputs — memoized files, command, cwd, and env — from
     * the last completed run.
     */
    hash: string;
  }
> {}

/**
 * A Build resource that runs a shell command for its side effects,
 * re-running it whenever its inputs change — the hashed memo files, the
 * command itself, `cwd`, or `env`. Unlike {@link Command} it produces no
 * output artifact: there is no `outdir`, and deleting the resource only
 * forgets the run key — it never touches the file system. The command's
 * side effects (database rows, cache entries, …) are the command's own;
 * it must be idempotent.
 *
 * Use `Exec` for effectful steps like database seeds and migrations, and
 * `Command` for builds whose product is a directory of files.
 *
 * @section Seeding a Database
 * @example Re-seed When the Seed Script Changes
 * ```typescript
 * const seed = yield* Build.Exec("seed", {
 *   command: "bun run src/seed.ts",
 *   cwd: "./database",
 *   env: { DATABASE_URL: database.connectionUrl },
 *   memo: { include: ["src/seed.ts"] },
 * });
 * yield* Console.log(seed.hash); // hash of the run inputs
 * ```
 *
 * @section Sequencing Commands
 * @example Seed After Migrations
 * ```typescript
 * const migrations = yield* Build.Exec("migrate", {
 *   command: "drizzle-kit migrate",
 *   cwd: "./database",
 *   env: { DATABASE_URL: database.connectionUrl },
 *   memo: { include: ["migrations/**"] },
 * });
 *
 * const seed = yield* Build.Exec("seed", {
 *   command: "bun run src/seed.ts",
 *   cwd: "./database",
 *   env: {
 *     DATABASE_URL: database.connectionUrl,
 *     // Threading the hash orders seeding after migrations and re-seeds
 *     // whenever the migrations re-ran.
 *     MIGRATIONS_HASH: migrations.hash,
 *   },
 *   memo: { include: ["src/seed.ts"] },
 * });
 * ```
 */
export const Exec = Resource<Exec>("Build.Exec");

export const ExecProvider = () =>
  Provider.effect<
    Exec,
    Path.Path,
    never,
    FileSystem | Path.Path,
    never,
    ChildProcessSpawner | FileSystem | Path.Path
  >(
    Exec,
    Effect.gen(function* () {
      const pathModule = yield* Path.Path;

      const resolveEnv = (env: ExecProps["env"]) =>
        env
          ? Object.fromEntries(
              Object.entries(env).map(([key, value]) => [
                key,
                typeof value === "string" ? value : Redacted.value(value),
              ]),
            )
          : undefined;

      // The run key covers everything that determines what the command
      // would do: the memoized input files AND the command, cwd, and env.
      // Hashing files alone would silently skip a run when only the
      // command or its environment changed (e.g. a recreated database's
      // connection URL). `cwd` is hashed as given, not resolved — absolute
      // paths in persisted state would break across machines/checkouts.
      const execHash = Effect.fnUntraced(function* (props: ExecProps) {
        const files = yield* hashDirectory(props);
        return yield* sha256Object({
          files,
          command: props.command,
          cwd: props.cwd ?? null,
          env: resolveEnv(props.env) ?? null,
        });
      });

      const runExec = (props: ExecProps) =>
        Effect.scoped(
          runBuildCommand({
            command: props.command,
            cwd: props.cwd ? pathModule.resolve(props.cwd) : process.cwd(),
            env: resolveEnv(props.env),
          }),
        );

      return Exec.Provider.of({
        list: () => Effect.succeed([]),
        diff: Effect.fnUntraced(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          if (!output) {
            return undefined;
          }
          const newHash = yield* execHash(news);
          if (newHash !== output.hash) {
            return { action: "update" as const };
          }
        }),
        reconcile: Effect.fnUntraced(function* ({ news, output, session }) {
          // Observe — the previous run's `output.hash` records the inputs
          // the command last completed against; recompute to detect drift.
          const desiredHash = yield* execHash(news);

          // Ensure — run the command whenever it has never run or any of
          // its inputs changed.
          if (output === undefined || output.hash !== desiredHash) {
            yield* session.note(
              output === undefined
                ? `Running command: ${news.command}`
                : `Re-running command: ${news.command}`,
            );
            yield* runExec(news);
            yield* session.note(`Command completed: ${news.command}`);
          }

          // Return — the run key the command last completed against.
          return {
            hash: desiredHash,
          };
        }),
        delete: Effect.fnUntraced(function* () {
          // The command's side effects are not the engine's to reverse.
          // Deleting the resource just forgets the run key.
        }),
      });
    }),
  );
