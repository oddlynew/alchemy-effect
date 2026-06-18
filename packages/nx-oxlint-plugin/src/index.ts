import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  createNodesFromFiles,
  type CreateNodesContext,
  type CreateNodes,
  type ProjectConfiguration,
} from "@nx/devkit";

export interface OxlintPluginOptions {
  lintTargetName?: string;
  typeAware?: boolean;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

interface ProjectJson {
  targets?: Record<string, unknown>;
}

/**
 * Nx plugin that infers lint targets for projects covered by an oxlint config.
 */
const createNodesFunction: CreateNodes<OxlintPluginOptions> = [
  "**/{package,project}.json",
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
  options: OxlintPluginOptions,
  context: CreateNodesContext,
) {
  const projectRoot = dirname(configFilePath);
  const absoluteProjectRoot = join(context.workspaceRoot, projectRoot);

  const oxlintConfigPath = findNearestOxlintConfig(
    absoluteProjectRoot,
    context.workspaceRoot,
  );

  if (!oxlintConfigPath) {
    return {};
  }

  const lintTargetName = options.lintTargetName || "lint";
  const typeAware = options.typeAware !== false; // Default to true

  if (typeAware && !existsSync(join(absoluteProjectRoot, "tsconfig.json"))) {
    return {};
  }

  if (hasDeclaredTarget(absoluteProjectRoot, lintTargetName)) {
    return {};
  }

  const configPathFromProject = toPosix(
    relative(absoluteProjectRoot, oxlintConfigPath),
  );
  const configPathInput = `{workspaceRoot}/${toPosix(
    relative(context.workspaceRoot, oxlintConfigPath),
  )}`;
  const configFlag = configPathFromProject.startsWith(".")
    ? configPathFromProject
    : `./${configPathFromProject}`;
  const oxlintCommand = typeAware ? "oxlint --type-aware ." : "oxlint .";
  const command = `${oxlintCommand} --config ${configFlag}`;

  // Create targets - Nx will handle merging with existing targets automatically
  const targets: Record<string, any> = {
    [lintTargetName]: {
      executor: "nx:run-commands",
      options: {
        command,
        cwd: "{projectRoot}",
      },
      cache: true,
      outputs: [],
      inputs: ["taskSources", "^production", configPathInput],
      // Type-aware linting resolves cross-package types from dependencies' dist output.
      dependsOn: ["^build"],
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

function hasDeclaredTarget(absoluteProjectRoot: string, targetName: string) {
  const packageJson = readJson<PackageJson>(
    join(absoluteProjectRoot, "package.json"),
  );
  if (Object.hasOwn(packageJson?.scripts ?? {}, targetName)) {
    return true;
  }

  const projectJson = readJson<ProjectJson>(
    join(absoluteProjectRoot, "project.json"),
  );
  return Object.hasOwn(projectJson?.targets ?? {}, targetName);
}

function findNearestOxlintConfig(
  absoluteProjectRoot: string,
  workspaceRoot: string,
) {
  let current = absoluteProjectRoot;

  while (current.startsWith(workspaceRoot)) {
    const jsonConfig = join(current, ".oxlintrc.json");
    if (existsSync(jsonConfig)) {
      return jsonConfig;
    }

    const tsConfig = join(current, "oxlint.config.ts");
    if (existsSync(tsConfig)) {
      return tsConfig;
    }

    if (current === workspaceRoot) {
      break;
    }

    current = dirname(current);
  }

  return undefined;
}

function toPosix(path: string) {
  return path.replaceAll("\\", "/");
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

// Export as default plugin object
export default {
  name: "@alchemy.run/nx-oxlint-plugin",
  createNodes: createNodesFunction,
};

// Also export the function directly for compatibility
export const createNodes = createNodesFunction;
