#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Avoid Bun's package-runner signal handling around long Nx CI runs.
const nodeBin = Bun.which("node") ?? "node";
const nxCli = resolve(workspaceRoot, "node_modules/nx/dist/bin/nx.js");
const [target, ...targetArgs] = Bun.argv.slice(2);

if (!target) {
  console.error(
    "Usage: run-affected-production-target.ts <target> [nx args...]",
  );
  process.exit(1);
}

const excludedExactRoots = [
  ".",
  "projects/distilled",
  "projects/cloudflare-tools",
  "projects/alchemy/apps/website",
];

const excludedRootPrefixes = [
  "projects/alchemy/examples/",
  "projects/cloudflare-tools/fixtures/",
  "projects/alchemy/packages/alchemy/test/",
];

const runNx = (args: string[], options?: { inherit?: boolean }) => {
  const result = spawnSync(nodeBin, [nxCli, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: options?.inherit ? "inherit" : "pipe",
  });

  if (result.status !== 0) {
    if (!options?.inherit) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    process.exit(result.status ?? 1);
  }

  if (options?.inherit) {
    return "";
  }

  return result.stdout.trim();
};

const isNonHermeticRoot = (root: string) =>
  excludedExactRoots.includes(root) ||
  excludedRootPrefixes.some((prefix) => root.startsWith(prefix)) ||
  root.includes("/test/fixtures/");

const affected = JSON.parse(
  runNx([
    "show",
    "projects",
    "--affected",
    `--withTarget=${target}`,
    "--json",
  ]),
) as string[];

const selected: string[] = [];
const skipped: Array<{ name: string; root: string }> = [];

for (const project of affected) {
  const details = JSON.parse(
    runNx(["show", "project", project, "--json"]),
  ) as {
    root?: string;
  };
  const root = details.root ?? "";

  if (isNonHermeticRoot(root)) {
    skipped.push({ name: project, root });
  } else {
    selected.push(project);
  }
}

console.log(
  `[affected-production] ${target}: selected ${selected.length}, skipped ${skipped.length}`,
);

if (skipped.length > 0) {
  console.log(
    skipped
      .map(
        ({ name, root }) => `[affected-production] skipped ${name} (${root})`,
      )
      .join("\n"),
  );
}

if (selected.length === 0) {
  console.log(
    `[affected-production] no affected production projects for ${target}`,
  );
  process.exit(0);
}

runNx(
  [
    "run-many",
    "-t",
    target,
    `--projects=${selected.join(",")}`,
    ...targetArgs,
  ],
  { inherit: true },
);
