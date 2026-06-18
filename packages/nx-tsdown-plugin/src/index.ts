import { existsSync } from "fs";
import { dirname, join } from "path";
import {
  createNodesFromFiles,
  type CreateNodesContext,
  type CreateNodes,
  type ProjectConfiguration,
} from "@nx/devkit";

export interface TsdownPluginOptions {
  buildTargetName?: string;
}

/**
 * Nx plugin that infers build targets for projects with tsdown.config.ts files.
 * Dev/watch mode is handled by watch-deps or Alchemy's dev command.
 */
const createNodesFunction: CreateNodes<TsdownPluginOptions> = [
  "**/tsdown.config.ts",
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
  options: TsdownPluginOptions,
  context: CreateNodesContext,
) {
  const projectRoot = dirname(configFilePath);

  // Check if this is actually a project (has package.json or project.json)
  const isProject =
    existsSync(join(context.workspaceRoot, projectRoot, "package.json")) ||
    existsSync(join(context.workspaceRoot, projectRoot, "project.json"));

  if (!isProject) {
    return {};
  }

  const buildTargetName = options.buildTargetName || "build";

  // Create targets - Nx will handle merging with existing targets automatically
  const targets: Record<string, any> = {
    [buildTargetName]: {
      executor: "nx:run-commands",
      options: {
        command: "tsdown",
        cwd: "{projectRoot}",
      },
      outputs: ["{projectRoot}/dist"],
      cache: true,
      dependsOn: ["^build"],
    },
    "build-deps": {
      executor: "nx:noop",
      dependsOn: ["^build"],
    },
    "watch-deps": {
      executor: "nx:run-commands",
      options: {
        command: `bun nx watch --projects {projectName} --includeDependencies -- bun nx build-deps {projectName}`,
        cwd: "{projectRoot}",
      },
      continuous: true,
      dependsOn: ["build-deps"],
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

// Export as default plugin object
export default {
  name: "@alchemy.run/nx-tsdown-plugin",
  createNodes: createNodesFunction,
};

// Also export the function directly for compatibility
export const createNodes = createNodesFunction;
