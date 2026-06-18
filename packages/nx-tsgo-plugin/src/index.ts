import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createNodesFromFiles,
  type CreateNodesContext,
  type CreateNodes,
  type ProjectConfiguration,
} from "@nx/devkit";

export interface TsgoPluginOptions {
  typecheckTargetName?: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

interface ProjectJson {
  targets?: Record<string, unknown>;
}

/**
 * Nx plugin that infers typecheck targets using tsgo.
 */
const createNodesFunction: CreateNodes<TsgoPluginOptions> = [
  "**/tsconfig.json",
  async (configFiles, options, context) => {
    return await createNodesFromFiles(
      (configFile, options, context) =>
        createNodesInternal(configFile, options ?? {}, context),
      configFiles,
      options,
      context,
    );
  },
];

async function createNodesInternal(
  configFilePath: string,
  options: TsgoPluginOptions,
  context: CreateNodesContext,
) {
  const projectRoot = dirname(configFilePath);

  // Skip workspace root tsconfig
  if (projectRoot === ".") {
    return {};
  }

  // Must be an actual project (has package.json or project.json)
  const absoluteProjectRoot = join(context.workspaceRoot, projectRoot);
  const siblingFiles = readdirSync(absoluteProjectRoot);
  if (
    !siblingFiles.includes("package.json") &&
    !siblingFiles.includes("project.json")
  ) {
    return {};
  }

  const typecheckTargetName = options.typecheckTargetName || "typecheck";
  if (hasDeclaredTarget(absoluteProjectRoot, typecheckTargetName)) {
    return {};
  }

  const targets: Record<string, any> = {
    [typecheckTargetName]: {
      command: "bun tsgo --noEmit -p tsconfig.json",
      options: { cwd: "{projectRoot}" },
      cache: true,
      dependsOn: ["^typecheck"],
      metadata: {
        technologies: ["typescript"],
        description:
          "Type-checks the project using tsgo without emitting artifacts.",
      },
    },
  };

  const projectConfiguration: ProjectConfiguration = {
    root: projectRoot,
    targets,
  };

  return {
    projects: {
      [projectRoot]: projectConfiguration,
    },
  };
}

function hasDeclaredTarget(projectRoot: string, targetName: string) {
  const packageJson = readJson<PackageJson>(join(projectRoot, "package.json"));
  if (Object.hasOwn(packageJson?.scripts ?? {}, targetName)) {
    return true;
  }

  const projectJson = readJson<ProjectJson>(join(projectRoot, "project.json"));
  return Object.hasOwn(projectJson?.targets ?? {}, targetName);
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export default {
  name: "@alchemy.run/nx-tsgo-plugin",
  createNodes: createNodesFunction,
};

export const createNodes = createNodesFunction;
