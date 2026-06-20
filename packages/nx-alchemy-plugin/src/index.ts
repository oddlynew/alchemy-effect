import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createNodesFromFiles,
  type CreateNodesContext,
  type CreateNodes,
  type ProjectConfiguration,
  type TargetConfiguration,
} from "@nx/devkit";

export interface AlchemyPluginOptions {
  devTargetName?: string;
  deployTargetName?: string;
  destroyTargetName?: string;
  planTargetName?: string;
  logsTargetName?: string;
}

/**
 * Doppler configuration from package.json
 */
export interface DopplerConfig {
  /**
   * Doppler project name.
   */
  project: string;
}

export interface AlchemyCommandConfig {
  /**
   * Default Doppler config for this command. DOPPLER_CONFIG still overrides it.
   */
  dopplerConfig?: string;

  /**
   * Default stage for this command. STAGE still overrides it.
   */
  stage?: string;

  /**
   * Stage for shared infrastructure that must not be overridden by STAGE.
   */
  fixedStage?: string;
}

export interface AlchemyConfig {
  dev?: AlchemyCommandConfig;
  deploy?: AlchemyCommandConfig;
  destroy?: AlchemyCommandConfig;
  plan?: AlchemyCommandConfig;
  logs?: AlchemyCommandConfig;
}

/**
 * Extended package.json with Nx metadata
 */
interface PackageJson {
  name?: string;
  nx?: {
    name?: string;
    tags?: string[];
    doppler?: DopplerConfig;
    alchemy?: AlchemyConfig;
  };
}

/**
 * Nx plugin that infers deployment targets for projects with alchemy.run.ts files
 */
const createNodesFunction: CreateNodes<AlchemyPluginOptions> = [
  "**/alchemy.run.ts",
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
  options: AlchemyPluginOptions,
  context: CreateNodesContext,
) {
  try {
    const projectRoot = dirname(configFilePath);

    // Check if this is actually a project (has package.json or project.json)
    const packageJsonPath = join(
      context.workspaceRoot,
      projectRoot,
      "package.json",
    );
    const isProject =
      existsSync(packageJsonPath) ||
      existsSync(join(context.workspaceRoot, projectRoot, "project.json"));

    if (!isProject) {
      return {};
    }

    // Read Alchemy deployment config from package.json
    const alchemyConfig = extractAlchemyConfig(packageJsonPath);

    // Create targets
    const targets = createTargets(options, alchemyConfig);

    const projectConfiguration: ProjectConfiguration = {
      root: projectRoot,
      targets,
    };

    return {
      projects: {
        [projectRoot]: projectConfiguration,
      },
    };
  } catch (error) {
    // Log error but don't crash Nx
    console.error(
      `[nx-alchemy-plugin] Error processing ${configFilePath}:`,
      error,
    );
    return {};
  }
}

/**
 * Extract Alchemy target configuration from package.json
 */
function extractAlchemyConfig(packageJsonPath: string): {
  doppler?: DopplerConfig;
  alchemy?: AlchemyConfig;
} {
  try {
    if (!existsSync(packageJsonPath)) {
      return {};
    }

    const content = readFileSync(packageJsonPath, "utf-8");
    const packageJson: PackageJson = JSON.parse(content);

    return {
      doppler: packageJson.nx?.doppler,
      alchemy: packageJson.nx?.alchemy,
    };
  } catch {
    return {};
  }
}

/**
 * Wrap a command with Doppler if configuration exists
 *
 * Config selection:
 * 1. DOPPLER_PROJECT env var (explicit project override for forks)
 * 2. DOPPLER_CONFIG env var (explicit config override for any config: prd, staging, qa, etc.)
 * 3. Defaults to the package's configured project and the "dev" config
 *
 * Examples:
 * - nx deploy project uses the "dev" config
 * - DOPPLER_CONFIG=prd nx deploy uses the "prd" config
 * - DOPPLER_PROJECT=my-fork nx deploy uses another Doppler project
 * - ALCHEMY_PROFILE=admin nx deploy uses another Alchemy auth profile
 * - DOPPLER_CONFIG=staging nx dev uses the "staging" config
 */
function wrapWithDoppler(
  command: string,
  dopplerConfig: DopplerConfig | undefined,
  commandConfig: AlchemyCommandConfig,
): string {
  if (!dopplerConfig) {
    return command;
  }

  const projectSelection = `\${DOPPLER_PROJECT:-${dopplerConfig.project}}`;

  const configSelection = `\${DOPPLER_CONFIG:-${commandConfig.dopplerConfig ?? "dev"}}`;

  return `doppler run --project ${projectSelection} --config ${configSelection} -- ${command}`;
}

/**
 * Build the alchemy CLI invocation for a subcommand.
 *
 * The alchemy.run.ts file defines the stack (name, providers, resources);
 * the CLI only needs the file path and the stage. The stage defaults to
 * "dev" and is overridden with the STAGE env var (e.g. STAGE=alex).
 *
 * Per-subcommand flags:
 * - `--adopt` lets create operations take over same-name resources instead
 *   of failing. deploy only: `alchemy dev` adopts implicitly and rejects
 *   the flag; destroy/plan never adopt.
 * - `--yes` skips the plan-approval prompt. The prompt has no TTY detection
 *   and hangs forever in CI, so deploy always passes it; destroy passes it
 *   only when CI is set (`${CI:+--yes}`) — a local destroy keeps its
 *   confirmation. dev never prompts (the CLI hardcodes yes internally).
 */
function alchemyCommand(
  subcommand: "dev" | "deploy" | "destroy" | "plan" | "logs",
  commandConfig: AlchemyCommandConfig,
): string {
  const flags = {
    dev: "",
    deploy: " --adopt --yes",
    destroy: " ${CI:+--yes}",
    plan: "",
    logs: "",
  }[subcommand];
  const profileSelection = "${ALCHEMY_PROFILE:-default}";
  const stageSelection =
    commandConfig.fixedStage ?? `\${STAGE:-${commandConfig.stage ?? "dev"}}`;
  return `bunx alchemy ${subcommand} alchemy.run.ts${flags} --profile ${profileSelection} --stage ${stageSelection}`;
}

function commandConfig(
  alchemyConfig: AlchemyConfig | undefined,
  subcommand: "dev" | "deploy" | "destroy" | "plan" | "logs",
): AlchemyCommandConfig {
  return alchemyConfig?.[subcommand] ?? {};
}

function commandWithContext(
  subcommand: "dev" | "deploy" | "destroy" | "plan" | "logs",
  dopplerConfig: DopplerConfig | undefined,
  alchemyConfig: AlchemyConfig | undefined,
): string {
  const config = commandConfig(alchemyConfig, subcommand);
  return wrapWithDoppler(
    alchemyCommand(subcommand, config),
    dopplerConfig,
    config,
  );
}

function createTargets(
  options: AlchemyPluginOptions,
  config: {
    doppler?: DopplerConfig;
    alchemy?: AlchemyConfig;
  },
): Record<string, TargetConfiguration> {
  const devTargetName = options.devTargetName || "dev";
  const deployTargetName = options.deployTargetName || "deploy";
  const destroyTargetName = options.destroyTargetName || "destroy";
  const planTargetName = options.planTargetName || "plan";
  const logsTargetName = options.logsTargetName || "logs";

  const targets: Record<string, TargetConfiguration> = {};

  // The 'dev' target runs 'alchemy dev' which is always continuous
  // Nx understands continuous tasks and runs them alongside their dependents
  // The alchemy.run.ts file controls what each project actually does
  targets[devTargetName] = {
    executor: "nx:run-commands",
    options: {
      command: commandWithContext("dev", config.doppler, config.alchemy),
      cwd: "{projectRoot}",
    },
    cache: false,
    continuous: true,
  };

  targets[deployTargetName] = {
    executor: "nx:run-commands",
    options: {
      command: commandWithContext("deploy", config.doppler, config.alchemy),
      cwd: "{projectRoot}",
    },
    cache: false,
  };

  // Note: destroy has no dependsOn to allow manual control of destruction order
  // Deploy builds up (db → infra → frontend), but destroy should tear down in reverse
  // Since Nx doesn't support reverse dependencies, we leave destroy without dependsOn
  // Users should destroy in reverse order manually: frontend → infra → db
  targets[destroyTargetName] = {
    executor: "nx:run-commands",
    options: {
      command: commandWithContext("destroy", config.doppler, config.alchemy),
      cwd: "{projectRoot}",
    },
    cache: false,
  };

  targets[planTargetName] = {
    executor: "nx:run-commands",
    options: {
      command: commandWithContext("plan", config.doppler, config.alchemy),
      cwd: "{projectRoot}",
    },
    cache: false,
  };

  targets[logsTargetName] = {
    executor: "nx:run-commands",
    options: {
      command: commandWithContext("logs", config.doppler, config.alchemy),
      cwd: "{projectRoot}",
    },
    cache: false,
  };

  return targets;
}

// Export as default plugin object
export default {
  name: "@oddlynew/alchemy-nx-alchemy-plugin",
  createNodes: createNodesFunction,
};

// Also export the function directly for compatibility
export const createNodes = createNodesFunction;
