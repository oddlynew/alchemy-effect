import * as AWS from "@/AWS";
import * as Build from "@/Build";
import * as Test from "@/Test/Vitest";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as pathe from "pathe";

const { test } = Test.make({ providers: AWS.providers() });

const fixtureDir = pathe.resolve(import.meta.dirname, "exec-fixture");

test.provider(
  "runs on file, env, and command changes; delete leaves side effects alone",
  (stack) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      yield* stack.destroy();

      const runsLog = pathe.join(fixtureDir, "runs.log");
      yield* fs.remove(runsLog).pipe(Effect.catch(() => Effect.void));

      const countRuns = Effect.gen(function* () {
        const content = yield* fs.readFileString(runsLog);
        return content.split("\n").filter((line) => line.length > 0).length;
      });

      const deploy = (props: { command?: string; env?: { MARKER: string } }) =>
        stack.deploy(
          Effect.gen(function* () {
            return yield* Build.Exec("test-exec", {
              command: props.command ?? "bash run.sh",
              cwd: fixtureDir,
              env: props.env ?? { MARKER: "first" },
              memo: { include: ["src/**"] },
            });
          }),
        );

      const exec1 = yield* deploy({});

      expect(exec1.hash).toBeDefined();
      expect(typeof exec1.hash).toBe("string");
      expect(exec1.hash.length).toBeGreaterThan(0);
      expect(yield* countRuns).toBe(1);

      // Unchanged inputs — the run is skipped.
      const exec2 = yield* deploy({});
      expect(exec2.hash).toBe(exec1.hash);
      expect(yield* countRuns).toBe(1);

      // An env-only change re-runs (e.g. a recreated database's
      // connection URL with identical files).
      const exec3 = yield* deploy({ env: { MARKER: "second" } });
      expect(exec3.hash).not.toBe(exec1.hash);
      expect(yield* countRuns).toBe(2);

      // A command-only change re-runs.
      const exec4 = yield* deploy({
        command: "bash run.sh second-run",
        env: { MARKER: "second" },
      });
      expect(exec4.hash).not.toBe(exec3.hash);
      expect(yield* countRuns).toBe(3);

      // A memoized input file change re-runs.
      yield* fs.writeFileString(
        pathe.join(fixtureDir, "src", "input.txt"),
        "two\n",
      );
      const exec5 = yield* deploy({
        command: "bash run.sh second-run",
        env: { MARKER: "second" },
      });
      expect(exec5.hash).not.toBe(exec4.hash);
      expect(yield* countRuns).toBe(4);

      // Destroy never reverses the command's side effects…
      yield* stack.destroy();
      expect(yield* countRuns).toBe(4);

      // …and forgets the run key, so an unchanged redeploy runs again.
      const exec6 = yield* deploy({
        command: "bash run.sh second-run",
        env: { MARKER: "second" },
      });
      expect(exec6.hash).toBe(exec5.hash);
      expect(yield* countRuns).toBe(5);

      yield* stack.destroy();
      yield* fs.remove(runsLog);
      yield* fs.writeFileString(
        pathe.join(fixtureDir, "src", "input.txt"),
        "one\n",
      );
    }),
  { timeout: 60000 },
);
