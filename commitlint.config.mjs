import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function getWorkspacePatterns() {
  const rootPackageJson = JSON.parse(readFileSync("package.json", "utf-8"));
  const workspaces = rootPackageJson.workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  return workspaces?.packages ?? [];
}

function expandPattern(pattern) {
  return expandSegments(".", pattern.split("/"));
}

function expandSegments(base, segments) {
  const [segment, ...rest] = segments;

  if (segment === undefined) {
    return [base];
  }

  if (segment === "*") {
    return entries(base).flatMap((entry) =>
      expandSegments(join(base, entry), rest),
    );
  }

  return expandSegments(join(base, segment), rest);
}

function entries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function readProjectScope(dir) {
  const packageJsonPath = join(dir, "package.json");

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const name = packageJson.nx?.name ?? packageJson.name;

    if (typeof name !== "string") {
      return null;
    }

    return name.startsWith("@") ? name.split("/")[1] : name;
  } catch {
    return null;
  }
}

function getWorkspaceScopes() {
  return getWorkspacePatterns()
    .flatMap(expandPattern)
    .map(readProjectScope)
    .filter(Boolean);
}

const generalScopes = [
  "alchemy",
  "cloudflare-tools",
  "ci",
  "deps",
  "distilled",
  "nx",
  "release",
  "repo",
];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": async () => {
      const scopes = [
        ...new Set([...getWorkspaceScopes(), ...generalScopes]),
      ].sort((a, b) => a.localeCompare(b));
      return [2, "always", scopes];
    },
    "scope-empty": [2, "never"],
  },
};
